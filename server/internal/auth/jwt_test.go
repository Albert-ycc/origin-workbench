package auth

import (
	"strings"
	"sync"
	"testing"
)

func TestValidateJWTSecretForEnvironmentRejectsProductionDefaults(t *testing.T) {
	tests := []struct {
		name   string
		env    string
		secret string
	}{
		{name: "production missing", env: "production", secret: ""},
		{name: "staging missing", env: "staging", secret: ""},
		{name: "production default", env: "production", secret: defaultJWTSecret},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := ValidateJWTSecretForEnvironment(tt.secret, tt.env)
			if err == nil {
				t.Fatal("expected invalid JWT secret error")
			}
			if strings.Contains(err.Error(), tt.secret) && tt.secret != "" {
				t.Fatalf("error should not echo the secret: %v", err)
			}
		})
	}
}

func TestValidateJWTSecretForEnvironmentAllowsDevAndCustomSecrets(t *testing.T) {
	tests := []struct {
		name   string
		env    string
		secret string
	}{
		{name: "empty local env missing", env: "", secret: ""},
		{name: "development missing", env: "development", secret: ""},
		{name: "test default", env: "test", secret: defaultJWTSecret},
		{name: "production custom", env: "production", secret: "custom-production-secret"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if err := ValidateJWTSecretForEnvironment(tt.secret, tt.env); err != nil {
				t.Fatalf("expected valid JWT secret config: %v", err)
			}
		})
	}
}

func TestJWTSecretFallsBackOnlyForDevelopmentLikeEnvironments(t *testing.T) {
	resetJWTSecretForTest(t)
	t.Setenv("APP_ENV", "development")
	t.Setenv("JWT_SECRET", "")

	got := string(JWTSecret())
	if got != defaultJWTSecret {
		t.Fatalf("JWTSecret() = %q, want default dev secret", got)
	}
}

func TestJWTSecretPanicsForProductionDefault(t *testing.T) {
	resetJWTSecretForTest(t)
	t.Setenv("APP_ENV", "production")
	t.Setenv("JWT_SECRET", "")

	defer func() {
		if recover() == nil {
			t.Fatal("expected panic for invalid production JWT secret")
		}
	}()
	_ = JWTSecret()
}

func resetJWTSecretForTest(t *testing.T) {
	t.Helper()
	jwtSecret = nil
	jwtSecretOnce = sync.Once{}
	t.Cleanup(func() {
		jwtSecret = nil
		jwtSecretOnce = sync.Once{}
	})
}
