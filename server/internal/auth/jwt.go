package auth

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"os"
	"strings"
	"sync"
)

const defaultJWTSecret = "multica-dev-secret-change-in-production"

var (
	jwtSecret     []byte
	jwtSecretOnce sync.Once
)

func JWTSecret() []byte {
	jwtSecretOnce.Do(func() {
		secret, err := ResolveJWTSecretForEnvironment(os.Getenv("JWT_SECRET"), os.Getenv("APP_ENV"))
		if err != nil {
			panic(err)
		}
		jwtSecret = []byte(secret)
	})

	return jwtSecret
}

func ResolveJWTSecretForEnvironment(secret, env string) (string, error) {
	if err := ValidateJWTSecretForEnvironment(secret, env); err != nil {
		return "", err
	}
	if strings.TrimSpace(secret) == "" {
		return defaultJWTSecret, nil
	}
	return secret, nil
}

func ValidateJWTSecretFromEnv() error {
	return ValidateJWTSecretForEnvironment(os.Getenv("JWT_SECRET"), os.Getenv("APP_ENV"))
}

func ValidateJWTSecretForEnvironment(secret, env string) error {
	if isDevelopmentLikeEnvironment(env) {
		return nil
	}
	secret = strings.TrimSpace(secret)
	if secret == "" {
		return fmt.Errorf("JWT_SECRET must be set outside development/test environments")
	}
	if secret == defaultJWTSecret {
		return fmt.Errorf("JWT_SECRET must not use the default development secret outside development/test environments")
	}
	return nil
}

func isDevelopmentLikeEnvironment(env string) bool {
	switch strings.ToLower(strings.TrimSpace(env)) {
	case "", "dev", "development", "local", "test", "testing":
		return true
	default:
		return false
	}
}

// GeneratePATToken creates a new personal access token: "mul_" + 40 random hex chars.
func GeneratePATToken() (string, error) {
	b := make([]byte, 20) // 20 bytes = 40 hex chars
	if _, err := rand.Read(b); err != nil {
		return "", fmt.Errorf("generate PAT token: %w", err)
	}
	return "mul_" + hex.EncodeToString(b), nil
}

// GenerateDaemonToken creates a new daemon auth token: "mdt_" + 40 random hex chars.
func GenerateDaemonToken() (string, error) {
	b := make([]byte, 20) // 20 bytes = 40 hex chars
	if _, err := rand.Read(b); err != nil {
		return "", fmt.Errorf("generate daemon token: %w", err)
	}
	return "mdt_" + hex.EncodeToString(b), nil
}

// HashToken returns the hex-encoded SHA-256 hash of a token string.
func HashToken(token string) string {
	h := sha256.Sum256([]byte(token))
	return hex.EncodeToString(h[:])
}
