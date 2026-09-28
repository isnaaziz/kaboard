package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"math/rand/v2"
	"time"

	"github.com/twmb/franz-go/pkg/kadm"
	"github.com/twmb/franz-go/pkg/kgo"
)

func main() {
	brokers := flag.String("brokers", "localhost:9092", "bootstrap brokers")
	topic := flag.String("topic", "scada.telemetry", "topic to seed")
	count := flag.Int("count", 5000, "number of records")
	flag.Parse()

	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()

	cl, err := kgo.NewClient(kgo.SeedBrokers(*brokers), kgo.ConsumerGroup("scada-historian"), kgo.ConsumeTopics(*topic), kgo.DisableAutoCommit())
	if err != nil {
		log.Fatal(err)
	}
	defer cl.Close()

	adm := kadm.NewClient(cl)
	if _, err := adm.CreateTopic(ctx, 6, 1, nil, *topic); err != nil {
		log.Fatal(err)
	}

	statuses := []string{"OK", "OK", "OK", "WARN", "FAILED"}
	protocols := []string{"dnp3", "iec104"}
	records := make([]*kgo.Record, 0, *count)
	start := time.Now().Add(-time.Duration(*count) * time.Second)
	for i := range *count {
		device := fmt.Sprintf("rtu-%03d", rand.IntN(40))
		value, _ := json.Marshal(map[string]any{
			"device":   map[string]any{"id": device, "protocol": protocols[rand.IntN(2)]},
			"point":    rand.IntN(512),
			"value":    rand.Float64() * 240,
			"quality":  rand.IntN(4) == 0,
			"status":   statuses[rand.IntN(len(statuses))],
			"sequence": i,
		})
		records = append(records, &kgo.Record{
			Topic:     *topic,
			Key:       []byte(device),
			Value:     value,
			Timestamp: start.Add(time.Duration(i) * time.Second),
			Headers:   []kgo.RecordHeader{{Key: "source", Value: []byte(fmt.Sprintf("fep-%d", rand.IntN(3)+1))}},
		})
	}
	if err := cl.ProduceSync(ctx, records...).FirstErr(); err != nil {
		log.Fatal(err)
	}

	consumed := 0
	for consumed < *count/2 {
		fetches := cl.PollRecords(ctx, *count/2-consumed)
		if err := fetches.Err0(); err != nil {
			log.Fatal(err)
		}
		consumed += fetches.NumRecords()
	}
	if err := cl.CommitUncommittedOffsets(ctx); err != nil {
		log.Fatal(err)
	}
	log.Printf("seeded %d records into %s, group scada-historian consumed %d", *count, *topic, consumed)
}
