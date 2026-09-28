package api

import (
	"context"
	"log/slog"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"

	"kaboard/internal/audit"
	"kaboard/internal/auth"
	"kaboard/internal/kafka"
)

const (
	sessionCookie = "kaboard_session"
	csrfHeader    = "X-Kaboard-Request"
)

type (
	clusterKey   struct{}
	principalKey struct{}
	noteKey      struct{}
)

type note struct {
	target string
	detail string
}

const csp = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; " +
	"font-src 'self'; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"

func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("Content-Security-Policy", csp)
		h.Set("X-Frame-Options", "DENY")
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("Referrer-Policy", "no-referrer")
		h.Set("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
		h.Set("Cross-Origin-Opener-Policy", "same-origin")
		if r.TLS != nil {
			h.Set("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
		}
		next.ServeHTTP(w, r)
	})
}

func csrf(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet || r.Method == http.MethodHead || r.Method == http.MethodOptions {
			next.ServeHTTP(w, r)
			return
		}
		if r.Header.Get(csrfHeader) != "1" || !sameOrigin(r) {
			writeError(w, http.StatusForbidden, "cross-site request blocked")
			return
		}
		next.ServeHTTP(w, r)
	})
}

func sameOrigin(r *http.Request) bool {
	origin := r.Header.Get("Origin")
	if origin == "" {
		return true
	}
	u, err := url.Parse(origin)
	return err == nil && strings.EqualFold(u.Host, r.Host)
}

func (s *Server) authenticate(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		c, err := r.Cookie(sessionCookie)
		if err != nil {
			writeError(w, http.StatusUnauthorized, "authentication required")
			return
		}
		p, ok := s.auth.Authenticate(c.Value)
		if !ok {
			s.clearCookie(w, r)
			writeError(w, http.StatusUnauthorized, "session expired")
			return
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), principalKey{}, p)))
	})
}

func requireAdmin(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !principalFrom(r).IsAdmin() {
			writeError(w, http.StatusForbidden, "admin role required")
			return
		}
		next.ServeHTTP(w, r)
	})
}

func requireRole(need auth.Role) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if !principalFrom(r).Can(chi.URLParam(r, "cluster"), need) {
				writeError(w, http.StatusForbidden, string(need)+" role required on this cluster")
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

func (s *Server) cluster(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		name := chi.URLParam(r, "cluster")
		c, ok := s.reg.Get(name)
		if !ok || !principalFrom(r).Can(name, auth.RoleViewer) {
			writeError(w, http.StatusNotFound, "cluster not found")
			return
		}
		if c.ReadOnly && r.Method != http.MethodGet && r.Method != http.MethodHead {
			writeError(w, http.StatusForbidden, "cluster is read-only")
			return
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), clusterKey{}, c)))
	})
}

func (s *Server) logRequests(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ww := middleware.NewWrapResponseWriter(w, r.ProtoMajor)
		start := time.Now()
		next.ServeHTTP(ww, r)
		s.log.Log(r.Context(), slog.LevelDebug, "request",
			"method", r.Method, "path", r.URL.Path, "status", ww.Status(),
			"remote", r.RemoteAddr, "duration", time.Since(start).Round(time.Millisecond))
	})
}

var actions = map[string]string{
	"POST /api/auth/logout":                                "Sign out",
	"POST /api/auth/password":                              "Change password",
	"POST /api/clusters":                                   "Create connection",
	"PUT /api/clusters/{cluster}/":                         "Update connection",
	"DELETE /api/clusters/{cluster}/":                      "Remove connection",
	"POST /api/connections/test":                           "Test connection",
	"POST /api/users":                                      "Create user",
	"PUT /api/users/{username}":                            "Update user",
	"DELETE /api/users/{username}":                         "Delete user",
	"POST /api/clusters/{cluster}/topics":                  "Create topic",
	"DELETE /api/clusters/{cluster}/topics/{topic}":        "Delete topic",
	"PATCH /api/clusters/{cluster}/topics/{topic}/configs": "Update topic config",
	"GET /api/clusters/{cluster}/topics/{topic}/messages":  "Browse messages",
	"POST /api/clusters/{cluster}/topics/{topic}/messages": "Produce messages",
	"DELETE /api/clusters/{cluster}/groups/{group}":        "Delete consumer group",
	"POST /api/clusters/{cluster}/groups/{group}/reset":    "Reset offsets",
}

func (s *Server) recordAudit(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		n := &note{}
		ww := middleware.NewWrapResponseWriter(w, r.ProtoMajor)
		next.ServeHTTP(ww, r.WithContext(context.WithValue(r.Context(), noteKey{}, n)))
		rctx := chi.RouteContext(r.Context())
		key := r.Method + " " + rctx.RoutePattern()
		action, ok := actions[key]
		if !ok && r.Method == http.MethodGet {
			return
		}
		if !ok {
			action = key
		}
		target := n.target
		for _, p := range []string{"topic", "group", "username"} {
			if v := rctx.URLParam(p); v != "" && target == "" {
				target = v
			}
		}
		s.record(r, audit.Entry{
			User: principalFrom(r).Username, Action: action, Cluster: rctx.URLParam("cluster"),
			Target: target, Detail: n.detail, Status: ww.Status(),
		})
	})
}

func (s *Server) record(r *http.Request, e audit.Entry) {
	e.IP = clientIP(r)
	if err := s.audit.Record(e); err != nil {
		s.log.Error("audit write failed", "err", err)
	}
	s.log.Info("audit", "user", e.User, "action", e.Action, "cluster", e.Cluster, "target", e.Target, "status", e.Status, "ip", e.IP)
}

func annotate(r *http.Request, target, detail string) {
	if n, ok := r.Context().Value(noteKey{}).(*note); ok {
		if target != "" {
			n.target = target
		}
		n.detail = detail
	}
}

func principalFrom(r *http.Request) auth.Principal {
	p, _ := r.Context().Value(principalKey{}).(auth.Principal)
	return p
}

func clusterFrom(r *http.Request) *kafka.Cluster {
	c, _ := r.Context().Value(clusterKey{}).(*kafka.Cluster)
	return c
}

func clientIP(r *http.Request) string {
	if host, _, err := net.SplitHostPort(r.RemoteAddr); err == nil {
		return host
	}
	return r.RemoteAddr
}
