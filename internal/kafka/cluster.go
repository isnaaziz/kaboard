package kafka

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"errors"
	"fmt"
	"regexp"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/twmb/franz-go/pkg/kadm"
	"github.com/twmb/franz-go/pkg/kgo"
	"github.com/twmb/franz-go/pkg/sasl"
	"github.com/twmb/franz-go/pkg/sasl/plain"
	"github.com/twmb/franz-go/pkg/sasl/scram"

	"kaboard/internal/store"
)

var (
	ErrNotFound = errors.New("not found")
	ErrConflict = errors.New("conflict")
	ErrInvalid  = errors.New("invalid request")
)

var validName = regexp.MustCompile(`^[A-Za-z0-9._-]{1,64}$`)

type Cluster struct {
	Name     string
	ReadOnly bool
	opts     []kgo.Opt
	client   *kgo.Client
	admin    *kadm.Client
	monitor  *monitor
	ctx      context.Context
	cancel   context.CancelFunc
}

type Registry struct {
	mu       sync.RWMutex
	store    *store.Store
	clusters map[string]*Cluster
}

func NewRegistry(st *store.Store) (*Registry, error) {
	r := &Registry{store: st, clusters: map[string]*Cluster{}}
	for _, cfg := range st.All() {
		c, err := dial(cfg)
		if err != nil {
			r.Close()
			return nil, fmt.Errorf("cluster %q: %w", cfg.Name, err)
		}
		r.clusters[cfg.Name] = c
	}
	return r, nil
}

func (r *Registry) Get(name string) (*Cluster, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	c, ok := r.clusters[name]
	return c, ok
}

func (r *Registry) List() []store.Cluster {
	all := r.store.All()
	for i := range all {
		all[i] = all[i].Masked()
	}
	return all
}

func (r *Registry) Save(original string, cfg store.Cluster) (store.Cluster, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	cfg, err := r.prepare(original, cfg)
	if err != nil {
		return store.Cluster{}, err
	}
	if _, taken := r.clusters[cfg.Name]; taken && cfg.Name != original {
		return store.Cluster{}, fmt.Errorf("%w: cluster %q already exists", ErrConflict, cfg.Name)
	}
	c, err := dial(cfg)
	if err != nil {
		return store.Cluster{}, fmt.Errorf("%w: %v", ErrInvalid, err)
	}
	if err := r.store.Put(original, cfg); err != nil {
		c.close()
		return store.Cluster{}, err
	}
	if old, ok := r.clusters[original]; ok {
		old.close()
		delete(r.clusters, original)
	}
	r.clusters[cfg.Name] = c
	return cfg.Masked(), nil
}

func (r *Registry) Delete(name string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	c, ok := r.clusters[name]
	if !ok {
		return fmt.Errorf("%w: cluster %q", ErrNotFound, name)
	}
	if err := r.store.Delete(name); err != nil {
		return err
	}
	c.close()
	delete(r.clusters, name)
	return nil
}

func (r *Registry) Test(ctx context.Context, original string, cfg store.Cluster) (Overview, error) {
	r.mu.RLock()
	cfg, err := r.prepare(original, cfg)
	r.mu.RUnlock()
	if err != nil {
		return Overview{}, err
	}
	c, err := dial(cfg)
	if err != nil {
		return Overview{}, fmt.Errorf("%w: %v", ErrInvalid, err)
	}
	defer c.close()
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	return c.Overview(ctx)
}

func (r *Registry) Close() {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, c := range r.clusters {
		c.close()
	}
}

func (r *Registry) prepare(original string, cfg store.Cluster) (store.Cluster, error) {
	cfg.Name = strings.TrimSpace(cfg.Name)
	cfg.Brokers = slices.DeleteFunc(cfg.Brokers, func(b string) bool { return strings.TrimSpace(b) == "" })
	switch {
	case !validName.MatchString(cfg.Name):
		return cfg, fmt.Errorf("%w: name must be 1-64 chars of letters, digits, '.', '_' or '-'", ErrInvalid)
	case len(cfg.Brokers) == 0:
		return cfg, fmt.Errorf("%w: at least one broker is required", ErrInvalid)
	}
	if original == "" {
		return cfg, nil
	}
	old, ok := r.find(original)
	if !ok {
		return cfg, fmt.Errorf("%w: cluster %q", ErrNotFound, original)
	}
	return cfg.WithSecretsFrom(old), nil
}

func (r *Registry) find(name string) (store.Cluster, bool) {
	all := r.store.All()
	i := slices.IndexFunc(all, func(c store.Cluster) bool { return c.Name == name })
	if i < 0 {
		return store.Cluster{}, false
	}
	return all[i], true
}

func dial(cfg store.Cluster) (*Cluster, error) {
	opts, err := options(cfg)
	if err != nil {
		return nil, err
	}
	client, err := kgo.NewClient(append(slices.Clone(opts), kgo.RecordPartitioner(kgo.ManualPartitioner()))...)
	if err != nil {
		return nil, err
	}
	admin := kadm.NewClient(client)
	admin.SetTimeoutMillis(10_000)
	ctx, cancel := context.WithCancel(context.Background())
	c := &Cluster{Name: cfg.Name, ReadOnly: cfg.ReadOnly, opts: opts, client: client, admin: admin, ctx: ctx, cancel: cancel}
	c.monitor = &monitor{cluster: c}
	return c, nil
}

func (c *Cluster) close() {
	c.cancel()
	c.client.Close()
}

func (c *Cluster) consumer(extra ...kgo.Opt) (*kgo.Client, error) {
	return kgo.NewClient(append(slices.Clone(c.opts), extra...)...)
}

func options(cfg store.Cluster) ([]kgo.Opt, error) {
	opts := []kgo.Opt{
		kgo.SeedBrokers(cfg.Brokers...),
		kgo.ClientID("kaboard"),
		kgo.DialTimeout(5 * time.Second),
	}
	if cfg.TLS != nil && cfg.TLS.Enabled {
		tc, err := tlsConfig(cfg.TLS)
		if err != nil {
			return nil, err
		}
		opts = append(opts, kgo.DialTLSConfig(tc))
	}
	if cfg.SASL != nil && cfg.SASL.Mechanism != "" {
		m, err := mechanism(cfg.SASL)
		if err != nil {
			return nil, err
		}
		opts = append(opts, kgo.SASL(m))
	}
	return opts, nil
}

func mechanism(s *store.SASL) (sasl.Mechanism, error) {
	switch strings.ToUpper(s.Mechanism) {
	case "PLAIN":
		return plain.Auth{User: s.Username, Pass: s.Password}.AsMechanism(), nil
	case "SCRAM-SHA-256":
		return scram.Auth{User: s.Username, Pass: s.Password}.AsSha256Mechanism(), nil
	case "SCRAM-SHA-512":
		return scram.Auth{User: s.Username, Pass: s.Password}.AsSha512Mechanism(), nil
	}
	return nil, fmt.Errorf("unsupported sasl mechanism %q", s.Mechanism)
}

func tlsConfig(t *store.TLS) (*tls.Config, error) {
	tc := &tls.Config{MinVersion: tls.VersionTLS12, InsecureSkipVerify: t.InsecureSkipVerify}
	if t.CA != "" {
		pool := x509.NewCertPool()
		if !pool.AppendCertsFromPEM([]byte(t.CA)) {
			return nil, errors.New("no valid certificates in CA PEM")
		}
		tc.RootCAs = pool
	}
	if t.Cert != "" {
		cert, err := tls.X509KeyPair([]byte(t.Cert), []byte(t.Key))
		if err != nil {
			return nil, fmt.Errorf("client certificate: %w", err)
		}
		tc.Certificates = []tls.Certificate{cert}
	}
	return tc, nil
}
