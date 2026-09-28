package api

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"

	"kaboard/internal/audit"
	"kaboard/internal/auth"
)

type credentials struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

func (s *Server) authState(w http.ResponseWriter, r *http.Request) {
	state := map[string]any{"setupRequired": s.auth.SetupRequired()}
	if c, err := r.Cookie(sessionCookie); err == nil {
		if p, ok := s.auth.Authenticate(c.Value); ok {
			state["user"] = p
		}
	}
	writeJSON(w, http.StatusOK, state)
}

func (s *Server) setup(w http.ResponseWriter, r *http.Request) {
	in, err := decode[credentials](r)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	token, p, err := s.auth.Setup(in.Username, in.Password)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	s.record(r, audit.Entry{User: p.Username, Action: "Initial setup", Target: p.Username, Status: http.StatusOK})
	s.setCookie(w, r, token)
	writeJSON(w, http.StatusOK, p)
}

func (s *Server) login(w http.ResponseWriter, r *http.Request) {
	in, err := decode[credentials](r)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	token, p, err := s.auth.Login(in.Username, in.Password, clientIP(r))
	if err != nil {
		status := http.StatusUnauthorized
		if errors.As(err, new(auth.LockedError)) {
			status = http.StatusTooManyRequests
		}
		s.record(r, audit.Entry{User: in.Username, Action: "Sign in failed", Detail: err.Error(), Status: status})
		s.fail(w, r, err)
		return
	}
	s.record(r, audit.Entry{User: p.Username, Action: "Sign in", Status: http.StatusOK})
	s.setCookie(w, r, token)
	writeJSON(w, http.StatusOK, p)
}

func (s *Server) logout(w http.ResponseWriter, r *http.Request) {
	if c, err := r.Cookie(sessionCookie); err == nil {
		s.auth.Logout(c.Value)
	}
	s.clearCookie(w, r)
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) changePassword(w http.ResponseWriter, r *http.Request) {
	in, err := decode[struct {
		Current string `json:"current"`
		Next    string `json:"next"`
	}](r)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	c, _ := r.Cookie(sessionCookie)
	if err := s.auth.ChangePassword(principalFrom(r).Username, in.Current, in.Next, c.Value); err != nil {
		s.fail(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) listUsers(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, s.auth.List())
}

func (s *Server) createUser(w http.ResponseWriter, r *http.Request) {
	in, err := decode[auth.UserInput](r)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	u, err := s.auth.Create(in)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	annotate(r, u.Username, "role "+string(u.Role))
	writeJSON(w, http.StatusCreated, u)
}

func (s *Server) updateUser(w http.ResponseWriter, r *http.Request) {
	in, err := decode[auth.UserInput](r)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	u, err := s.auth.Update(chi.URLParam(r, "username"), in, principalFrom(r).Username)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	detail := "role " + string(u.Role)
	if in.Password != "" {
		detail += ", password reset"
	}
	if u.Disabled {
		detail += ", disabled"
	}
	annotate(r, "", detail)
	writeJSON(w, http.StatusOK, u)
}

func (s *Server) deleteUser(w http.ResponseWriter, r *http.Request) {
	if err := s.auth.Delete(chi.URLParam(r, "username"), principalFrom(r).Username); err != nil {
		s.fail(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) listAudit(w http.ResponseWriter, r *http.Request) {
	limit, err := strconv.Atoi(r.URL.Query().Get("limit"))
	if err != nil || limit <= 0 || limit > 5000 {
		limit = 500
	}
	writeJSON(w, http.StatusOK, s.audit.List(limit, r.URL.Query().Get("q")))
}

func (s *Server) setCookie(w http.ResponseWriter, r *http.Request, token string) {
	http.SetCookie(w, &http.Cookie{
		Name: sessionCookie, Value: token, Path: "/", HttpOnly: true, SameSite: http.SameSiteStrictMode,
		Secure: s.secureCookies || r.TLS != nil, MaxAge: int(auth.MaxLifetime.Seconds()),
	})
}

func (s *Server) clearCookie(w http.ResponseWriter, r *http.Request) {
	http.SetCookie(w, &http.Cookie{
		Name: sessionCookie, Value: "", Path: "/", HttpOnly: true, SameSite: http.SameSiteStrictMode,
		Secure: s.secureCookies || r.TLS != nil, MaxAge: -1,
	})
}
