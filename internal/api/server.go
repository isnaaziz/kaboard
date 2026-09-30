package api

import (
	"context"
	"encoding/json"
	"errors"
	"io/fs"
	"log/slog"
	"net/http"
	"path"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/twmb/franz-go/pkg/kerr"

	"kaboard/internal/audit"
	"kaboard/internal/auth"
	"kaboard/internal/kafka"
)

const (
	adminTimeout = 15 * time.Second
	maxBody      = 16 << 20
)

type Options struct {
	Registry      *kafka.Registry
	Auth          *auth.Service
	Audit         *audit.Log
	Static        fs.FS
	Log           *slog.Logger
	TrustProxy    bool
	SecureCookies bool
}

type Server struct {
	reg           *kafka.Registry
	auth          *auth.Service
	audit         *audit.Log
	log           *slog.Logger
	secureCookies bool
}

func New(o Options) http.Handler {
	s := &Server{reg: o.Registry, auth: o.Auth, audit: o.Audit, log: o.Log, secureCookies: o.SecureCookies}
	r := chi.NewRouter()
	if o.TrustProxy {
		r.Use(middleware.RealIP)
	}
	r.Use(middleware.Recoverer, securityHeaders)
	r.Route("/api", func(r chi.Router) {
		r.Use(s.logRequests, csrf)
		r.Get("/auth/state", s.authState)
		r.Post("/auth/setup", s.setup)
		r.Post("/auth/login", s.login)
		r.Group(func(r chi.Router) {
			r.Use(s.authenticate, s.recordAudit)
			r.Post("/auth/logout", s.logout)
			r.Post("/auth/password", s.changePassword)
			r.Get("/formats", s.formats)
			r.Get("/clusters", s.clusters)
			r.Group(func(r chi.Router) {
				r.Use(requireAdmin)
				r.Post("/clusters", s.saveCluster)
				r.Post("/connections/test", s.testConnection)
				r.Get("/users", s.listUsers)
				r.Post("/users", s.createUser)
				r.Put("/users/{username}", s.updateUser)
				r.Delete("/users/{username}", s.deleteUser)
				r.Get("/audit", s.listAudit)
			})
			r.Route("/clusters/{cluster}", func(r chi.Router) {
				r.With(requireAdmin).Put("/", s.saveCluster)
				r.With(requireAdmin).Delete("/", s.deleteCluster)
				r.Group(func(r chi.Router) {
					r.Use(s.cluster)
					r.Get("/", s.do(http.StatusOK, overview))
					r.Get("/health", s.do(http.StatusOK, health))
					r.Get("/topics", s.do(http.StatusOK, topics))
					r.Get("/topics/{topic}", s.do(http.StatusOK, topic))
					r.Get("/topics/{topic}/messages", s.browse)
					r.Get("/groups", s.do(http.StatusOK, groups))
					r.Get("/groups/{group}", s.do(http.StatusOK, group))
					r.With(requireRole(auth.RoleOperator)).Post("/topics", s.do(http.StatusCreated, createTopic))
					r.With(requireRole(auth.RoleOperator)).Patch("/topics/{topic}/configs", s.do(http.StatusNoContent, alterConfigs))
					r.With(requireRole(auth.RoleOperator)).Post("/topics/{topic}/messages", s.do(http.StatusCreated, produce))
					r.With(requireRole(auth.RoleOperator)).Post("/groups/{group}/reset", s.do(http.StatusNoContent, resetOffsets))
					r.With(requireRole(auth.RoleAdmin)).Delete("/topics/{topic}", s.do(http.StatusNoContent, deleteTopic))
					r.With(requireRole(auth.RoleAdmin)).Delete("/topics/{topic}/messages", s.do(http.StatusOK, purgeTopic))
					r.With(requireRole(auth.RoleAdmin)).Delete("/groups/{group}", s.do(http.StatusNoContent, deleteGroup))
				})
			})
		})
	})
	r.NotFound(spa(o.Static))
	return r
}

type action func(ctx context.Context, c *kafka.Cluster, r *http.Request) (any, error)

func (s *Server) do(status int, fn action) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), adminTimeout)
		defer cancel()
		v, err := fn(ctx, clusterFrom(r), r)
		if err != nil {
			s.fail(w, r, err)
			return
		}
		if status == http.StatusNoContent {
			w.WriteHeader(status)
			return
		}
		writeJSON(w, status, v)
	}
}

func (s *Server) fail(w http.ResponseWriter, r *http.Request, err error) {
	status := http.StatusInternalServerError
	var ke *kerr.Error
	var locked auth.LockedError
	switch {
	case errors.As(err, &locked):
		status = http.StatusTooManyRequests
		w.Header().Set("Retry-After", strconv.Itoa(int(locked.RetryAfter.Seconds())))
	case errors.Is(err, auth.ErrCredentials):
		status = http.StatusUnauthorized
	case errors.Is(err, auth.ErrForbidden):
		status = http.StatusForbidden
	case errors.Is(err, kafka.ErrNotFound), errors.Is(err, auth.ErrNotFound):
		status = http.StatusNotFound
	case errors.Is(err, kafka.ErrInvalid), errors.Is(err, auth.ErrInvalid):
		status = http.StatusBadRequest
	case errors.Is(err, kafka.ErrConflict), errors.Is(err, auth.ErrConflict):
		status = http.StatusConflict
	case errors.Is(err, context.DeadlineExceeded):
		status = http.StatusGatewayTimeout
	case errors.As(err, &ke):
		status = http.StatusUnprocessableEntity
	}
	if status >= http.StatusInternalServerError {
		s.log.Error("request failed", "path", r.URL.Path, "err", err)
	}
	writeError(w, status, err.Error())
}

func decode[T any](r *http.Request) (T, error) {
	var v T
	if err := json.NewDecoder(http.MaxBytesReader(nil, r.Body, maxBody)).Decode(&v); err != nil {
		return v, errors.Join(kafka.ErrInvalid, err)
	}
	return v, nil
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

func spa(static fs.FS) http.HandlerFunc {
	files := http.FileServerFS(static)
	return func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api/") {
			writeError(w, http.StatusNotFound, "not found")
			return
		}
		name := strings.TrimPrefix(path.Clean(r.URL.Path), "/")
		if _, err := fs.Stat(static, name); err == nil && name != "" {
			if strings.HasPrefix(name, "assets/") {
				w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
			}
			files.ServeHTTP(w, r)
			return
		}
		if _, err := fs.Stat(static, "index.html"); err != nil {
			http.Error(w, "frontend not built: run `make web`", http.StatusNotFound)
			return
		}
		w.Header().Set("Cache-Control", "no-cache")
		http.ServeFileFS(w, r, static, "index.html")
	}
}
