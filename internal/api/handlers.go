package api

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"slices"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"kaboard/internal/auth"
	"kaboard/internal/kafka"
	"kaboard/internal/serde"
	"kaboard/internal/store"
)

func (s *Server) clusters(w http.ResponseWriter, r *http.Request) {
	p := principalFrom(r)
	visible := []store.Cluster{}
	for _, c := range s.reg.List() {
		if p.Can(c.Name, auth.RoleViewer) {
			visible = append(visible, c)
		}
	}
	writeJSON(w, http.StatusOK, visible)
}

func (s *Server) saveCluster(w http.ResponseWriter, r *http.Request) {
	cfg, err := decode[store.Cluster](r)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	original := chi.URLParam(r, "cluster")
	saved, err := s.reg.Save(original, cfg)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	annotate(r, saved.Name, strings.Join(saved.Brokers, ","))
	status := http.StatusOK
	if original == "" {
		status = http.StatusCreated
	}
	writeJSON(w, status, saved)
}

func (s *Server) deleteCluster(w http.ResponseWriter, r *http.Request) {
	if err := s.reg.Delete(chi.URLParam(r, "cluster")); err != nil {
		s.fail(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) testConnection(w http.ResponseWriter, r *http.Request) {
	req, err := decode[struct {
		Original string        `json:"original"`
		Cluster  store.Cluster `json:"cluster"`
	}](r)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	annotate(r, req.Cluster.Name, strings.Join(req.Cluster.Brokers, ","))
	start := time.Now()
	overview, err := s.reg.Test(r.Context(), req.Original, req.Cluster)
	if errors.Is(err, kafka.ErrInvalid) || errors.Is(err, kafka.ErrNotFound) {
		s.fail(w, r, err)
		return
	}
	result := map[string]any{"ok": err == nil, "latencyMs": time.Since(start).Milliseconds()}
	if err != nil {
		result["error"] = err.Error()
	} else {
		result["overview"] = overview
	}
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) formats(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, serde.Formats())
}

func overview(ctx context.Context, c *kafka.Cluster, _ *http.Request) (any, error) {
	return c.Overview(ctx)
}

func health(ctx context.Context, c *kafka.Cluster, _ *http.Request) (any, error) {
	return c.Health(ctx), nil
}

func topics(ctx context.Context, c *kafka.Cluster, _ *http.Request) (any, error) {
	return c.Topics(ctx)
}

func topic(ctx context.Context, c *kafka.Cluster, r *http.Request) (any, error) {
	return c.Topic(ctx, chi.URLParam(r, "topic"))
}

func createTopic(ctx context.Context, c *kafka.Cluster, r *http.Request) (any, error) {
	req, err := decode[kafka.CreateTopic](r)
	if err != nil {
		return nil, err
	}
	annotate(r, req.Name, fmt.Sprintf("partitions %d, replication %d", req.Partitions, req.Replication))
	if err := c.CreateTopic(ctx, req); err != nil {
		return nil, err
	}
	return c.Topic(ctx, req.Name)
}

func deleteTopic(ctx context.Context, c *kafka.Cluster, r *http.Request) (any, error) {
	return nil, c.DeleteTopic(ctx, chi.URLParam(r, "topic"))
}

func setPartitions(ctx context.Context, c *kafka.Cluster, r *http.Request) (any, error) {
	req, err := decode[struct {
		Partitions int `json:"partitions"`
	}](r)
	if err != nil {
		return nil, err
	}
	annotate(r, "", fmt.Sprintf("partitions → %d", req.Partitions))
	return nil, c.SetPartitions(ctx, chi.URLParam(r, "topic"), req.Partitions)
}

func throughput(ctx context.Context, c *kafka.Cluster, r *http.Request) (any, error) {
	return c.TopicThroughput(ctx, chi.URLParam(r, "topic")), nil
}

func purgeTopic(ctx context.Context, c *kafka.Cluster, r *http.Request) (any, error) {
	n, err := c.PurgeTopic(ctx, chi.URLParam(r, "topic"))
	if err != nil {
		return nil, err
	}
	annotate(r, "", fmt.Sprintf("%d messages purged", n))
	return map[string]int64{"purged": n}, nil
}

func alterConfigs(ctx context.Context, c *kafka.Cluster, r *http.Request) (any, error) {
	req, err := decode[map[string]*string](r)
	if err != nil {
		return nil, err
	}
	changes := make([]string, 0, len(req))
	for k, v := range req {
		if v == nil {
			changes = append(changes, k+" reset")
		} else {
			changes = append(changes, k+"="+*v)
		}
	}
	slices.Sort(changes)
	annotate(r, "", strings.Join(changes, ", "))
	return nil, c.AlterTopicConfigs(ctx, chi.URLParam(r, "topic"), req)
}

func produce(ctx context.Context, c *kafka.Cluster, r *http.Request) (any, error) {
	req, err := decode[[]kafka.ProduceRecord](r)
	if err != nil {
		return nil, err
	}
	annotate(r, "", fmt.Sprintf("%d records", len(req)))
	return c.Produce(ctx, chi.URLParam(r, "topic"), req)
}

func groups(ctx context.Context, c *kafka.Cluster, _ *http.Request) (any, error) {
	return c.Groups(ctx)
}

func group(ctx context.Context, c *kafka.Cluster, r *http.Request) (any, error) {
	return c.Group(ctx, chi.URLParam(r, "group"))
}

func deleteGroup(ctx context.Context, c *kafka.Cluster, r *http.Request) (any, error) {
	return nil, c.DeleteGroup(ctx, chi.URLParam(r, "group"))
}

func resetOffsets(ctx context.Context, c *kafka.Cluster, r *http.Request) (any, error) {
	req, err := decode[kafka.ResetOffsets](r)
	if err != nil {
		return nil, err
	}
	annotate(r, "", resetDetail(req))
	return nil, c.ResetOffsets(ctx, chi.URLParam(r, "group"), req)
}

func resetDetail(req kafka.ResetOffsets) string {
	target := req.Mode
	switch req.Mode {
	case "timestamp":
		target += " " + time.UnixMilli(req.Timestamp).UTC().Format(time.RFC3339)
	case "offset", "shift":
		target += fmt.Sprintf(" %d", req.Offset)
	}
	detail := fmt.Sprintf("topic %s → %s", req.Topic, target)
	if len(req.Partitions) > 0 {
		detail += fmt.Sprintf(" (partitions %v)", req.Partitions)
	}
	return detail
}
