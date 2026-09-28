package audit

import (
	"bufio"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

const memory = 5000

type Entry struct {
	Time    time.Time `json:"time"`
	User    string    `json:"user"`
	IP      string    `json:"ip"`
	Action  string    `json:"action"`
	Cluster string    `json:"cluster,omitempty"`
	Target  string    `json:"target,omitempty"`
	Detail  string    `json:"detail,omitempty"`
	Status  int       `json:"status"`
}

type Log struct {
	mu      sync.Mutex
	file    *os.File
	entries []Entry
}

func Open(path string) (*Log, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return nil, err
	}
	l := &Log{}
	if f, err := os.Open(path); err == nil {
		scanner := bufio.NewScanner(f)
		scanner.Buffer(make([]byte, 64<<10), 1<<20)
		for scanner.Scan() {
			var e Entry
			if json.Unmarshal(scanner.Bytes(), &e) == nil {
				l.append(e)
			}
		}
		f.Close()
	} else if !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}
	f, err := os.OpenFile(path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		return nil, err
	}
	l.file = f
	return l, nil
}

func (l *Log) Record(e Entry) error {
	if e.Time.IsZero() {
		e.Time = time.Now()
	}
	line, err := json.Marshal(e)
	if err != nil {
		return err
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	l.append(e)
	_, err = l.file.Write(append(line, '\n'))
	return err
}

func (l *Log) List(limit int, query string) []Entry {
	q := strings.ToLower(strings.TrimSpace(query))
	l.mu.Lock()
	defer l.mu.Unlock()
	out := []Entry{}
	for i := len(l.entries) - 1; i >= 0 && len(out) < limit; i-- {
		if e := l.entries[i]; q == "" || matches(e, q) {
			out = append(out, e)
		}
	}
	return out
}

func (l *Log) Close() error {
	return l.file.Close()
}

func (l *Log) append(e Entry) {
	l.entries = append(l.entries, e)
	if len(l.entries) > memory {
		l.entries = append([]Entry(nil), l.entries[len(l.entries)-memory:]...)
	}
}

func matches(e Entry, q string) bool {
	for _, f := range []string{e.User, e.IP, e.Action, e.Cluster, e.Target, e.Detail} {
		if strings.Contains(strings.ToLower(f), q) {
			return true
		}
	}
	return false
}
