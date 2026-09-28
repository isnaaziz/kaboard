package filter

import (
	"context"
	"fmt"

	"cel.dev/cel-go/cel"
)

const costLimit = 1_000_000

type Record struct {
	Key       any
	Value     any
	Raw       string
	Headers   map[string]string
	Partition int32
	Offset    int64
	Timestamp int64
	Size      int
}

type Filter struct {
	prg cel.Program
}

var env = must(cel.NewEnv(
	cel.Variable("key", cel.DynType),
	cel.Variable("value", cel.DynType),
	cel.Variable("raw", cel.StringType),
	cel.Variable("headers", cel.MapType(cel.StringType, cel.StringType)),
	cel.Variable("partition", cel.IntType),
	cel.Variable("offset", cel.IntType),
	cel.Variable("timestamp", cel.IntType),
	cel.Variable("size", cel.IntType),
))

func Compile(expr string) (*Filter, error) {
	if expr == "" {
		return nil, nil
	}
	ast, iss := env.Compile(expr)
	if iss.Err() != nil {
		return nil, iss.Err()
	}
	if t := ast.OutputType(); t != cel.BoolType && t != cel.DynType {
		return nil, fmt.Errorf("filter must evaluate to bool, got %s", t)
	}
	prg, err := env.Program(ast, cel.EvalOptions(cel.OptOptimize), cel.CostLimit(costLimit), cel.InterruptCheckFrequency(100))
	if err != nil {
		return nil, err
	}
	return &Filter{prg: prg}, nil
}

func (f *Filter) Match(ctx context.Context, r Record) bool {
	if f == nil {
		return true
	}
	out, _, err := f.prg.ContextEval(ctx, map[string]any{
		"key":       r.Key,
		"value":     r.Value,
		"raw":       r.Raw,
		"headers":   r.Headers,
		"partition": int64(r.Partition),
		"offset":    r.Offset,
		"timestamp": r.Timestamp,
		"size":      int64(r.Size),
	})
	if err != nil {
		return false
	}
	ok, _ := out.Value().(bool)
	return ok
}

func must[T any](v T, err error) T {
	if err != nil {
		panic(err)
	}
	return v
}
