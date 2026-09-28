package secret

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

const prefix = "enc:v1:"

type Box struct {
	aead cipher.AEAD
}

func Load(key, keyFile string) (*Box, bool, error) {
	generated := false
	if key == "" {
		raw, err := os.ReadFile(keyFile)
		switch {
		case errors.Is(err, os.ErrNotExist):
			buf := make([]byte, 32)
			if _, err := rand.Read(buf); err != nil {
				return nil, false, err
			}
			if err := os.MkdirAll(filepath.Dir(keyFile), 0o700); err != nil {
				return nil, false, err
			}
			if err := os.WriteFile(keyFile, []byte(hex.EncodeToString(buf)), 0o600); err != nil {
				return nil, false, err
			}
			key, generated = hex.EncodeToString(buf), true
		case err != nil:
			return nil, false, err
		default:
			key = strings.TrimSpace(string(raw))
		}
	}
	sum := sha256.Sum256([]byte(key))
	block, err := aes.NewCipher(sum[:])
	if err != nil {
		return nil, false, err
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil, false, err
	}
	return &Box{aead: aead}, generated, nil
}

func (b *Box) Seal(plain string) (string, error) {
	if plain == "" {
		return "", nil
	}
	nonce := make([]byte, b.aead.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return "", err
	}
	return prefix + base64.StdEncoding.EncodeToString(b.aead.Seal(nonce, nonce, []byte(plain), nil)), nil
}

func (b *Box) Open(value string) (string, bool, error) {
	if !strings.HasPrefix(value, prefix) {
		return value, value != "", nil
	}
	raw, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(value, prefix))
	if err != nil {
		return "", false, err
	}
	n := b.aead.NonceSize()
	if len(raw) < n {
		return "", false, errors.New("ciphertext too short")
	}
	plain, err := b.aead.Open(nil, raw[:n], raw[n:], nil)
	if err != nil {
		return "", false, fmt.Errorf("decrypt secret: wrong KABOARD_SECRET_KEY? %w", err)
	}
	return string(plain), false, nil
}
