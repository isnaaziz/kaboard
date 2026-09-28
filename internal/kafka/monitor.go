package kafka

import (
	"cmp"
	"context"
	"fmt"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/twmb/franz-go/pkg/kadm"
)

const (
	sampleEvery   = 5 * time.Second
	sampleTimeout = 10 * time.Second
	historySize   = 720
	trendWindow   = 12
	idleAfter     = 10 * time.Minute
	lagThreshold  = 1000
	maxCells      = 2000
	topTopics     = 10
)

const (
	StatusGood     = "good"
	StatusWarning  = "warning"
	StatusCritical = "critical"
)

type Point struct {
	T        int64   `json:"t"`
	Produced float64 `json:"produced"`
	Consumed float64 `json:"consumed"`
	Lag      int64   `json:"lag"`
}

type Check struct {
	ID     string `json:"id"`
	Status string `json:"status"`
	Title  string `json:"title"`
	Detail string `json:"detail"`
}

type TopicRate struct {
	Name            string  `json:"name"`
	Rate            float64 `json:"rate"`
	Partitions      int     `json:"partitions"`
	UnderReplicated int     `json:"underReplicated"`
	Offline         int     `json:"offline"`
}

type GroupHealth struct {
	Name     string  `json:"name"`
	State    string  `json:"state"`
	Members  int     `json:"members"`
	Lag      int64   `json:"lag"`
	LagDelta int64   `json:"lagDelta"`
	Rate     float64 `json:"rate"`
}

type PartitionCell struct {
	Topic     string `json:"topic"`
	Partition int32  `json:"partition"`
	Leader    int32  `json:"leader"`
	Replicas  int    `json:"replicas"`
	ISR       int    `json:"isr"`
	Status    string `json:"status"`
}

type Health struct {
	Status          string          `json:"status"`
	UpdatedAt       int64           `json:"updatedAt"`
	Error           string          `json:"error,omitempty"`
	Brokers         int             `json:"brokers"`
	ExpectedBrokers int             `json:"expectedBrokers"`
	Controller      int32           `json:"controller"`
	Topics          int             `json:"topics"`
	Partitions      int             `json:"partitions"`
	UnderReplicated int             `json:"underReplicated"`
	Offline         int             `json:"offline"`
	Groups          int             `json:"groups"`
	Checks          []Check         `json:"checks"`
	Series          []Point         `json:"series"`
	TopTopics       []TopicRate     `json:"topTopics"`
	GroupList       []GroupHealth   `json:"groupList"`
	Cells           []PartitionCell `json:"cells"`
}

type sample struct {
	at        time.Time
	ends      map[string]int64
	committed map[string]int64
	lags      map[string]int64
}

type monitor struct {
	cluster    *Cluster
	mu         sync.Mutex
	running    bool
	lastAccess time.Time
	window     []sample
	series     []Point
	maxBrokers int
	health     Health
}

func (c *Cluster) Health(ctx context.Context) Health {
	m := c.monitor
	m.mu.Lock()
	m.lastAccess = time.Now()
	start := !m.running
	m.running = true
	empty := m.health.UpdatedAt == 0
	m.mu.Unlock()
	if empty {
		m.tick(ctx)
	}
	if start {
		go m.run(c.ctx)
	}
	return m.snapshot()
}

func (m *monitor) run(ctx context.Context) {
	t := time.NewTicker(sampleEvery)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			m.mu.Lock()
			idle := time.Since(m.lastAccess) > idleAfter
			if idle {
				m.running = false
			}
			m.mu.Unlock()
			if idle {
				return
			}
			m.tick(ctx)
		}
	}
}

func (m *monitor) snapshot() Health {
	m.mu.Lock()
	defer m.mu.Unlock()
	h := m.health
	h.Series = append([]Point{}, m.series...)
	return h
}

func (m *monitor) tick(ctx context.Context) {
	ctx, cancel := context.WithTimeout(ctx, sampleTimeout)
	defer cancel()
	meta, cur, groups, err := m.collect(ctx)

	m.mu.Lock()
	defer m.mu.Unlock()
	now := time.Now()
	if err != nil {
		m.health.Status, m.health.Error, m.health.UpdatedAt = StatusCritical, err.Error(), now.UnixMilli()
		m.health.TopTopics, m.health.GroupList, m.health.Cells = orEmpty(m.health.TopTopics), orEmpty(m.health.GroupList), orEmpty(m.health.Cells)
		m.health.Checks = []Check{{ID: "reachable", Status: StatusCritical, Title: "Cluster unreachable", Detail: err.Error()}}
		return
	}
	m.maxBrokers = max(m.maxBrokers, len(meta.Brokers))

	var prev *sample
	if len(m.window) > 0 {
		prev = &m.window[len(m.window)-1]
	}
	var oldest *sample
	if len(m.window) > 0 {
		oldest = &m.window[0]
	}

	h := Health{UpdatedAt: now.UnixMilli(), Brokers: len(meta.Brokers), ExpectedBrokers: m.maxBrokers, Controller: meta.Controller, Groups: len(groups)}
	rates := map[string]float64{}
	var produced, consumed float64
	if prev != nil {
		dt := cur.at.Sub(prev.at).Seconds()
		produced = rate(cur.ends, prev.ends, dt, rates)
		consumed = rate(cur.committed, prev.committed, dt, nil)
	}

	topics := m.topics(meta, rates, &h)
	slices.SortFunc(topics, func(a, b TopicRate) int { return cmp.Or(cmp.Compare(b.Rate, a.Rate), cmp.Compare(a.Name, b.Name)) })
	h.TopTopics = topics[:min(len(topics), topTopics)]
	h.GroupList = m.groups(groups, cur, prev, oldest)

	var lag int64
	for _, l := range cur.lags {
		lag += l
	}
	if prev != nil {
		m.series = append(m.series, Point{T: now.UnixMilli(), Produced: produced, Consumed: consumed, Lag: lag})
		if len(m.series) > historySize {
			m.series = slices.Delete(m.series, 0, len(m.series)-historySize)
		}
	}
	m.window = append(m.window, cur)
	if len(m.window) > trendWindow {
		m.window = slices.Delete(m.window, 0, len(m.window)-trendWindow)
	}

	h.Checks = checks(h)
	h.Status = StatusGood
	for _, c := range h.Checks {
		h.Status = worst(h.Status, c.Status)
	}
	m.health = h
}

func (m *monitor) collect(ctx context.Context) (kadm.Metadata, sample, kadm.DescribedGroupLags, error) {
	cur := sample{at: time.Now(), ends: map[string]int64{}, committed: map[string]int64{}, lags: map[string]int64{}}
	meta, err := m.cluster.admin.Metadata(ctx)
	if err != nil {
		return meta, cur, nil, err
	}
	var names []string
	for _, t := range meta.Topics {
		if !t.IsInternal && t.Err == nil {
			names = append(names, t.Topic)
		}
	}
	if len(names) > 0 {
		ends, err := m.cluster.admin.ListEndOffsets(ctx, names...)
		if err != nil {
			return meta, cur, nil, err
		}
		ends.Each(func(o kadm.ListedOffset) {
			if o.Err == nil {
				cur.ends[o.Topic] += o.Offset
			}
		})
	}
	listed, err := m.cluster.admin.ListGroups(ctx)
	if err != nil || len(listed) == 0 {
		return meta, cur, nil, err
	}
	lags, err := m.cluster.admin.Lag(ctx, listed.Groups()...)
	if err != nil {
		return meta, cur, nil, err
	}
	for name, l := range lags {
		for _, pl := range l.Lag.Sorted() {
			if pl.Commit.At >= 0 {
				cur.committed[name] += pl.Commit.At
			}
			if pl.Lag > 0 {
				cur.lags[name] += pl.Lag
			}
		}
	}
	return meta, cur, lags, nil
}

func (m *monitor) topics(meta kadm.Metadata, rates map[string]float64, h *Health) []TopicRate {
	out := make([]TopicRate, 0, len(meta.Topics))
	h.Cells = []PartitionCell{}
	for _, t := range meta.Topics.Sorted() {
		if t.IsInternal {
			continue
		}
		h.Topics++
		tr := TopicRate{Name: t.Topic, Rate: rates[t.Topic], Partitions: len(t.Partitions)}
		for _, p := range t.Partitions.Sorted() {
			h.Partitions++
			cell := PartitionCell{Topic: t.Topic, Partition: p.Partition, Leader: p.Leader, Replicas: len(p.Replicas), ISR: len(p.ISR), Status: StatusGood}
			switch {
			case p.Leader < 0:
				cell.Status = StatusCritical
				tr.Offline++
				h.Offline++
			case len(p.ISR) < len(p.Replicas):
				cell.Status = StatusWarning
				tr.UnderReplicated++
				h.UnderReplicated++
			}
			if len(h.Cells) < maxCells {
				h.Cells = append(h.Cells, cell)
			}
		}
		out = append(out, tr)
	}
	return out
}

func (m *monitor) groups(lags kadm.DescribedGroupLags, cur sample, prev, oldest *sample) []GroupHealth {
	out := make([]GroupHealth, 0, len(lags))
	for name, l := range lags {
		g := GroupHealth{Name: name, State: l.State, Members: len(l.Members), Lag: cur.lags[name]}
		if oldest != nil {
			if before, ok := oldest.lags[name]; ok {
				g.LagDelta = g.Lag - before
			}
		}
		if prev != nil {
			if before, ok := prev.committed[name]; ok {
				g.Rate = max(0, float64(cur.committed[name]-before)/cur.at.Sub(prev.at).Seconds())
			}
		}
		out = append(out, g)
	}
	slices.SortFunc(out, func(a, b GroupHealth) int { return cmp.Or(cmp.Compare(b.Lag, a.Lag), cmp.Compare(a.Name, b.Name)) })
	return out
}

func rate(cur, prev map[string]int64, dt float64, per map[string]float64) float64 {
	if dt <= 0 {
		return 0
	}
	var total float64
	for k, v := range cur {
		before, ok := prev[k]
		if !ok || v < before {
			continue
		}
		r := float64(v-before) / dt
		total += r
		if per != nil {
			per[k] = r
		}
	}
	return total
}

func checks(h Health) []Check {
	out := []Check{}
	add := func(id, status, title, detail string) {
		out = append(out, Check{ID: id, Status: status, Title: title, Detail: detail})
	}

	if h.Brokers < h.ExpectedBrokers {
		add("brokers", StatusCritical, "Broker offline", fmt.Sprintf("%d of %d brokers online", h.Brokers, h.ExpectedBrokers))
	} else {
		add("brokers", StatusGood, "Brokers online", fmt.Sprintf("%d brokers responding", h.Brokers))
	}

	if h.Controller < 0 {
		add("controller", StatusCritical, "No active controller", "the cluster has no elected controller")
	} else {
		add("controller", StatusGood, "Controller elected", fmt.Sprintf("broker %d is the active controller", h.Controller))
	}

	switch {
	case h.Offline > 0:
		add("partitions", StatusCritical, "Offline partitions", fmt.Sprintf("%d partitions have no leader", h.Offline))
	case h.UnderReplicated > 0:
		add("partitions", StatusWarning, "Under-replicated partitions", fmt.Sprintf("%d partitions are missing in-sync replicas", h.UnderReplicated))
	default:
		add("partitions", StatusGood, "Partitions healthy", fmt.Sprintf("%d partitions across %d topics fully replicated", h.Partitions, h.Topics))
	}

	var behind, rebalancing []string
	for _, g := range h.GroupList {
		if g.Lag > lagThreshold && g.LagDelta > 0 {
			behind = append(behind, g.Name)
		}
		if strings.Contains(g.State, "Rebalance") {
			rebalancing = append(rebalancing, g.Name)
		}
	}
	if len(behind) > 0 {
		add("lag", StatusWarning, "Consumers falling behind", fmt.Sprintf("lag is growing for %s", list(behind)))
	} else {
		add("lag", StatusGood, "Consumers keeping up", fmt.Sprintf("%d groups with no growing lag", h.Groups))
	}
	if len(rebalancing) > 0 {
		add("rebalance", StatusWarning, "Groups rebalancing", list(rebalancing))
	}
	return out
}

func list(names []string) string {
	if len(names) <= 3 {
		return strings.Join(names, ", ")
	}
	return fmt.Sprintf("%s and %d more", strings.Join(names[:3], ", "), len(names)-3)
}

func worst(a, b string) string {
	rank := map[string]int{StatusGood: 0, StatusWarning: 1, StatusCritical: 2}
	if rank[b] > rank[a] {
		return b
	}
	return a
}

func orEmpty[T any](s []T) []T {
	if s == nil {
		return []T{}
	}
	return s
}
