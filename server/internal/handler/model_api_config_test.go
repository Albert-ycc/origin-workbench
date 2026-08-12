package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/multica-ai/multica/server/internal/runtimeconfig"
)

func writeProvidersFile(t *testing.T, path, content string) {
	t.Helper()
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatalf("write providers file: %v", err)
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

func TestCreateModelAPIProviderPersistsOnlyAfterConnectionPasses(t *testing.T) {
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
			_, _ = w.Write([]byte(`{"data":[{"id":"model-a"},{"id":"model-b"}]}`))
		default:
			t.Fatalf("unexpected model API path %q", r.URL.Path)
		}
	}))
	defer modelServer.Close()

	w := httptest.NewRecorder()
	req := newRequest(http.MethodPost, "/api/model-api-config/providers", map[string]any{
		"preset":     "custom",
		"name":       "Verified",
		"api_key":    "sk-good",
		"base_url":   modelServer.URL,
		"model_name": "model-a",
	})
	testHandler.CreateModelAPIProvider(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp []modelAPIProviderResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(resp) != 1 || resp[0].ID == "" || !strings.HasPrefix(resp[0].ID, "p_") {
		t.Fatalf("unexpected create response: %+v", resp)
	}
	if resp[0].Name != "Verified" || !resp[0].APIKeyConfigured || resp[0].Status != "online" {
		t.Fatalf("unexpected provider card: %+v", resp[0])
	}
	if resp[0].LastTest == nil || !resp[0].LastTest.OK {
		t.Fatalf("expected successful last_test: %+v", resp[0].LastTest)
	}
	if len(resp[0].DiscoveredModels) != 2 {
		t.Fatalf("expected 2 discovered models: %+v", resp[0].DiscoveredModels)
	}
}

func TestCreateModelAPIProviderRejectsFailedConnectionWithoutWritingFile(t *testing.T) {
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
	req := newRequest(http.MethodPost, "/api/model-api-config/providers", map[string]any{
		"preset":     "custom",
		"api_key":    "sk-bad",
		"base_url":   modelServer.URL,
		"model_name": "model-a",
	})
	testHandler.CreateModelAPIProvider(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for failed connection, got %d: %s", w.Code, w.Body.String())
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatalf("config file should not be written after failed test, stat err=%v", err)
	}
}

func TestPatchModelAPIProviderSkipsConnectionTest(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	path := filepath.Join(t.TempDir(), "model_api_config.json")
	clearModelAPIConfigEnv(t, path)

	var testHit bool
	modelServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		testHit = true
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer modelServer.Close()

	writeProvidersFile(t, path, fmt.Sprintf(`{"version":2,"providers":[{"id":"p_toggle","name":"Toggle","preset":"custom","enabled":true,"provider":"custom","api_key":"sk-x","base_url":%q,"model_name":"m1"}]}`, modelServer.URL))

	w := httptest.NewRecorder()
	req := newRequest(http.MethodPatch, "/api/model-api-config/providers/p_toggle", map[string]any{"enabled": false})
	req = withURLParam(req, "id", "p_toggle")
	testHandler.PatchModelAPIProvider(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	if testHit {
		t.Fatal("patch must not test the model API connection")
	}
	var resp []modelAPIProviderResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(resp) != 1 || resp[0].Enabled {
		t.Fatalf("expected provider disabled: %+v", resp)
	}
}

func TestDeleteModelAPIProviderRejectsWhenActiveAgentBound(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "model_api_config.json")
	clearModelAPIConfigEnv(t, path)
	writeProvidersFile(t, path, `{"version":2,"providers":[{"id":"p_del","name":"Delete Me","preset":"custom","enabled":true,"provider":"custom","api_key":"sk-x","base_url":"https://x.example.test/v1","model_name":"m1"}]}`)

	daemonID := "origin-api:" + testUserID + ":p_del"
	var runtimeID string
	if err := testPool.QueryRow(ctx, `
		INSERT INTO agent_runtime (workspace_id, daemon_id, name, runtime_mode, provider, status, device_info, metadata, owner_id, last_seen_at)
		VALUES ($1, $2, 'Delete Me', 'cloud', 'custom', 'online', '', $3, $4, now())
		RETURNING id
	`, testWorkspaceID, daemonID, []byte(`{"api_runtime":true,"managed_by":"origin_api"}`), testUserID).Scan(&runtimeID); err != nil {
		t.Fatalf("insert runtime: %v", err)
	}
	t.Cleanup(func() { testPool.Exec(ctx, `DELETE FROM agent_runtime WHERE id = $1`, runtimeID) })

	var agentID string
	if err := testPool.QueryRow(ctx, `
		INSERT INTO agent (workspace_id, name, description, runtime_mode, runtime_config, runtime_id, visibility, max_concurrent_tasks, owner_id)
		VALUES ($1, 'Bound Agent', '', 'cloud', '{}'::jsonb, $2, 'workspace', 1, $3)
		RETURNING id
	`, testWorkspaceID, runtimeID, testUserID).Scan(&agentID); err != nil {
		t.Fatalf("insert agent: %v", err)
	}
	t.Cleanup(func() { testPool.Exec(ctx, `DELETE FROM agent WHERE id = $1`, agentID) })

	w := httptest.NewRecorder()
	req := newRequest(http.MethodDelete, "/api/model-api-config/providers/p_del", nil)
	req = withURLParam(req, "id", "p_del")
	testHandler.DeleteModelAPIProvider(w, req)

	if w.Code != http.StatusConflict {
		t.Fatalf("expected 409, got %d: %s", w.Code, w.Body.String())
	}
	if !strings.Contains(w.Body.String(), "agent") {
		t.Fatalf("expected agent-bound error, got %s", w.Body.String())
	}
}

func TestDeleteModelAPIProviderRejectsWhenOtherUserAgentBound(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "model_api_config.json")
	clearModelAPIConfigEnv(t, path)
	writeProvidersFile(t, path, `{"version":2,"providers":[{"id":"p_del","name":"Shared","preset":"custom","enabled":true,"provider":"custom","api_key":"sk-x","base_url":"https://x.example.test/v1","model_name":"m1"}]}`)

	var otherUserID string
	if err := testPool.QueryRow(ctx, `INSERT INTO "user" (name, email) VALUES ('Other User', 'other-provider-test@multica.ai') RETURNING id`).Scan(&otherUserID); err != nil {
		t.Fatalf("insert other user: %v", err)
	}
	t.Cleanup(func() { testPool.Exec(ctx, `DELETE FROM "user" WHERE id = $1`, otherUserID) })

	daemonID := "origin-api:" + otherUserID + ":p_del"
	var runtimeID string
	if err := testPool.QueryRow(ctx, `
		INSERT INTO agent_runtime (workspace_id, daemon_id, name, runtime_mode, provider, status, device_info, metadata, owner_id, last_seen_at)
		VALUES ($1, $2, 'Shared', 'cloud', 'custom', 'online', '', $3, $4, now())
		RETURNING id
	`, testWorkspaceID, daemonID, []byte(`{"api_runtime":true,"managed_by":"origin_api"}`), otherUserID).Scan(&runtimeID); err != nil {
		t.Fatalf("insert runtime: %v", err)
	}
	t.Cleanup(func() { testPool.Exec(ctx, `DELETE FROM agent_runtime WHERE id = $1`, runtimeID) })

	var agentID string
	if err := testPool.QueryRow(ctx, `
		INSERT INTO agent (workspace_id, name, description, runtime_mode, runtime_config, runtime_id, visibility, max_concurrent_tasks, owner_id)
		VALUES ($1, 'Other Agent', '', 'cloud', '{}'::jsonb, $2, 'workspace', 1, $3)
		RETURNING id
	`, testWorkspaceID, runtimeID, otherUserID).Scan(&agentID); err != nil {
		t.Fatalf("insert agent: %v", err)
	}
	t.Cleanup(func() { testPool.Exec(ctx, `DELETE FROM agent WHERE id = $1`, agentID) })

	w := httptest.NewRecorder()
	req := newRequest(http.MethodDelete, "/api/model-api-config/providers/p_del", nil)
	req = withURLParam(req, "id", "p_del")
	testHandler.DeleteModelAPIProvider(w, req)

	if w.Code != http.StatusConflict {
		t.Fatalf("expected 409 for provider used by another user, got %d: %s", w.Code, w.Body.String())
	}
}

func TestSyncConfiguredAPIRuntimesSkipsCleanupOnUnreadableProvidersFile(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "model_api_config.json")
	clearModelAPIConfigEnv(t, path)
	// Corrupt the providers file so it reads as "unreadable", not "absent".
	writeProvidersFile(t, path, `{"version":2,"providers":[`)

	daemonID := "origin-api:" + testUserID + ":ghost"
	var runtimeID string
	if err := testPool.QueryRow(ctx, `
		INSERT INTO agent_runtime (workspace_id, daemon_id, name, runtime_mode, provider, status, device_info, metadata, owner_id, last_seen_at)
		VALUES ($1, $2, 'Ghost', 'cloud', 'custom', 'online', '', $3, $4, now())
		RETURNING id
	`, testWorkspaceID, daemonID, []byte(`{"api_runtime":true,"managed_by":"origin_api"}`), testUserID).Scan(&runtimeID); err != nil {
		t.Fatalf("insert runtime: %v", err)
	}
	t.Cleanup(func() { testPool.Exec(ctx, `DELETE FROM agent_runtime WHERE id = $1`, runtimeID) })

	req := newRequest(http.MethodGet, "/api/runtimes", nil)
	if err := testHandler.syncConfiguredAPIRuntimes(req, testWorkspaceID, testUserID); err != nil {
		t.Fatalf("sync: %v", err)
	}

	var count int
	if err := testPool.QueryRow(ctx, `SELECT count(*) FROM agent_runtime WHERE id = $1`, runtimeID).Scan(&count); err != nil {
		t.Fatalf("count runtime: %v", err)
	}
	if count != 1 {
		t.Fatalf("expected orphan runtime to survive unreadable providers file, count=%d", count)
	}
}
