package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"kaboard/internal/filter"
	"kaboard/internal/kafka"
)

const (
	browseTimeout = time.Minute
	tailTimeout   = 30 * time.Minute
	defaultLimit  = 100
	maxLimit      = 10_000
	defaultScan   = 20_000
	maxScan       = 10_000_000
)

type sse struct {
	w  http.ResponseWriter
	rc *http.ResponseController
}

func (s *sse) send(event string, v any) error {
	data, err := json.Marshal(v)
	if err != nil {
		return err
	}
	_, err = fmt.Fprintf(s.w, "event: %s\ndata: %s\n\n", event, data)
	return err
}

func (s *sse) Message(m kafka.Message) error   { return s.send("message", m) }
func (s *sse) Progress(p kafka.Progress) error { return s.send("progress", p) }
func (s *sse) Flush() error                    { return s.rc.Flush() }

func (s *Server) browse(w http.ResponseWriter, r *http.Request) {
	req, err := browseRequest(chi.URLParam(r, "topic"), r.URL.Query())
	if err != nil {
		s.fail(w, r, err)
		return
	}
	detail := req.Mode
	if f := r.URL.Query().Get("filter"); f != "" {
		detail += ", filter " + f
	}
	annotate(r, "", detail)
	timeout := browseTimeout
	if req.Mode == kafka.ModeTail {
		timeout = tailTimeout
	}
	ctx, cancel := context.WithTimeout(r.Context(), timeout)
	defer cancel()

	h := w.Header()
	h.Set("Content-Type", "text/event-stream")
	h.Set("Cache-Control", "no-cache")
	h.Set("Connection", "keep-alive")
	h.Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)

	stream := &sse{w: w, rc: http.NewResponseController(w)}
	_ = stream.Flush()
	if err := clusterFrom(r).Browse(ctx, req, stream); err != nil && !errors.Is(err, context.Canceled) {
		_ = stream.send("failure", map[string]string{"error": err.Error()})
	}
	_ = stream.send("done", struct{}{})
	_ = stream.Flush()
}

func browseRequest(topic string, q url.Values) (kafka.BrowseRequest, error) {
	req := kafka.BrowseRequest{
		Topic:       topic,
		Mode:        q.Get("mode"),
		KeyFormat:   q.Get("keyFormat"),
		ValueFormat: q.Get("valueFormat"),
		Limit:       defaultLimit,
		ScanLimit:   defaultScan,
	}
	switch req.Mode {
	case "":
		req.Mode = kafka.ModeNewest
	case kafka.ModeNewest, kafka.ModeOldest, kafka.ModeOffset, kafka.ModeTimestamp, kafka.ModeTail:
	default:
		return req, invalid("unknown mode %q", req.Mode)
	}
	var err error
	for _, p := range []struct {
		name string
		dst  *int64
	}{{"offset", &req.Offset}, {"timestamp", &req.Timestamp}, {"scanLimit", &req.ScanLimit}} {
		if v := q.Get(p.name); v != "" {
			if *p.dst, err = strconv.ParseInt(v, 10, 64); err != nil {
				return req, invalid("%s: %v", p.name, err)
			}
		}
	}
	if v := q.Get("limit"); v != "" {
		if req.Limit, err = strconv.Atoi(v); err != nil || req.Limit <= 0 {
			return req, invalid("limit must be a positive integer")
		}
	}
	req.Limit = min(req.Limit, maxLimit)
	req.ScanLimit = min(max(req.ScanLimit, 1), maxScan)
	if v := q.Get("partitions"); v != "" {
		for _, s := range strings.Split(v, ",") {
			p, err := strconv.ParseInt(strings.TrimSpace(s), 10, 32)
			if err != nil {
				return req, invalid("partitions: %v", err)
			}
			req.Partitions = append(req.Partitions, int32(p))
		}
	}
	if req.Filter, err = filter.Compile(q.Get("filter")); err != nil {
		return req, invalid("filter: %v", err)
	}
	return req, nil
}

func invalid(format string, args ...any) error {
	return fmt.Errorf("%w: %s", kafka.ErrInvalid, fmt.Sprintf(format, args...))
}
