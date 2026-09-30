package kafka

import (
	"cmp"
	"context"
	"errors"
	"fmt"
	"slices"

	"github.com/twmb/franz-go/pkg/kadm"
	"github.com/twmb/franz-go/pkg/kerr"
)

type Broker struct {
	ID         int32  `json:"id"`
	Host       string `json:"host"`
	Port       int32  `json:"port"`
	Rack       string `json:"rack,omitempty"`
	Controller bool   `json:"controller"`
}

type Overview struct {
	ClusterID  string   `json:"clusterId"`
	Controller int32    `json:"controller"`
	Brokers    []Broker `json:"brokers"`
}

type TopicSummary struct {
	Name            string `json:"name"`
	Internal        bool   `json:"internal"`
	Partitions      int    `json:"partitions"`
	Replication     int    `json:"replication"`
	UnderReplicated int    `json:"underReplicated"`
	Messages        int64  `json:"messages"`
}

type Partition struct {
	ID       int32   `json:"id"`
	Leader   int32   `json:"leader"`
	Replicas []int32 `json:"replicas"`
	ISR      []int32 `json:"isr"`
	Offline  []int32 `json:"offline"`
	Start    int64   `json:"start"`
	End      int64   `json:"end"`
}

type ConfigEntry struct {
	Name      string `json:"name"`
	Value     string `json:"value"`
	Source    string `json:"source"`
	Sensitive bool   `json:"sensitive"`
}

type Topic struct {
	TopicSummary
	PartitionList []Partition   `json:"partitionList"`
	Configs       []ConfigEntry `json:"configs"`
}

type CreateTopic struct {
	Name        string             `json:"name"`
	Partitions  int32              `json:"partitions"`
	Replication int16              `json:"replication"`
	Configs     map[string]*string `json:"configs"`
}

func (c *Cluster) Overview(ctx context.Context) (Overview, error) {
	m, err := c.admin.BrokerMetadata(ctx)
	if err != nil {
		return Overview{}, err
	}
	brokers := make([]Broker, 0, len(m.Brokers))
	for _, b := range m.Brokers {
		brokers = append(brokers, Broker{ID: b.NodeID, Host: b.Host, Port: b.Port, Rack: deref(b.Rack), Controller: b.NodeID == m.Controller})
	}
	return Overview{ClusterID: m.Cluster, Controller: m.Controller, Brokers: brokers}, nil
}

func (c *Cluster) Topics(ctx context.Context) ([]TopicSummary, error) {
	details, err := c.admin.ListTopicsWithInternal(ctx)
	if err != nil {
		return nil, err
	}
	starts, ends, err := c.watermarks(ctx, details.Names()...)
	if err != nil {
		return nil, err
	}
	out := make([]TopicSummary, 0, len(details))
	for _, d := range details.Sorted() {
		out = append(out, summarize(d, starts, ends))
	}
	return out, nil
}

func (c *Cluster) Topic(ctx context.Context, name string) (Topic, error) {
	details, err := c.admin.ListTopicsWithInternal(ctx, name)
	if err != nil {
		return Topic{}, err
	}
	d, ok := details[name]
	if !ok || d.Err != nil {
		return Topic{}, notFound("topic", name, d.Err)
	}
	starts, ends, err := c.watermarks(ctx, name)
	if err != nil {
		return Topic{}, err
	}
	configs, err := c.topicConfigs(ctx, name)
	if err != nil {
		return Topic{}, err
	}
	parts := make([]Partition, 0, len(d.Partitions))
	for _, p := range d.Partitions.Sorted() {
		s, _ := starts.Lookup(name, p.Partition)
		e, _ := ends.Lookup(name, p.Partition)
		parts = append(parts, Partition{
			ID: p.Partition, Leader: p.Leader, Replicas: p.Replicas, ISR: p.ISR,
			Offline: p.OfflineReplicas, Start: s.Offset, End: e.Offset,
		})
	}
	return Topic{TopicSummary: summarize(d, starts, ends), PartitionList: parts, Configs: configs}, nil
}

func (c *Cluster) CreateTopic(ctx context.Context, req CreateTopic) error {
	if req.Name == "" {
		return fmt.Errorf("%w: topic name is required", ErrInvalid)
	}
	if req.Partitions == 0 {
		req.Partitions = -1
	}
	if req.Replication == 0 {
		req.Replication = -1
	}
	resp, err := c.admin.CreateTopic(ctx, req.Partitions, req.Replication, req.Configs, req.Name)
	if err != nil {
		return err
	}
	if errors.Is(resp.Err, kerr.TopicAlreadyExists) {
		return fmt.Errorf("%w: topic %q already exists", ErrConflict, req.Name)
	}
	return wrap(resp.Err, resp.ErrMessage)
}

func (c *Cluster) DeleteTopic(ctx context.Context, name string) error {
	resp, err := c.admin.DeleteTopics(ctx, name)
	if err != nil {
		return err
	}
	if r := resp[name]; errors.Is(r.Err, kerr.UnknownTopicOrPartition) {
		return notFound("topic", name, r.Err)
	}
	return resp.Error()
}

func (c *Cluster) SetPartitions(ctx context.Context, name string, count int) error {
	current, err := c.Topic(ctx, name)
	if err != nil {
		return err
	}
	if count <= current.Partitions {
		return fmt.Errorf("%w: partitions can only be increased (currently %d)", ErrInvalid, current.Partitions)
	}
	resp, err := c.admin.UpdatePartitions(ctx, count, name)
	if err != nil {
		return err
	}
	r := resp[name]
	return wrap(r.Err, r.ErrMessage)
}

func (c *Cluster) PurgeTopic(ctx context.Context, name string) (int64, error) {
	ends, err := c.admin.ListEndOffsets(ctx, name)
	if err != nil {
		return 0, err
	}
	if err := ends.Error(); err != nil {
		return 0, notFound("topic", name, err)
	}
	if _, ok := ends[name]; !ok {
		return 0, notFound("topic", name, nil)
	}
	starts, err := c.admin.ListStartOffsets(ctx, name)
	if err != nil {
		return 0, err
	}
	resp, err := c.admin.DeleteRecords(ctx, ends.Offsets())
	if err != nil {
		return 0, err
	}
	var purged int64
	for _, p := range resp[name] {
		if errors.Is(p.Err, kerr.PolicyViolation) {
			return 0, wrap(p.Err, "records can only be purged from topics with cleanup.policy=delete")
		}
		if p.Err != nil {
			return 0, p.Err
		}
		if s, ok := starts.Lookup(name, p.Partition); ok {
			purged += p.LowWatermark - s.Offset
		}
	}
	return purged, nil
}

func (c *Cluster) AlterTopicConfigs(ctx context.Context, name string, set map[string]*string) error {
	alters := make([]kadm.AlterConfig, 0, len(set))
	for k, v := range set {
		op := kadm.SetConfig
		if v == nil {
			op = kadm.DeleteConfig
		}
		alters = append(alters, kadm.AlterConfig{Op: op, Name: k, Value: v})
	}
	resp, err := c.admin.AlterTopicConfigs(ctx, alters, name)
	if err != nil {
		return err
	}
	for _, r := range resp {
		if r.Err != nil {
			return wrap(r.Err, r.ErrMessage)
		}
	}
	return nil
}

func (c *Cluster) topicConfigs(ctx context.Context, name string) ([]ConfigEntry, error) {
	rcs, err := c.admin.DescribeTopicConfigs(ctx, name)
	if err != nil {
		return nil, err
	}
	rc, err := rcs.On(name, nil)
	if err != nil {
		return nil, err
	}
	out := make([]ConfigEntry, 0, len(rc.Configs))
	for _, cfg := range rc.Configs {
		out = append(out, ConfigEntry{Name: cfg.Key, Value: cfg.MaybeValue(), Source: cfg.Source.String(), Sensitive: cfg.Sensitive})
	}
	slices.SortFunc(out, func(a, b ConfigEntry) int { return cmp.Compare(a.Name, b.Name) })
	return out, nil
}

func (c *Cluster) watermarks(ctx context.Context, topics ...string) (kadm.ListedOffsets, kadm.ListedOffsets, error) {
	if len(topics) == 0 {
		return kadm.ListedOffsets{}, kadm.ListedOffsets{}, nil
	}
	starts, err := c.admin.ListStartOffsets(ctx, topics...)
	if err != nil {
		return nil, nil, err
	}
	ends, err := c.admin.ListEndOffsets(ctx, topics...)
	return starts, ends, err
}

func summarize(d kadm.TopicDetail, starts, ends kadm.ListedOffsets) TopicSummary {
	s := TopicSummary{Name: d.Topic, Internal: d.IsInternal, Partitions: len(d.Partitions)}
	for _, p := range d.Partitions {
		s.Replication = max(s.Replication, len(p.Replicas))
		if len(p.ISR) < len(p.Replicas) {
			s.UnderReplicated++
		}
		start, sok := starts.Lookup(d.Topic, p.Partition)
		end, eok := ends.Lookup(d.Topic, p.Partition)
		if sok && eok && start.Err == nil && end.Err == nil {
			s.Messages += end.Offset - start.Offset
		}
	}
	return s
}
