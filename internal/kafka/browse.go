package kafka

import (
	"cmp"
	"context"
	"errors"
	"math"
	"slices"
	"time"

	"github.com/twmb/franz-go/pkg/kadm"
	"github.com/twmb/franz-go/pkg/kgo"

	"kaboard/internal/filter"
	"kaboard/internal/serde"
)

const (
	ModeNewest    = "newest"
	ModeOldest    = "oldest"
	ModeOffset    = "offset"
	ModeTimestamp = "timestamp"
	ModeTail      = "tail"

	idleTimeout      = 20 * time.Second
	bytesPerRecord   = 1 << 10
	minFetchBytes    = 256 << 10
	maxFetchBytes    = 4 << 20
	progressInterval = 250 * time.Millisecond
)

type BrowseRequest struct {
	Topic       string
	Mode        string
	Offset      int64
	Timestamp   int64
	Partitions  []int32
	Limit       int
	ScanLimit   int64
	KeyFormat   string
	ValueFormat string
	Filter      *filter.Filter
}

type Header struct {
	Key   string `json:"key"`
	Value string `json:"value"`
}

type Message struct {
	Partition int32         `json:"partition"`
	Offset    int64         `json:"offset"`
	Timestamp int64         `json:"timestamp"`
	Key       serde.Payload `json:"key"`
	Value     serde.Payload `json:"value"`
	Headers   []Header      `json:"headers"`
}

type PartitionProgress struct {
	Partition int32 `json:"partition"`
	From      int64 `json:"from"`
	To        int64 `json:"to"`
	Current   int64 `json:"current"`
	Done      bool  `json:"done"`
}

type Progress struct {
	Scanned    int64               `json:"scanned"`
	Matched    int                 `json:"matched"`
	Partitions []PartitionProgress `json:"partitions"`
}

type Sink interface {
	Message(Message) error
	Progress(Progress) error
	Flush() error
}

type browser struct {
	req      BrowseRequest
	sink     Sink
	client   *kgo.Client
	spans    map[int32]*PartitionProgress
	scanned  int64
	matched  int
	buffer   []Message
	stopped  bool
	reported time.Time
}

func (c *Cluster) Browse(ctx context.Context, req BrowseRequest, sink Sink) error {
	spans, err := c.spans(ctx, req)
	if err != nil {
		return err
	}
	b := &browser{req: req, sink: sink, spans: spans}
	offsets := map[int32]kgo.Offset{}
	for p, s := range spans {
		if !s.Done {
			offsets[p] = kgo.NewOffset().At(s.From)
		}
	}
	if len(offsets) == 0 {
		return sink.Progress(b.progress())
	}
	b.client, err = c.consumer(
		kgo.ConsumePartitions(map[string]map[int32]kgo.Offset{req.Topic: offsets}),
		kgo.FetchMaxWait(500*time.Millisecond),
		kgo.FetchMaxPartitionBytes(fetchBytes(req, spans)),
		kgo.KeepControlRecords(),
	)
	if err != nil {
		return err
	}
	defer b.client.Close()
	return b.run(ctx)
}

func (c *Cluster) spans(ctx context.Context, req BrowseRequest) (map[int32]*PartitionProgress, error) {
	starts, ends, err := c.watermarks(ctx, req.Topic)
	if err != nil {
		return nil, err
	}
	if len(ends[req.Topic]) == 0 {
		return nil, notFound("topic", req.Topic, nil)
	}
	var at kadm.ListedOffsets
	if req.Mode == ModeTimestamp {
		if at, err = c.admin.ListOffsetsAfterMilli(ctx, req.Timestamp, req.Topic); err != nil {
			return nil, err
		}
	}
	selected := len(ends[req.Topic])
	if len(req.Partitions) > 0 {
		selected = len(req.Partitions)
	}
	spans := map[int32]*PartitionProgress{}
	for p, end := range ends[req.Topic] {
		if len(req.Partitions) > 0 && !slices.Contains(req.Partitions, p) {
			continue
		}
		start, _ := starts.Lookup(req.Topic, p)
		lo, hi := start.Offset, end.Offset
		s := &PartitionProgress{Partition: p, To: hi}
		switch req.Mode {
		case ModeOldest:
			s.From = lo
		case ModeOffset:
			s.From = clamp(req.Offset, lo, hi)
		case ModeTimestamp:
			s.From = hi
			if o, ok := at.Lookup(req.Topic, p); ok && o.Err == nil && o.Offset >= 0 {
				s.From = clamp(o.Offset, lo, hi)
			}
		case ModeTail:
			s.From, s.To = hi, math.MaxInt64
		default:
			window := int64(req.Limit)
			if req.Filter != nil {
				window = max(window, req.ScanLimit/int64(selected))
			}
			s.From = max(lo, hi-window)
		}
		s.Current, s.Done = s.From, s.From >= s.To
		spans[p] = s
	}
	return spans, nil
}

func (b *browser) run(ctx context.Context) error {
	active := time.Now()
	for !b.finished() {
		pollCtx, cancel := context.WithTimeout(ctx, time.Second)
		fetches := b.client.PollFetches(pollCtx)
		cancel()
		if ctx.Err() != nil {
			break
		}
		if err := fetchError(fetches); err != nil {
			return err
		}
		if fetches.NumRecords() > 0 {
			active = time.Now()
		} else if b.req.Mode != ModeTail && time.Since(active) > idleTimeout {
			break
		}
		var err error
		fetches.EachRecord(func(r *kgo.Record) {
			if err == nil && !b.stopped {
				err = b.consume(ctx, r)
			}
		})
		if err != nil {
			return err
		}
		if time.Since(b.reported) >= progressInterval {
			if err := b.report(); err != nil {
				return err
			}
		}
		if err := b.sink.Flush(); err != nil {
			return err
		}
	}
	return b.flush()
}

func (b *browser) consume(ctx context.Context, r *kgo.Record) error {
	s := b.spans[r.Partition]
	if s == nil || s.Done {
		return nil
	}
	if r.Offset >= s.To {
		b.done(s)
		return nil
	}
	s.Current = r.Offset + 1
	if s.Current >= s.To {
		b.done(s)
	}
	if r.Attrs.IsControl() {
		return nil
	}
	b.scanned++
	msg := b.decode(r)
	if b.req.Filter == nil || b.req.Filter.Match(ctx, record(msg)) {
		b.matched++
		if b.req.Mode == ModeNewest {
			b.buffer = append(b.buffer, msg)
			if len(b.buffer) >= 2*b.req.Limit {
				b.trim()
			}
		} else if err := b.sink.Message(msg); err != nil {
			return err
		}
	}
	if b.req.Mode != ModeNewest && b.req.Mode != ModeTail && b.matched >= b.req.Limit {
		b.stopped = true
	}
	if b.req.ScanLimit > 0 && b.scanned >= b.req.ScanLimit && b.req.Mode != ModeTail {
		b.stopped = true
	}
	return nil
}

func fetchBytes(req BrowseRequest, spans map[int32]*PartitionProgress) int32 {
	need := int64(req.Limit)
	if req.Mode == ModeNewest {
		for _, s := range spans {
			need = max(need, s.To-s.From)
		}
	}
	return int32(clamp(need*bytesPerRecord, minFetchBytes, maxFetchBytes))
}

func (b *browser) done(s *PartitionProgress) {
	s.Done = true
	b.client.PauseFetchPartitions(map[string][]int32{b.req.Topic: {s.Partition}})
}

func (b *browser) finished() bool {
	if b.stopped {
		return true
	}
	for _, s := range b.spans {
		if !s.Done {
			return false
		}
	}
	return true
}

func (b *browser) trim() {
	slices.SortFunc(b.buffer, func(x, y Message) int {
		return cmp.Or(cmp.Compare(y.Timestamp, x.Timestamp), cmp.Compare(x.Partition, y.Partition), cmp.Compare(y.Offset, x.Offset))
	})
	b.buffer = b.buffer[:min(len(b.buffer), b.req.Limit)]
}

func (b *browser) flush() error {
	if b.req.Mode == ModeNewest {
		b.trim()
		for _, m := range b.buffer {
			if err := b.sink.Message(m); err != nil {
				return err
			}
		}
	}
	return b.report()
}

func (b *browser) report() error {
	b.reported = time.Now()
	if err := b.sink.Progress(b.progress()); err != nil {
		return err
	}
	return b.sink.Flush()
}

func (b *browser) progress() Progress {
	p := Progress{Scanned: b.scanned, Matched: b.matched, Partitions: make([]PartitionProgress, 0, len(b.spans))}
	for _, s := range b.spans {
		p.Partitions = append(p.Partitions, *s)
	}
	slices.SortFunc(p.Partitions, func(x, y PartitionProgress) int { return cmp.Compare(x.Partition, y.Partition) })
	return p
}

func (b *browser) decode(r *kgo.Record) Message {
	headers := make([]Header, len(r.Headers))
	for i, h := range r.Headers {
		headers[i] = Header{Key: h.Key, Value: serde.Decode(h.Value, serde.String).Text}
	}
	return Message{
		Partition: r.Partition,
		Offset:    r.Offset,
		Timestamp: r.Timestamp.UnixMilli(),
		Key:       serde.Decode(r.Key, b.req.KeyFormat),
		Value:     serde.Decode(r.Value, b.req.ValueFormat),
		Headers:   headers,
	}
}

func record(m Message) filter.Record {
	headers := make(map[string]string, len(m.Headers))
	for _, h := range m.Headers {
		headers[h.Key] = h.Value
	}
	return filter.Record{
		Key: m.Key.Value(), Value: m.Value.Value(), Raw: m.Value.Text, Headers: headers,
		Partition: m.Partition, Offset: m.Offset, Timestamp: m.Timestamp, Size: m.Value.Size,
	}
}

func fetchError(f kgo.Fetches) error {
	var err error
	f.EachError(func(_ string, _ int32, e error) {
		if err == nil && !errors.Is(e, context.Canceled) && !errors.Is(e, context.DeadlineExceeded) && !errors.Is(e, kgo.ErrClientClosed) {
			err = e
		}
	})
	return err
}
