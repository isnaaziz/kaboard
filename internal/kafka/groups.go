package kafka

import (
	"context"
	"fmt"
	"slices"

	"github.com/twmb/franz-go/pkg/kadm"
)

type GroupSummary struct {
	Name         string   `json:"name"`
	State        string   `json:"state"`
	ProtocolType string   `json:"protocolType"`
	Coordinator  int32    `json:"coordinator"`
	Members      int      `json:"members"`
	Topics       []string `json:"topics"`
	Lag          int64    `json:"lag"`
	Error        string   `json:"error,omitempty"`
}

type TopicPartitions struct {
	Topic      string  `json:"topic"`
	Partitions []int32 `json:"partitions"`
}

type GroupMember struct {
	ID          string            `json:"id"`
	InstanceID  string            `json:"instanceId,omitempty"`
	ClientID    string            `json:"clientId"`
	Host        string            `json:"host"`
	Assignments []TopicPartitions `json:"assignments"`
}

type PartitionLag struct {
	Topic     string `json:"topic"`
	Partition int32  `json:"partition"`
	Committed int64  `json:"committed"`
	Start     int64  `json:"start"`
	End       int64  `json:"end"`
	Lag       int64  `json:"lag"`
	Member    string `json:"member,omitempty"`
	Error     string `json:"error,omitempty"`
}

type Group struct {
	GroupSummary
	Protocol   string         `json:"protocol"`
	MemberList []GroupMember  `json:"memberList"`
	Lags       []PartitionLag `json:"lags"`
}

type ResetOffsets struct {
	Topic      string  `json:"topic"`
	Partitions []int32 `json:"partitions"`
	Mode       string  `json:"mode"`
	Timestamp  int64   `json:"timestamp"`
	Offset     int64   `json:"offset"`
}

func (c *Cluster) Groups(ctx context.Context) ([]GroupSummary, error) {
	listed, err := c.admin.ListGroups(ctx)
	if err != nil {
		return nil, err
	}
	if len(listed) == 0 {
		return []GroupSummary{}, nil
	}
	lags, err := c.admin.Lag(ctx, listed.Groups()...)
	if err != nil {
		return nil, err
	}
	out := make([]GroupSummary, 0, len(listed))
	for _, g := range listed.Sorted() {
		l, ok := lags[g.Group]
		if !ok {
			out = append(out, GroupSummary{Name: g.Group, State: g.State, ProtocolType: g.ProtocolType, Coordinator: g.Coordinator, Topics: []string{}})
			continue
		}
		out = append(out, groupSummary(l))
	}
	return out, nil
}

func (c *Cluster) Group(ctx context.Context, name string) (Group, error) {
	lags, err := c.admin.Lag(ctx, name)
	if err != nil {
		return Group{}, err
	}
	l, ok := lags[name]
	if !ok || l.DescribeErr != nil || (l.State == "Dead" && len(l.Lag) == 0) {
		return Group{}, notFound("group", name, l.DescribeErr)
	}
	g := Group{GroupSummary: groupSummary(l), Protocol: l.Protocol, MemberList: make([]GroupMember, 0, len(l.Members)), Lags: []PartitionLag{}}
	for _, m := range l.Members {
		g.MemberList = append(g.MemberList, member(m))
	}
	for _, pl := range l.Lag.Sorted() {
		lag := PartitionLag{Topic: pl.Topic, Partition: pl.Partition, Committed: pl.Commit.At, Start: pl.Start.Offset, End: pl.End.Offset, Lag: pl.Lag}
		if pl.Member != nil {
			lag.Member = pl.Member.MemberID
		}
		if pl.Err != nil {
			lag.Error = pl.Err.Error()
		}
		g.Lags = append(g.Lags, lag)
	}
	return g, nil
}

func (c *Cluster) DeleteGroup(ctx context.Context, name string) error {
	resp, err := c.admin.DeleteGroups(ctx, name)
	if err != nil {
		return err
	}
	return resp.Error()
}

func (c *Cluster) ResetOffsets(ctx context.Context, group string, req ResetOffsets) error {
	described, err := c.admin.DescribeGroups(ctx, group)
	if err != nil {
		return err
	}
	if d := described[group]; d.State != "Empty" && d.State != "Dead" {
		return fmt.Errorf("%w: group must be Empty to reset offsets (current state %s)", ErrConflict, d.State)
	}
	starts, ends, err := c.watermarks(ctx, req.Topic)
	if err != nil {
		return err
	}
	if len(ends[req.Topic]) == 0 {
		return notFound("topic", req.Topic, nil)
	}
	target, err := c.resetTarget(ctx, group, req, starts, ends)
	if err != nil {
		return err
	}
	var offsets kadm.Offsets
	ends.Each(func(end kadm.ListedOffset) {
		if end.Topic != req.Topic || (len(req.Partitions) > 0 && !slices.Contains(req.Partitions, end.Partition)) {
			return
		}
		start, _ := starts.Lookup(end.Topic, end.Partition)
		offsets.AddOffset(end.Topic, end.Partition, clamp(target(end.Partition), start.Offset, end.Offset), -1)
	})
	resp, err := c.admin.CommitOffsets(ctx, group, offsets)
	if err != nil {
		return err
	}
	return resp.Error()
}

func (c *Cluster) resetTarget(ctx context.Context, group string, req ResetOffsets, starts, ends kadm.ListedOffsets) (func(int32) int64, error) {
	lookup := func(l kadm.ListedOffsets) func(int32) int64 {
		return func(p int32) int64 {
			o, _ := l.Lookup(req.Topic, p)
			return o.Offset
		}
	}
	switch req.Mode {
	case "earliest":
		return lookup(starts), nil
	case "latest":
		return lookup(ends), nil
	case "timestamp":
		at, err := c.admin.ListOffsetsAfterMilli(ctx, req.Timestamp, req.Topic)
		if err != nil {
			return nil, err
		}
		return func(p int32) int64 {
			if o, ok := at.Lookup(req.Topic, p); ok && o.Err == nil && o.Offset >= 0 {
				return o.Offset
			}
			return lookup(ends)(p)
		}, nil
	case "offset":
		return func(int32) int64 { return req.Offset }, nil
	case "shift":
		committed, err := c.admin.FetchOffsets(ctx, group)
		if err != nil {
			return nil, err
		}
		return func(p int32) int64 {
			if o, ok := committed.Lookup(req.Topic, p); ok && o.Err == nil && o.At >= 0 {
				return o.At + req.Offset
			}
			return lookup(ends)(p)
		}, nil
	}
	return nil, fmt.Errorf("%w: unknown reset mode %q", ErrInvalid, req.Mode)
}

func groupSummary(l kadm.DescribedGroupLag) GroupSummary {
	s := GroupSummary{
		Name: l.Group, State: l.State, ProtocolType: l.ProtocolType, Coordinator: l.Coordinator.NodeID,
		Members: len(l.Members), Topics: make([]string, 0, len(l.Lag)), Lag: l.Lag.Total(),
	}
	for t := range l.Lag {
		s.Topics = append(s.Topics, t)
	}
	slices.Sort(s.Topics)
	if err := l.Error(); err != nil {
		s.Error = err.Error()
	}
	return s
}

func member(m kadm.DescribedGroupMember) GroupMember {
	gm := GroupMember{ID: m.MemberID, InstanceID: deref(m.InstanceID), ClientID: m.ClientID, Host: m.ClientHost, Assignments: []TopicPartitions{}}
	if a, ok := m.Assigned.AsConsumer(); ok {
		for _, t := range a.Topics {
			gm.Assignments = append(gm.Assignments, TopicPartitions{Topic: t.Topic, Partitions: slices.Sorted(slices.Values(t.Partitions))})
		}
	}
	return gm
}

func clamp(v, lo, hi int64) int64 {
	return max(lo, min(v, hi))
}
