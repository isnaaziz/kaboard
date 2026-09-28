package kafka

import (
	"context"
	"fmt"

	"github.com/twmb/franz-go/pkg/kgo"

	"kaboard/internal/serde"
)

type ProduceRecord struct {
	Key           *string  `json:"key"`
	Value         *string  `json:"value"`
	KeyEncoding   string   `json:"keyEncoding"`
	ValueEncoding string   `json:"valueEncoding"`
	Headers       []Header `json:"headers"`
	Partition     *int32   `json:"partition"`
}

type Produced struct {
	Partition int32 `json:"partition"`
	Offset    int64 `json:"offset"`
}

func (c *Cluster) Produce(ctx context.Context, topic string, recs []ProduceRecord) ([]Produced, error) {
	if len(recs) == 0 {
		return nil, fmt.Errorf("%w: no records", ErrInvalid)
	}
	details, err := c.admin.ListTopics(ctx, topic)
	if err != nil {
		return nil, err
	}
	d, ok := details[topic]
	if !ok || d.Err != nil {
		return nil, notFound("topic", topic, d.Err)
	}
	n := len(d.Partitions)
	partitioner := kgo.StickyKeyPartitioner(nil).ForTopic(topic)
	krecs := make([]*kgo.Record, len(recs))
	for i, pr := range recs {
		r, err := pr.record(topic)
		if err != nil {
			return nil, fmt.Errorf("%w: record %d: %v", ErrInvalid, i, err)
		}
		switch {
		case pr.Partition == nil:
			r.Partition = int32(partitioner.Partition(r, n))
		case *pr.Partition < 0 || int(*pr.Partition) >= n:
			return nil, fmt.Errorf("%w: record %d: partition %d out of range [0,%d)", ErrInvalid, i, *pr.Partition, n)
		default:
			r.Partition = *pr.Partition
		}
		krecs[i] = r
	}
	results := c.client.ProduceSync(ctx, krecs...)
	if err := results.FirstErr(); err != nil {
		return nil, err
	}
	out := make([]Produced, len(results))
	for i, res := range results {
		out[i] = Produced{Partition: res.Record.Partition, Offset: res.Record.Offset}
	}
	return out, nil
}

func (pr ProduceRecord) record(topic string) (*kgo.Record, error) {
	key, err := serde.Encode(pr.Key, pr.KeyEncoding)
	if err != nil {
		return nil, err
	}
	value, err := serde.Encode(pr.Value, pr.ValueEncoding)
	if err != nil {
		return nil, err
	}
	r := &kgo.Record{Topic: topic, Key: key, Value: value}
	for _, h := range pr.Headers {
		r.Headers = append(r.Headers, kgo.RecordHeader{Key: h.Key, Value: []byte(h.Value)})
	}
	return r, nil
}
