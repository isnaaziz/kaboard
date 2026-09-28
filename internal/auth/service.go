package auth

import (
	"errors"
	"fmt"
	"regexp"
	"slices"
	"strings"
	"sync"
	"time"

	"kaboard/internal/store"
)

var (
	ErrInvalid     = errors.New("invalid request")
	ErrNotFound    = errors.New("not found")
	ErrConflict    = errors.New("conflict")
	ErrCredentials = errors.New("invalid username or password")
	ErrForbidden   = errors.New("forbidden")
)

type LockedError struct{ RetryAfter time.Duration }

func (e LockedError) Error() string {
	return fmt.Sprintf("too many failed attempts, try again in %s", e.RetryAfter.Round(time.Minute))
}

const (
	minPassword = 10
	maxPassword = 128
	ipFailures  = 20
)

var validUsername = regexp.MustCompile(`^[A-Za-z0-9._@+-]{3,64}$`)

type UserView struct {
	Username  string          `json:"username"`
	Role      Role            `json:"role"`
	Clusters  map[string]Role `json:"clusters"`
	Disabled  bool            `json:"disabled"`
	CreatedAt time.Time       `json:"createdAt"`
	UpdatedAt time.Time       `json:"updatedAt"`
}

type UserInput struct {
	Username string          `json:"username"`
	Password string          `json:"password"`
	Role     Role            `json:"role"`
	Clusters map[string]Role `json:"clusters"`
	Disabled bool            `json:"disabled"`
}

type Service struct {
	users    *store.Users
	sessions *sessions
	limiter  *limiter
	setupMu  sync.Mutex
}

func New(users *store.Users) *Service {
	return &Service{users: users, sessions: newSessions(), limiter: newLimiter()}
}

func (s *Service) SetupRequired() bool {
	return len(s.users.All()) == 0
}

func (s *Service) Setup(username, password string) (string, Principal, error) {
	s.setupMu.Lock()
	defer s.setupMu.Unlock()
	if !s.SetupRequired() {
		return "", Principal{}, fmt.Errorf("%w: setup already completed", ErrConflict)
	}
	if _, err := s.Create(UserInput{Username: username, Password: password, Role: RoleAdmin}); err != nil {
		return "", Principal{}, err
	}
	return s.startSession(username)
}

func (s *Service) Login(username, password, ip string) (string, Principal, error) {
	userKey := "user|" + strings.ToLower(username) + "|" + ip
	ipKey := "ip|" + ip
	if wait := s.limiter.locked(userKey, ipKey); wait > 0 {
		return "", Principal{}, LockedError{RetryAfter: wait}
	}
	u, ok := s.users.Get(username)
	hash := dummyHash
	if ok {
		hash = u.PasswordHash
	}
	if !verifyPassword(hash, password) || !ok || u.Disabled {
		s.limiter.fail(maxFailures, userKey)
		s.limiter.fail(ipFailures, ipKey)
		return "", Principal{}, ErrCredentials
	}
	s.limiter.reset(userKey)
	return s.startSession(u.Username)
}

func (s *Service) Authenticate(token string) (Principal, bool) {
	if token == "" {
		return Principal{}, false
	}
	name, ok := s.sessions.touch(token)
	if !ok {
		return Principal{}, false
	}
	u, ok := s.users.Get(name)
	if !ok || u.Disabled {
		s.sessions.revoke(token)
		return Principal{}, false
	}
	return principal(u), true
}

func (s *Service) Logout(token string) {
	s.sessions.revoke(token)
}

func (s *Service) ChangePassword(username, current, next, keepToken string) error {
	u, ok := s.users.Get(username)
	if !ok || !verifyPassword(u.PasswordHash, current) {
		return fmt.Errorf("%w: current password is incorrect", ErrInvalid)
	}
	if err := checkPassword(next); err != nil {
		return err
	}
	hash, err := hashPassword(next)
	if err != nil {
		return err
	}
	err = s.users.Update(func(all []store.User) ([]store.User, error) {
		i := index(all, username)
		if i < 0 {
			return nil, ErrNotFound
		}
		now := time.Now()
		all[i].PasswordHash, all[i].PasswordChangedAt, all[i].UpdatedAt = hash, now, now
		return all, nil
	})
	if err == nil {
		s.sessions.revokeUser(username, keepToken)
	}
	return err
}

func (s *Service) List() []UserView {
	all := s.users.All()
	out := make([]UserView, len(all))
	for i, u := range all {
		out[i] = view(u)
	}
	slices.SortFunc(out, func(a, b UserView) int {
		return strings.Compare(strings.ToLower(a.Username), strings.ToLower(b.Username))
	})
	return out
}

func (s *Service) Create(in UserInput) (UserView, error) {
	if !validUsername.MatchString(in.Username) {
		return UserView{}, fmt.Errorf("%w: username must be 3-64 characters: letters, digits or . _ - @ + (an email address works)", ErrInvalid)
	}
	if err := checkPassword(in.Password); err != nil {
		return UserView{}, err
	}
	if err := checkRoles(in); err != nil {
		return UserView{}, err
	}
	hash, err := hashPassword(in.Password)
	if err != nil {
		return UserView{}, err
	}
	now := time.Now()
	u := store.User{
		Username: in.Username, PasswordHash: hash, Role: string(in.Role), Clusters: toStrings(in.Clusters),
		Disabled: in.Disabled, CreatedAt: now, UpdatedAt: now, PasswordChangedAt: now,
	}
	err = s.users.Update(func(all []store.User) ([]store.User, error) {
		if index(all, in.Username) >= 0 {
			return nil, fmt.Errorf("%w: user %q already exists", ErrConflict, in.Username)
		}
		return append(all, u), nil
	})
	return view(u), err
}

func (s *Service) Update(username string, in UserInput, actor string) (UserView, error) {
	if err := checkRoles(in); err != nil {
		return UserView{}, err
	}
	var hash string
	if in.Password != "" {
		if err := checkPassword(in.Password); err != nil {
			return UserView{}, err
		}
		h, err := hashPassword(in.Password)
		if err != nil {
			return UserView{}, err
		}
		hash = h
	}
	if strings.EqualFold(username, actor) && (in.Disabled || in.Role != RoleAdmin) {
		return UserView{}, fmt.Errorf("%w: you cannot demote or disable your own account", ErrConflict)
	}
	var updated store.User
	err := s.users.Update(func(all []store.User) ([]store.User, error) {
		i := index(all, username)
		if i < 0 {
			return nil, fmt.Errorf("%w: user %q", ErrNotFound, username)
		}
		now := time.Now()
		all[i].Role, all[i].Clusters, all[i].Disabled, all[i].UpdatedAt = string(in.Role), toStrings(in.Clusters), in.Disabled, now
		if hash != "" {
			all[i].PasswordHash, all[i].PasswordChangedAt = hash, now
		}
		updated = all[i]
		return all, requireAdmin(all)
	})
	if err != nil {
		return UserView{}, err
	}
	if hash != "" || in.Disabled {
		s.sessions.revokeUser(username, "")
	}
	return view(updated), nil
}

func (s *Service) Delete(username, actor string) error {
	if strings.EqualFold(username, actor) {
		return fmt.Errorf("%w: you cannot delete your own account", ErrConflict)
	}
	err := s.users.Update(func(all []store.User) ([]store.User, error) {
		i := index(all, username)
		if i < 0 {
			return nil, fmt.Errorf("%w: user %q", ErrNotFound, username)
		}
		all = slices.Delete(all, i, i+1)
		return all, requireAdmin(all)
	})
	if err == nil {
		s.sessions.revokeUser(username, "")
	}
	return err
}

func (s *Service) startSession(username string) (string, Principal, error) {
	u, ok := s.users.Get(username)
	if !ok {
		return "", Principal{}, ErrNotFound
	}
	token, err := s.sessions.create(u.Username)
	return token, principal(u), err
}

func checkPassword(p string) error {
	if len(p) < minPassword || len(p) > maxPassword {
		return fmt.Errorf("%w: password must be %d-%d characters", ErrInvalid, minPassword, maxPassword)
	}
	return nil
}

func checkRoles(in UserInput) error {
	if !in.Role.valid() || in.Role == RoleNone {
		return fmt.Errorf("%w: role must be viewer, operator or admin", ErrInvalid)
	}
	for cluster, r := range in.Clusters {
		if !r.valid() {
			return fmt.Errorf("%w: invalid role %q for cluster %q", ErrInvalid, r, cluster)
		}
	}
	return nil
}

func requireAdmin(all []store.User) error {
	for _, u := range all {
		if u.Role == string(RoleAdmin) && !u.Disabled {
			return nil
		}
	}
	return fmt.Errorf("%w: at least one active admin is required", ErrConflict)
}

func index(all []store.User, name string) int {
	return slices.IndexFunc(all, func(u store.User) bool { return strings.EqualFold(u.Username, name) })
}

func principal(u store.User) Principal {
	return Principal{Username: u.Username, Role: Role(u.Role), Clusters: toRoles(u.Clusters)}
}

func view(u store.User) UserView {
	return UserView{Username: u.Username, Role: Role(u.Role), Clusters: toRoles(u.Clusters), Disabled: u.Disabled, CreatedAt: u.CreatedAt, UpdatedAt: u.UpdatedAt}
}

func toRoles(m map[string]string) map[string]Role {
	out := make(map[string]Role, len(m))
	for k, v := range m {
		out[k] = Role(v)
	}
	return out
}

func toStrings(m map[string]Role) map[string]string {
	if len(m) == 0 {
		return nil
	}
	out := make(map[string]string, len(m))
	for k, v := range m {
		out[k] = string(v)
	}
	return out
}
