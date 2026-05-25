package handler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/multica-ai/multica/server/internal/runtimeconfig"
)

func TestSaveModelAPIConfigRejectsFailedConnectionWithoutWritingFile(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	path := filepath.Join(t.TempDir(), "model_api_config.json")
	clearModelAPIConfigEnv(t, path)

	modelServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte(`{"error":{"message":"invalid api key"}}`))
	}))
	defer modelServer.Close()

	w := httptest.NewRecorder()
	req := newRequest(http.MethodPut, "/api/model-api-config", map[string]any{
		"api_key":    "sk-bad",
		"base_url":   modelServer.URL,
		"model_name": "model-a",
	})
	testHandler.SaveModelAPIConfig(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for failed connection, got %d: %s", w.Code, w.Body.String())
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatalf("config file should not be written after failed test, stat err=%v", err)
	}
}

func TestSaveModelAPIConfigPersistsOnlyAfterConnectionTestPasses(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	path := filepath.Join(t.TempDir(), "model_api_config.json")
	clearModelAPIConfigEnv(t, path)
	var testHit bool

	modelServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/chat/completions":
			testHit = true
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"ok"}}]}`))
		case "/models":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"data":[{"id":"model-a"},{"id":"model-b"}]}`))
		default:
			t.Fatalf("unexpected model API path %q", r.URL.Path)
		}
	}))
	defer modelServer.Close()

	w := httptest.NewRecorder()
	req := newRequest(http.MethodPut, "/api/model-api-config", map[string]any{
		"api_key":      "sk-good",
		"base_url":     modelServer.URL,
		"model_name":   "model-a",
		"runtime_name": "Verified API",
	})
	testHandler.SaveModelAPIConfig(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	if !testHit {
		t.Fatal("save should test the model API before writing config")
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read saved config: %v", err)
	}
	var saved runtimeconfig.SavedAPIRuntimeConfig
	if err := json.Unmarshal(raw, &saved); err != nil {
		t.Fatalf("decode saved config: %v", err)
	}
	if saved.APIKey != "sk-good" || saved.ModelName != "model-a" || saved.RuntimeName != "Verified API" {
		t.Fatalf("saved config mismatch: %+v", saved)
	}
	if saved.LastTest == nil || !saved.LastTest.OK || saved.LastTest.Code != "ok" {
		t.Fatalf("expected successful last_test to be saved, got %+v", saved.LastTest)
	}
	if len(saved.DiscoveredModels) != 2 || saved.DiscoveredModels[1] != "model-b" {
		t.Fatalf("expected discovered models to be saved, got %+v", saved.DiscoveredModels)
	}
}

func TestSaveModelAPIConfigRejectsMissingToolRoot(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	path := filepath.Join(t.TempDir(), "model_api_config.json")
	clearModelAPIConfigEnv(t, path)
	var testHit bool

	modelServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		testHit = true
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"ok"}}]}`))
	}))
	defer modelServer.Close()

	w := httptest.NewRecorder()
	req := newRequest(http.MethodPut, "/api/model-api-config", map[string]any{
		"api_key":    "sk-good",
		"base_url":   modelServer.URL,
		"model_name": "model-a",
		"tool_roots": filepath.Join(t.TempDir(), "missing"),
	})
	testHandler.SaveModelAPIConfig(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for missing tool root, got %d: %s", w.Code, w.Body.String())
	}
	if testHit {
		t.Fatal("save should validate tool roots before calling the model API")
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatalf("config file should not be written after invalid tool root, stat err=%v", err)
	}
}

func TestTestModelAPIConfigReturnsDiagnosticsWithoutWritingFile(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	path := filepath.Join(t.TempDir(), "model_api_config.json")
	clearModelAPIConfigEnv(t, path)

	modelServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/chat/completions":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"ok"}}]}`))
		case "/models":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"data":[{"id":"model-a"}]}`))
		default:
			t.Fatalf("unexpected model API path %q", r.URL.Path)
		}
	}))
	defer modelServer.Close()

	w := httptest.NewRecorder()
	req := newRequest(http.MethodPost, "/api/model-api-config/test", map[string]any{
		"api_key":    "sk-good",
		"base_url":   modelServer.URL,
		"model_name": "model-a",
	})
	testHandler.TestModelAPIConfig(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var response struct {
		OK               bool     `json:"ok"`
		LastTestedAt     string   `json:"last_tested_at"`
		DiscoveredModels []string `json:"discovered_models"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if !response.OK || response.LastTestedAt == "" || len(response.DiscoveredModels) != 1 {
		t.Fatalf("unexpected test response: %+v", response)
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatalf("test endpoint should not write config file, stat err=%v", err)
	}
}

func clearModelAPIConfigEnv(t *testing.T, configPath string) {
	t.Helper()
	t.Setenv(runtimeconfig.EnvConfigFile, configPath)
	for _, name := range []string{
		runtimeconfig.EnvProvider,
		runtimeconfig.EnvAPIKey,
		runtimeconfig.EnvBaseURL,
		runtimeconfig.EnvModelName,
		runtimeconfig.EnvModelNames,
		runtimeconfig.EnvRuntimeName,
		runtimeconfig.EnvToolRoots,
		runtimeconfig.EnvOpenAIAPIKey,
		runtimeconfig.EnvOpenAIBaseURL,
		runtimeconfig.EnvOpenAIAPIBase,
		runtimeconfig.EnvOpenAIAPIBaseURL,
		runtimeconfig.EnvOpenAIModel,
		runtimeconfig.EnvOpenAIModelName,
		runtimeconfig.EnvOpenAIModels,
	} {
		t.Setenv(name, "")
	}
}
