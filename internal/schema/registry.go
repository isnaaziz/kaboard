package schema

import (
	"context"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/bufbuild/protocompile"
	"github.com/hamba/avro/v2"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/reflect/protoreflect"
	"google.golang.org/protobuf/types/dynamicpb"

	"kaboard/internal/serde"
	"kaboard/internal/store"
)

const (
	Avro     = "avro"
	Protobuf = "protobuf"
	JSON     = "json-schema"

	failureTTL  = time.Minute
	httpTimeout = 10 * time.Second
	maxBody     = 8 << 20
)

type decoder func([]byte) (string, error)

type entry struct {
	format string
	decode decoder
	err    error
	at     time.Time
}

type Client struct {
	base     *url.URL
	username string
	password string
	http     *http.Client

	mu    sync.Mutex
	cache map[uint32]*entry
}

func New(cfg *store.SchemaRegistry) (*Client, error) {
	if cfg == nil || strings.TrimSpace(cfg.URL) == "" {
		return nil, nil
	}
	u, err := url.Parse(strings.TrimRight(strings.TrimSpace(cfg.URL), "/"))
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return nil, fmt.Errorf("schema registry url must be an http(s) URL, got %q", cfg.URL)
	}
	return &Client{
		base: u, username: cfg.Username, password: cfg.Password,
		http:  &http.Client{Timeout: httpTimeout},
		cache: map[uint32]*entry{},
	}, nil
}

func (c *Client) Ping(ctx context.Context) error {
	var subjects []string
	return c.get(ctx, "/subjects", &subjects)
}

// Decode handles the Confluent wire format: magic byte 0, a 4-byte schema ID, then the encoded payload.
func (c *Client) Decode(ctx context.Context, b []byte) (serde.Payload, bool) {
	if len(b) < 5 || b[0] != 0 {
		return serde.Payload{}, false
	}
	id := binary.BigEndian.Uint32(b[1:5])
	e := c.lookup(ctx, id)
	if e.err != nil {
		return serde.Payload{}, false
	}
	text, err := e.decode(b[5:])
	if err != nil {
		return serde.Payload{}, false
	}
	return serde.Payload{Format: e.format, Text: text, Size: len(b), SchemaID: int(id), Raw: base64.StdEncoding.EncodeToString(b)}, true
}

func (c *Client) lookup(ctx context.Context, id uint32) *entry {
	c.mu.Lock()
	defer c.mu.Unlock()
	if e, ok := c.cache[id]; ok && (e.err == nil || time.Since(e.at) < failureTTL) {
		return e
	}
	e := &entry{at: time.Now()}
	e.format, e.decode, e.err = c.load(ctx, id)
	c.cache[id] = e
	return e
}

type reference struct {
	Name    string `json:"name"`
	Subject string `json:"subject"`
	Version int    `json:"version"`
}

type schemaDoc struct {
	Schema     string      `json:"schema"`
	SchemaType string      `json:"schemaType"`
	References []reference `json:"references"`
}

func (c *Client) load(ctx context.Context, id uint32) (string, decoder, error) {
	var doc schemaDoc
	if err := c.get(ctx, "/schemas/ids/"+strconv.FormatUint(uint64(id), 10), &doc); err != nil {
		return "", nil, err
	}
	switch strings.ToUpper(doc.SchemaType) {
	case "", "AVRO":
		d, err := c.avroDecoder(ctx, doc)
		return Avro, d, err
	case "PROTOBUF":
		d, err := c.protoDecoder(ctx, id, doc)
		return Protobuf, d, err
	case "JSON":
		return JSON, func(b []byte) (string, error) {
			if !json.Valid(b) {
				return "", errors.New("invalid json payload")
			}
			return string(b), nil
		}, nil
	}
	return "", nil, fmt.Errorf("unsupported schema type %q", doc.SchemaType)
}

func (c *Client) avroDecoder(ctx context.Context, doc schemaDoc) (decoder, error) {
	cache := &avro.SchemaCache{}
	refs, err := c.references(ctx, doc.References, map[string]bool{})
	if err != nil {
		return nil, err
	}
	for _, r := range refs {
		if _, err := avro.ParseWithCache(r.Schema, "", cache); err != nil {
			return nil, fmt.Errorf("parse referenced avro schema: %w", err)
		}
	}
	s, err := avro.ParseWithCache(doc.Schema, "", cache)
	if err != nil {
		return nil, fmt.Errorf("parse avro schema: %w", err)
	}
	return func(b []byte) (string, error) {
		var v any
		if err := avro.Unmarshal(s, b, &v); err != nil {
			return "", err
		}
		out, err := json.Marshal(v)
		return string(out), err
	}, nil
}

func (c *Client) protoDecoder(ctx context.Context, id uint32, doc schemaDoc) (decoder, error) {
	refs, err := c.references(ctx, doc.References, map[string]bool{})
	if err != nil {
		return nil, err
	}
	main := fmt.Sprintf("schema-%d.proto", id)
	sources := map[string]string{main: doc.Schema}
	for _, r := range refs {
		sources[r.name] = r.Schema
	}
	compiler := protocompile.Compiler{
		Resolver: protocompile.WithStandardImports(&protocompile.SourceResolver{Accessor: protocompile.SourceAccessorFromMap(sources)}),
	}
	files, err := compiler.Compile(ctx, main)
	if err != nil {
		return nil, fmt.Errorf("compile protobuf schema: %w", err)
	}
	file := files[0]
	return func(b []byte) (string, error) {
		md, rest, err := messageAt(file, b)
		if err != nil {
			return "", err
		}
		msg := dynamicpb.NewMessage(md)
		if err := proto.Unmarshal(rest, msg); err != nil {
			return "", err
		}
		out, err := protojson.MarshalOptions{EmitUnpopulated: true}.Marshal(msg)
		return string(out), err
	}, nil
}

// messageAt reads the Confluent message-index path (zigzag varints) that selects the message type within the file.
func messageAt(file protoreflect.FileDescriptor, b []byte) (protoreflect.MessageDescriptor, []byte, error) {
	count, n := binary.Varint(b)
	if n <= 0 || count < 0 {
		return nil, nil, errors.New("invalid protobuf message index")
	}
	b = b[n:]
	path := []int64{0}
	if count > 0 {
		path = make([]int64, count)
		for i := range path {
			v, n := binary.Varint(b)
			if n <= 0 {
				return nil, nil, errors.New("invalid protobuf message index")
			}
			path[i], b = v, b[n:]
		}
	}
	msgs := file.Messages()
	var md protoreflect.MessageDescriptor
	for _, i := range path {
		if i < 0 || int(i) >= msgs.Len() {
			return nil, nil, errors.New("protobuf message index out of range")
		}
		md = msgs.Get(int(i))
		msgs = md.Messages()
	}
	return md, b, nil
}

type resolved struct {
	name string
	schemaDoc
}

func (c *Client) references(ctx context.Context, refs []reference, seen map[string]bool) ([]resolved, error) {
	var out []resolved
	for _, r := range refs {
		key := r.Subject + "/" + strconv.Itoa(r.Version)
		if seen[key] {
			continue
		}
		seen[key] = true
		var doc schemaDoc
		path := "/subjects/" + url.PathEscape(r.Subject) + "/versions/" + strconv.Itoa(r.Version)
		if err := c.get(ctx, path, &doc); err != nil {
			return nil, fmt.Errorf("reference %s: %w", r.Name, err)
		}
		nested, err := c.references(ctx, doc.References, seen)
		if err != nil {
			return nil, err
		}
		out = append(out, nested...)
		out = append(out, resolved{name: r.Name, schemaDoc: doc})
	}
	return out, nil
}

func (c *Client) get(ctx context.Context, path string, v any) error {
	u := *c.base
	u.Path = strings.TrimRight(u.Path, "/") + path
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return err
	}
	req.Header.Set("Accept", "application/vnd.schemaregistry.v1+json, application/json")
	if c.username != "" {
		req.SetBasicAuth(c.username, c.password)
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("schema registry: %w", err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, maxBody))
	if err != nil {
		return fmt.Errorf("schema registry: %w", err)
	}
	if resp.StatusCode != http.StatusOK {
		var e struct {
			Message string `json:"message"`
		}
		if json.Unmarshal(body, &e) == nil && e.Message != "" {
			return fmt.Errorf("schema registry: %s (HTTP %d)", e.Message, resp.StatusCode)
		}
		return fmt.Errorf("schema registry: HTTP %d", resp.StatusCode)
	}
	return json.Unmarshal(body, v)
}
