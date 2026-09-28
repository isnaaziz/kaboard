package auth

import (
	"sync"
	"time"
)

const (
	maxFailures = 5
	failWindow  = 15 * time.Minute
	lockout     = 15 * time.Minute
)

type attempts struct {
	failures    int
	first       time.Time
	lockedUntil time.Time
}

type limiter struct {
	mu sync.Mutex
	m  map[string]*attempts
}

func newLimiter() *limiter {
	return &limiter{m: map[string]*attempts{}}
}

func (l *limiter) locked(keys ...string) time.Duration {
	now := time.Now()
	l.mu.Lock()
	defer l.mu.Unlock()
	var wait time.Duration
	for _, k := range keys {
		if a, ok := l.m[k]; ok && now.Before(a.lockedUntil) {
			wait = max(wait, a.lockedUntil.Sub(now))
		}
	}
	return wait
}

func (l *limiter) fail(limit int, keys ...string) {
	now := time.Now()
	l.mu.Lock()
	defer l.mu.Unlock()
	for _, k := range keys {
		a, ok := l.m[k]
		if !ok || now.Sub(a.first) > failWindow {
			a = &attempts{first: now}
			l.m[k] = a
		}
		a.failures++
		if a.failures >= limit {
			a.lockedUntil = now.Add(lockout)
		}
	}
}

func (l *limiter) reset(key string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	delete(l.m, key)
}
