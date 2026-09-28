package kafka

import (
	"errors"
	"fmt"

	"github.com/twmb/franz-go/pkg/kerr"
)

func notFound(kind, name string, cause error) error {
	if cause != nil && !errors.Is(cause, kerr.UnknownTopicOrPartition) && !errors.Is(cause, kerr.GroupIDNotFound) {
		return cause
	}
	return fmt.Errorf("%w: %s %q", ErrNotFound, kind, name)
}

func wrap(err error, msg string) error {
	if err == nil || msg == "" {
		return err
	}
	return fmt.Errorf("%w: %s", err, msg)
}

func deref[T any](p *T) T {
	var zero T
	if p == nil {
		return zero
	}
	return *p
}
