package store

import (
	"slices"
	"strings"
	"sync"
	"time"
)

type User struct {
	Username          string            `json:"username"`
	PasswordHash      string            `json:"passwordHash"`
	Role              string            `json:"role"`
	Clusters          map[string]string `json:"clusters,omitempty"`
	Disabled          bool              `json:"disabled"`
	CreatedAt         time.Time         `json:"createdAt"`
	UpdatedAt         time.Time         `json:"updatedAt"`
	PasswordChangedAt time.Time         `json:"passwordChangedAt"`
}

type Users struct {
	mu    sync.Mutex
	path  string
	users []User
}

func OpenUsers(path string) (*Users, error) {
	u := &Users{path: path}
	return u, readJSON(path, &u.users)
}

func (u *Users) All() []User {
	u.mu.Lock()
	defer u.mu.Unlock()
	return append([]User{}, u.users...)
}

func (u *Users) Get(name string) (User, bool) {
	u.mu.Lock()
	defer u.mu.Unlock()
	if i := u.index(name); i >= 0 {
		return u.users[i], true
	}
	return User{}, false
}

func (u *Users) Update(fn func([]User) ([]User, error)) error {
	u.mu.Lock()
	defer u.mu.Unlock()
	next, err := fn(slices.Clone(u.users))
	if err != nil {
		return err
	}
	if err := writeJSON(u.path, next); err != nil {
		return err
	}
	u.users = next
	return nil
}

func (u *Users) index(name string) int {
	return slices.IndexFunc(u.users, func(x User) bool { return strings.EqualFold(x.Username, name) })
}
