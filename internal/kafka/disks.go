package kafka

import (
	"cmp"
	"context"
	"slices"
	"sync"
	"time"
)

const (
	diskSampleEvery = 30 * time.Second
	diskHistory     = 2 * time.Hour
	diskMinWindow   = 5 * time.Minute
)

type BrokerDisk struct {
	Broker int32 `json:"broker"`
	Data   int64 `json:"data"`
	// Total and Free are -1 when the broker does not report volume sizes (Kafka < 3.3).
	Total        int64    `json:"total"`
	Free         int64    `json:"free"`
	Dirs         int      `json:"dirs"`
	Error        string   `json:"error,omitempty"`
	GrowthPerSec *float64 `json:"growthPerSec,omitempty"`
	FullInSec    *float64 `json:"fullInSec,omitempty"`
	WindowSec    float64  `json:"windowSec"`
}

type diskSample struct {
	at   time.Time
	used int64
}

type diskTracker struct {
	mu      sync.Mutex
	samples map[int32][]diskSample
}

func (c *Cluster) Disks(ctx context.Context) ([]BrokerDisk, error) {
	dirs, err := c.admin.DescribeAllLogDirs(ctx, nil)
	if err != nil && len(dirs) == 0 {
		return nil, err
	}
	out := make([]BrokerDisk, 0, len(dirs))
	for broker, ds := range dirs {
		d := BrokerDisk{Broker: broker, Total: -1, Free: -1}
		volumes := map[[2]int64]bool{}
		for _, dir := range ds {
			if dir.Err != nil {
				d.Error = dir.Err.Error()
				continue
			}
			d.Dirs++
			d.Data += dir.Size()
			if dir.TotalBytes <= 0 || dir.UsableBytes < 0 {
				continue
			}
			// Several log dirs on one volume report the same numbers; count each volume once.
			v := [2]int64{dir.TotalBytes, dir.UsableBytes}
			if volumes[v] {
				continue
			}
			volumes[v] = true
			d.Total = max(d.Total, 0) + dir.TotalBytes
			d.Free = max(d.Free, 0) + dir.UsableBytes
		}
		out = append(out, d)
	}
	slices.SortFunc(out, func(a, b BrokerDisk) int { return cmp.Compare(a.Broker, b.Broker) })
	c.disks.observe(out, time.Now())
	return out, nil
}

func (t *diskTracker) observe(disks []BrokerDisk, now time.Time) {
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.samples == nil {
		t.samples = map[int32][]diskSample{}
	}
	for i := range disks {
		d := &disks[i]
		used := d.Data
		if d.Total >= 0 {
			used = d.Total - d.Free
		}
		s := t.samples[d.Broker]
		if len(s) == 0 || now.Sub(s[len(s)-1].at) >= diskSampleEvery {
			s = append(s, diskSample{at: now, used: used})
		}
		cut := slices.IndexFunc(s, func(x diskSample) bool { return now.Sub(x.at) <= diskHistory })
		if cut > 0 {
			s = slices.Delete(s, 0, cut)
		}
		t.samples[d.Broker] = s

		first, last := s[0], s[len(s)-1]
		window := last.at.Sub(first.at)
		d.WindowSec = window.Seconds()
		if window < diskMinWindow {
			continue
		}
		rate := float64(last.used-first.used) / window.Seconds()
		d.GrowthPerSec = &rate
		if rate > 0 && d.Free >= 0 {
			eta := float64(d.Free) / rate
			d.FullInSec = &eta
		}
	}
}
