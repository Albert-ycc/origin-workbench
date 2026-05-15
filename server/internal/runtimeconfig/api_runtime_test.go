package runtimeconfig

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestLoadAPIRuntimeConfigReturnsFalseWithoutOriginEnv(t *testing.T) {
	cfg, ok := LoadAPIRuntimeConfig(func(string) string { return "" })
	if ok {
		t.Fatalf("expected no API runtime config, got %+v", cfg)
	}
}

func TestLoadAPIRuntimeConfigBuildsRedactedMetadata(t *testing.T) {
	env := map[string]string{
		EnvProvider:    "openai_compatible",
		EnvAPIKey:      "sk-secret-value",
		EnvBaseURL:     "https://models.example.test/v1",
		EnvModelNames:  "gpt-4.1-mini, gpt-4.1",
		EnvRuntimeName: "External Model API",
	}
	cfg, ok := LoadAPIRuntimeConfig(func(key string) string { return env[key] })
	if !ok {
		t.Fatal("expected API runtime config")
	}
	if cfg.Provider != "openai_compatible" {
		t.Fatalf("provider mismatch: %q", cfg.Provider)
	}
	if cfg.APIKey != "sk-secret-value" || cfg.BaseURL != "https://models.example.test/v1" {
		t.Fatalf("runtime config should retain secrets in memory only, got api_key=%q base_url=%q", cfg.APIKey, cfg.BaseURL)
	}
	if cfg.Status() != "online" {
		t.Fatalf("expected online status, got %q", cfg.Status())
	}

	raw, err := MetadataFromConfig(cfg)
	if err != nil {
		t.Fatalf("metadata: %v", err)
	}
	if strings.Contains(string(raw), "sk-secret-value") {
		t.Fatalf("metadata must not contain API key: %s", string(raw))
	}
	if strings.Contains(string(raw), "models.example.test") {
		t.Fatalf("metadata must not expose base URL: %s", string(raw))
	}

	var md APIRuntimeMetadata
	if err := json.Unmarshal(raw, &md); err != nil {
		t.Fatalf("unmarshal metadata: %v", err)
	}
	if !md.APIRuntime || md.ManagedBy != ManagedByOriginAPI {
		t.Fatalf("metadata should mark an Origin API runtime: %+v", md)
	}
	if !md.APIKeyConfigured || !md.BaseURLConfigured {
		t.Fatalf("metadata should expose configured booleans only: %+v", md)
	}
	if md.TaskExecution != "chat_only" {
		t.Fatalf("task execution metadata = %q, want chat_only", md.TaskExecution)
	}
	if len(md.Models) != 2 {
		t.Fatalf("expected 2 models, got %d", len(md.Models))
	}
	if md.Models[0].ID != "gpt-4.1-mini" || !md.Models[0].Default {
		t.Fatalf("first model should be default, got %+v", md.Models[0])
	}
}

func TestAPIRuntimeModelsFromMetadata(t *testing.T) {
	cfg := APIRuntimeConfig{
		Provider:          "openai_compatible",
		RuntimeName:       "API",
		ModelIDs:          []string{"model-a", "model-b"},
		DefaultModel:      "model-b",
		APIKeyConfigured:  true,
		BaseURLConfigured: true,
	}
	raw, err := MetadataFromConfig(cfg)
	if err != nil {
		t.Fatalf("metadata: %v", err)
	}
	if !IsAPIRuntimeMetadata(raw) {
		t.Fatal("expected metadata to be detected as API runtime")
	}
	models := ModelsFromMetadata(raw)
	if len(models) != 2 {
		t.Fatalf("expected 2 models, got %d", len(models))
	}
	if models[1].ID != "model-b" || !models[1].Default {
		t.Fatalf("expected model-b as default, got %+v", models[1])
	}
}
