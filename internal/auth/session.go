package auth

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"strings"
	"sync"
	"time"
)

const (
	IdleTimeout = 8 * time.Hour
	MaxLifetime = 7 * 24 * time.Hour
)

type session struct {
	username string
	created  time.Time
	lastSeen time.Time
}

type sessions struct {
	mu sync.Mutex
	m  map[string]*session
}

func newSessions() *sessions {
	return &sessions{m: map[string]*session{}}
}

func digest(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

func (s *sessions) create(username string) (string, error) {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	token := base64.RawURLEncoding.EncodeToString(buf)
	now := time.Now()
	s.mu.Lock()
	defer s.mu.Unlock()
	for k, v := range s.m {
		if expired(v, now) {
			delete(s.m, k)
		}
	}
	s.m[digest(token)] = &session{username: username, created: now, lastSeen: now}
	return token, nil
}

func (s *sessions) touch(token string) (string, bool) {
	key := digest(token)
	now := time.Now()
	s.mu.Lock()
	defer s.mu.Unlock()
	v, ok := s.m[key]
	if !ok {
		return "", false
	}
	if expired(v, now) {
		delete(s.m, key)
		return "", false
	}
	v.lastSeen = now
	return v.username, true
}

func (s *sessions) revoke(token string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.m, digest(token))
}

func (s *sessions) revokeUser(username, keep string) {
	keepKey := ""
	if keep != "" {
		keepKey = digest(keep)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	for k, v := range s.m {
		if strings.EqualFold(v.username, username) && k != keepKey {
			delete(s.m, k)
		}
	}
}

func expired(v *session, now time.Time) bool {
	return now.Sub(v.lastSeen) > IdleTimeout || now.Sub(v.created) > MaxLifetime
}
