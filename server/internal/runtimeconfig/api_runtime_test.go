package runtimeconfig

import (
	"encoding/json"
	"os"
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
	if md.TaskExecution != "tool_loop" {
		t.Fatalf("task execution metadata = %q, want tool_loop", md.TaskExecution)
	}
	if !md.SupportsTools {
		t.Fatalf("metadata should advertise API runtime tools: %+v", md)
	}
	if !contains(md.OptionalEnv, EnvToolRoots) {
		t.Fatalf("optional env should include %s: %+v", EnvToolRoots, md.OptionalEnv)
	}
	if len(md.Models) != 2 {
		t.Fatalf("expected 2 models, got %d", len(md.Models))
	}
	if md.Models[0].ID != "gpt-4.1-mini" || !md.Models[0].Default {
		t.Fatalf("first model should be default, got %+v", md.Models[0])
	}
}

func TestLoadAPIRuntimeConfigAcceptsOpenAICompatibleEnvAliases(t *testing.T) {
	env := map[string]string{
		EnvOpenAIAPIKey:  "sk-cc-switch",
		EnvOpenAIBaseURL: "https://relay.example.test/v1",
		EnvOpenAIModel:   "gpt-5-codex",
		EnvOpenAIModels:  "gpt-5-codex,claude-sonnet-4",
	}

	cfg, ok := LoadAPIRuntimeConfig(func(key string) string { return env[key] })
	if !ok {
		t.Fatal("expected API runtime config from OpenAI-compatible aliases")
	}
	if cfg.APIKey != "sk-cc-switch" {
		t.Fatalf("api key = %q", cfg.APIKey)
	}
	if cfg.BaseURL != "https://relay.example.test/v1" {
		t.Fatalf("base url = %q", cfg.BaseURL)
	}
	if cfg.DefaultModel != "gpt-5-codex" {
		t.Fatalf("default model = %q", cfg.DefaultModel)
	}
	if cfg.ConfigSource != "environment:openai_compatible" {
		t.Fatalf("config source = %q", cfg.ConfigSource)
	}
	if len(cfg.ModelIDs) != 2 || cfg.ModelIDs[1] != "claude-sonnet-4" {
		t.Fatalf("model ids = %+v", cfg.ModelIDs)
	}
}

func TestLoadAPIRuntimeConfigPrefersOriginEnvOverOpenAICompatibleAliases(t *testing.T) {
	env := map[string]string{
		EnvAPIKey:        "sk-origin",
		EnvBaseURL:       "https://origin.example.test/v1",
		EnvModelName:     "origin-model",
		EnvOpenAIAPIKey:  "sk-cc-switch",
		EnvOpenAIBaseURL: "https://relay.example.test/v1",
		EnvOpenAIModel:   "relay-model",
	}

	cfg, ok := LoadAPIRuntimeConfig(func(key string) string { return env[key] })
	if !ok {
		t.Fatal("expected API runtime config")
	}
	if cfg.APIKey != "sk-origin" || cfg.BaseURL != "https://origin.example.test/v1" {
		t.Fatalf("Origin env should win, got api_key=%q base_url=%q", cfg.APIKey, cfg.BaseURL)
	}
	if cfg.DefaultModel != "origin-model" {
		t.Fatalf("Origin model should win, got %q", cfg.DefaultModel)
	}
	if cfg.ConfigSource != "environment:origin" {
		t.Fatalf("config source = %q", cfg.ConfigSource)
	}
}

func TestLoadAPIRuntimeConfigParsesToolRoots(t *testing.T) {
	env := map[string]string{
		EnvAPIKey:      "sk-origin",
		EnvModelName:   "origin-model",
		EnvToolRoots:   " /workspace ,/workspace,/tmp/project ",
		EnvRuntimeName: "External Model API",
	}

	cfg, ok := LoadAPIRuntimeConfig(func(key string) string { return env[key] })
	if !ok {
		t.Fatal("expected API runtime config")
	}
	if len(cfg.ToolRoots) != 2 || cfg.ToolRoots[0] != "/workspace" || cfg.ToolRoots[1] != "/tmp/project" {
		t.Fatalf("tool roots = %+v", cfg.ToolRoots)
	}
}

func TestLoadAPIRuntimeConfigExpandsHomeInToolRoots(t *testing.T) {
	env := map[string]string{
		EnvAPIKey:    "sk-origin",
		EnvModelName: "origin-model",
		EnvToolRoots: "$HOME/OriginWorkbenchMount,~/projects,${HOME}/OriginWorkbenchMount",
		"HOME":       "/Users/tester",
	}

	cfg, ok := LoadAPIRuntimeConfig(func(key string) string { return env[key] })
	if !ok {
		t.Fatal("expected API runtime config")
	}
	want := []string{"/Users/tester/OriginWorkbenchMount", "/Users/tester/projects"}
	if len(cfg.ToolRoots) != len(want) {
		t.Fatalf("tool roots = %+v, want %+v", cfg.ToolRoots, want)
	}
	for i := range want {
		if cfg.ToolRoots[i] != want[i] {
			t.Fatalf("tool roots = %+v, want %+v", cfg.ToolRoots, want)
		}
	}
}

func TestLoadAPIRuntimeConfigFromSourcesReadsSavedConfig(t *testing.T) {
	dir := t.TempDir()
	path := dir + "/model_api_config.json"
	writeFile(t, path, `{
		"provider":"openai_compatible",
		"api_key":"sk-file-secret",
		"base_url":"https://saved.example.test/v1",
		"model_name":"saved-model",
		"model_names":"saved-model, saved-alt",
		"runtime_name":"Saved API",
		"tool_roots":" /workspace , /tmp/project "
	}`)

	env := map[string]string{EnvConfigFile: path}
	cfg, ok := LoadAPIRuntimeConfigFromSources(func(key string) string { return env[key] })
	if !ok {
		t.Fatal("expected API runtime config from saved file")
	}
	if cfg.APIKey != "sk-file-secret" || cfg.BaseURL != "https://saved.example.test/v1" {
		t.Fatalf("saved config not loaded: %+v", cfg)
	}
	if cfg.DefaultModel != "saved-model" || len(cfg.ModelIDs) != 2 || cfg.ModelIDs[1] != "saved-alt" {
		t.Fatalf("saved model config mismatch: %+v", cfg)
	}
	if cfg.RuntimeName != "Saved API" {
		t.Fatalf("runtime name = %q", cfg.RuntimeName)
	}
	if cfg.ConfigSource != "file" {
		t.Fatalf("config source = %q", cfg.ConfigSource)
	}
	if len(cfg.ToolRoots) != 2 || cfg.ToolRoots[0] != "/workspace" || cfg.ToolRoots[1] != "/tmp/project" {
		t.Fatalf("tool roots = %+v", cfg.ToolRoots)
	}
}

func TestLoadAPIRuntimeConfigFromSourcesPrefersEnvOverSavedConfig(t *testing.T) {
	dir := t.TempDir()
	path := dir + "/model_api_config.json"
	writeFile(t, path, `{
		"api_key":"sk-file-secret",
		"base_url":"https://saved.example.test/v1",
		"model_name":"saved-model"
	}`)

	env := map[string]string{
		EnvConfigFile: path,
		EnvAPIKey:     "sk-env-secret",
		EnvBaseURL:    "https://env.example.test/v1",
		EnvModelName:  "env-model",
	}
	cfg, ok := LoadAPIRuntimeConfigFromSources(func(key string) string { return env[key] })
	if !ok {
		t.Fatal("expected API runtime config")
	}
	if cfg.APIKey != "sk-env-secret" || cfg.BaseURL != "https://env.example.test/v1" || cfg.DefaultModel != "env-model" {
		t.Fatalf("env config should win over saved file, got %+v", cfg)
	}
	if cfg.ConfigSource != "environment:origin" {
		t.Fatalf("config source = %q", cfg.ConfigSource)
	}
}

func TestSaveAPIRuntimeConfigFilePersistsLastTestAndDiscoveredModelsWithoutLeakingSecretInLastTest(t *testing.T) {
	dir := t.TempDir()
	path := dir + "/model_api_config.json"

	err := SaveAPIRuntimeConfigFile(path, SavedAPIRuntimeConfig{
		Provider:   "openai_compatible",
		APIKey:     "sk-file-secret",
		BaseURL:    "https://saved.example.test/v1",
		ModelName:  "model-a",
		ModelNames: "model-a",
		LastTest: &APIRuntimeConnectionTest{
			TestedAt:  "2026-05-24T10:20:30Z",
			OK:        false,
			Code:      "auth_failed",
			Message:   "API Key 无效或没有访问权限。",
			Detail:    "request failed with sk-file-secret",
			LatencyMS: 123,
		},
		DiscoveredModels: []string{"model-a", "model-b"},
	})
	if err != nil {
		t.Fatalf("save config: %v", err)
	}

	saved, ok, err := LoadSavedAPIRuntimeConfig(path)
	if err != nil || !ok {
		t.Fatalf("load saved config ok=%v err=%v", ok, err)
	}
	if saved.LastTest == nil {
		t.Fatal("expected last_test to be persisted")
	}
	if saved.LastTest.Code != "auth_failed" || saved.LastTest.LatencyMS != 123 {
		t.Fatalf("last_test mismatch: %+v", saved.LastTest)
	}
	if strings.Contains(saved.LastTest.Detail, "sk-file-secret") {
		t.Fatalf("last_test detail must not leak API key: %+v", saved.LastTest)
	}
	if len(saved.DiscoveredModels) != 2 || saved.DiscoveredModels[1] != "model-b" {
		t.Fatalf("discovered_models mismatch: %+v", saved.DiscoveredModels)
	}
}

func contains(items []string, want string) bool {
	for _, item := range items {
		if item == want {
			return true
		}
	}
	return false
}

func writeFile(t *testing.T, path string, content string) {
	t.Helper()
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatalf("write file: %v", err)
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
