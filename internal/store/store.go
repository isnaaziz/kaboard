package store

import (
	"slices"
	"sync"

	"kaboard/internal/secret"
)

type Cluster struct {
	Name     string   `json:"name"`
	Brokers  []string `json:"brokers"`
	ReadOnly bool     `json:"readOnly"`
	SASL     *SASL    `json:"sasl,omitempty"`
	TLS      *TLS     `json:"tls,omitempty"`
}

type SASL struct {
	Mechanism string `json:"mechanism"`
	Username  string `json:"username"`
	Password  string `json:"password,omitempty"`
}

type TLS struct {
	Enabled            bool   `json:"enabled"`
	InsecureSkipVerify bool   `json:"insecureSkipVerify"`
	CA                 string `json:"ca,omitempty"`
	Cert               string `json:"cert,omitempty"`
	Key                string `json:"key,omitempty"`
}

func (c Cluster) Masked() Cluster {
	return c.mapSecrets(func(string) string { return "" })
}

func (c Cluster) WithSecretsFrom(old Cluster) Cluster {
	if c.SASL != nil && c.SASL.Password == "" && old.SASL != nil {
		s := *c.SASL
		s.Password = old.SASL.Password
		c.SASL = &s
	}
	if c.TLS != nil && c.TLS.Key == "" && old.TLS != nil {
		t := *c.TLS
		t.Key = old.TLS.Key
		c.TLS = &t
	}
	return c
}

func (c Cluster) mapSecrets(fn func(string) string) Cluster {
	if c.SASL != nil {
		s := *c.SASL
		s.Password = fn(s.Password)
		c.SASL = &s
	}
	if c.TLS != nil {
		t := *c.TLS
		t.Key = fn(t.Key)
		c.TLS = &t
	}
	return c
}

type Store struct {
	mu       sync.Mutex
	path     string
	box      *secret.Box
	clusters []Cluster
}

func Open(path string, box *secret.Box) (*Store, error) {
	s := &Store{path: path, box: box}
	var stored []Cluster
	if err := readJSON(path, &stored); err != nil {
		return nil, err
	}
	plaintext := false
	var openErr error
	for _, c := range stored {
		s.clusters = append(s.clusters, c.mapSecrets(func(v string) string {
			plain, wasPlain, err := box.Open(v)
			plaintext = plaintext || wasPlain
			openErr = cmpErr(openErr, err)
			return plain
		}))
	}
	if openErr != nil {
		return nil, openErr
	}
	if plaintext {
		return s, s.persist(s.clusters)
	}
	return s, nil
}

func (s *Store) All() []Cluster {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]Cluster{}, s.clusters...)
}

func (s *Store) Put(original string, c Cluster) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	next := slices.Clone(s.clusters)
	if i := s.index(original); i >= 0 {
		next[i] = c
	} else {
		next = append(next, c)
	}
	return s.persist(next)
}

func (s *Store) Delete(name string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	i := s.index(name)
	if i < 0 {
		return nil
	}
	return s.persist(slices.Delete(slices.Clone(s.clusters), i, i+1))
}

func (s *Store) index(name string) int {
	return slices.IndexFunc(s.clusters, func(c Cluster) bool { return c.Name == name })
}

func (s *Store) persist(clusters []Cluster) error {
	sealed := make([]Cluster, len(clusters))
	var sealErr error
	for i, c := range clusters {
		sealed[i] = c.mapSecrets(func(v string) string {
			enc, err := s.box.Seal(v)
			sealErr = cmpErr(sealErr, err)
			return enc
		})
	}
	if sealErr != nil {
		return sealErr
	}
	if err := writeJSON(s.path, sealed); err != nil {
		return err
	}
	s.clusters = clusters
	return nil
}

func cmpErr(current, next error) error {
	if current != nil {
		return current
	}
	return next
}
