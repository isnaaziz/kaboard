package serde

import (
	"bytes"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"slices"
	"sync"
	"unicode"
	"unicode/utf8"
)

const (
	Auto   = "auto"
	JSON   = "json"
	String = "string"
	Hex    = "hex"
	Base64 = "base64"
	Null   = "null"

	Registry = "schema-registry"
)

var jsonText = map[string]bool{JSON: true, "avro": true, "protobuf": true, "json-schema": true}

type Payload struct {
	Format string `json:"format"`
	Text   string `json:"text"`
	Size   int    `json:"size"`

	SchemaID int    `json:"schemaId,omitempty"`
	Raw      string `json:"raw,omitempty"`
}

type Decoder func([]byte) (string, bool)

var (
	mu       sync.RWMutex
	decoders = map[string]Decoder{
		JSON:   decodeJSON,
		String: decodeString,
		Hex:    func(b []byte) (string, bool) { return hex.EncodeToString(b), true },
		Base64: func(b []byte) (string, bool) { return base64.StdEncoding.EncodeToString(b), true },
	}
	autoChain = []string{JSON, String}
)

func Register(name string, d Decoder, auto bool) {
	mu.Lock()
	defer mu.Unlock()
	decoders[name] = d
	if auto && !slices.Contains(autoChain, name) {
		autoChain = append([]string{name}, autoChain...)
	}
}

func Formats() []string {
	mu.RLock()
	defer mu.RUnlock()
	out := []string{Auto, Registry}
	for name := range decoders {
		out = append(out, name)
	}
	slices.Sort(out[2:])
	return out
}

func Decode(b []byte, format string) Payload {
	if b == nil {
		return Payload{Format: Null}
	}
	mu.RLock()
	defer mu.RUnlock()
	chain := autoChain
	if format != "" && format != Auto {
		chain = []string{format}
	}
	for _, name := range chain {
		if d, ok := decoders[name]; ok {
			if text, ok := d(b); ok {
				return Payload{Format: name, Text: text, Size: len(b)}
			}
		}
	}
	return Payload{Format: Hex, Text: hex.EncodeToString(b), Size: len(b)}
}

func Encode(text *string, encoding string) ([]byte, error) {
	if text == nil {
		return nil, nil
	}
	switch encoding {
	case "", String, JSON:
		return []byte(*text), nil
	case Hex:
		return hex.DecodeString(*text)
	case Base64:
		return base64.StdEncoding.DecodeString(*text)
	}
	return nil, fmt.Errorf("unsupported encoding %q", encoding)
}

func (p Payload) Value() any {
	if p.Format == Null {
		return nil
	}
	if jsonText[p.Format] {
		var v any
		if json.Unmarshal([]byte(p.Text), &v) == nil {
			return v
		}
	}
	return p.Text
}

func decodeJSON(b []byte) (string, bool) {
	t := bytes.TrimSpace(b)
	if len(t) == 0 || (t[0] != '{' && t[0] != '[') || !json.Valid(t) {
		return "", false
	}
	return string(b), true
}

func decodeString(b []byte) (string, bool) {
	if !utf8.Valid(b) {
		return "", false
	}
	for _, r := range string(b) {
		if unicode.IsControl(r) && r != '\n' && r != '\r' && r != '\t' {
			return "", false
		}
	}
	return string(b), true
}
