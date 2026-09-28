package main

import (
	"context"
	"errors"
	"flag"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"kaboard/internal/api"
	"kaboard/internal/audit"
	"kaboard/internal/auth"
	"kaboard/internal/kafka"
	"kaboard/internal/secret"
	"kaboard/internal/store"
	"kaboard/web"
)

type config struct {
	addr, dataDir, secretKey, tlsCert, tlsKey string
	trustProxy, secureCookies                 bool
}

func main() {
	var cfg config
	flag.StringVar(&cfg.addr, "addr", envOr("KABOARD_ADDR", ":4411"), "listen address")
	flag.StringVar(&cfg.dataDir, "data", envOr("KABOARD_DATA", "data"), "data directory")
	flag.StringVar(&cfg.tlsCert, "tls-cert", os.Getenv("KABOARD_TLS_CERT"), "TLS certificate file")
	flag.StringVar(&cfg.tlsKey, "tls-key", os.Getenv("KABOARD_TLS_KEY"), "TLS key file")
	flag.BoolVar(&cfg.trustProxy, "trust-proxy", os.Getenv("KABOARD_TRUST_PROXY") == "true", "trust X-Forwarded-For from a reverse proxy")
	flag.BoolVar(&cfg.secureCookies, "secure-cookies", os.Getenv("KABOARD_SECURE_COOKIES") == "true", "mark session cookies Secure (behind HTTPS proxy)")
	flag.Parse()
	cfg.secretKey = os.Getenv("KABOARD_SECRET_KEY")

	log := slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: level()}))
	if err := run(cfg, log); err != nil {
		log.Error("fatal", "err", err)
		os.Exit(1)
	}
}

func run(cfg config, log *slog.Logger) error {
	box, generated, err := secret.Load(cfg.secretKey, filepath.Join(cfg.dataDir, "secret.key"))
	if err != nil {
		return err
	}
	if generated {
		log.Warn("generated data/secret.key for encrypting cluster credentials; set KABOARD_SECRET_KEY to manage the key outside the data directory")
	}
	clusters, err := store.Open(filepath.Join(cfg.dataDir, "clusters.json"), box)
	if err != nil {
		return err
	}
	if err := bootstrap(clusters); err != nil {
		return err
	}
	users, err := store.OpenUsers(filepath.Join(cfg.dataDir, "users.json"))
	if err != nil {
		return err
	}
	auditLog, err := audit.Open(filepath.Join(cfg.dataDir, "audit.log"))
	if err != nil {
		return err
	}
	defer auditLog.Close()
	reg, err := kafka.NewRegistry(clusters)
	if err != nil {
		return err
	}
	defer reg.Close()
	static, err := web.FS()
	if err != nil {
		return err
	}

	authService := auth.New(users)
	if authService.SetupRequired() {
		log.Warn("no users yet: open Kaboard in a browser to create the first admin account")
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	tlsEnabled := cfg.tlsCert != "" && cfg.tlsKey != ""
	srv := &http.Server{
		Addr: cfg.addr,
		Handler: api.New(api.Options{
			Registry: reg, Auth: authService, Audit: auditLog, Static: static, Log: log,
			TrustProxy: cfg.trustProxy, SecureCookies: cfg.secureCookies || tlsEnabled,
		}),
		ReadHeaderTimeout: 10 * time.Second,
		BaseContext:       func(net.Listener) context.Context { return ctx },
	}
	errc := make(chan error, 1)
	go func() {
		log.Info("kaboard listening", "addr", cfg.addr, "tls", tlsEnabled, "data", cfg.dataDir, "clusters", len(clusters.All()))
		if tlsEnabled {
			errc <- srv.ListenAndServeTLS(cfg.tlsCert, cfg.tlsKey)
		} else {
			errc <- srv.ListenAndServe()
		}
	}()

	select {
	case err := <-errc:
		if !errors.Is(err, http.ErrServerClosed) {
			return err
		}
	case <-ctx.Done():
	}
	shutdown, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	return srv.Shutdown(shutdown)
}

func bootstrap(st *store.Store) error {
	brokers := os.Getenv("KAFKA_BROKERS")
	if brokers == "" || len(st.All()) > 0 {
		return nil
	}
	return st.Put("", store.Cluster{Name: envOr("KAFKA_CLUSTER_NAME", "local"), Brokers: strings.Split(brokers, ",")})
}

func level() slog.Level {
	var l slog.Level
	if err := l.UnmarshalText([]byte(os.Getenv("KABOARD_LOG_LEVEL"))); err != nil {
		return slog.LevelInfo
	}
	return l
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
