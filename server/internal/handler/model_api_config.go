package handler

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/multica-ai/multica/server/internal/modelapi"
	"github.com/multica-ai/multica/server/internal/runtimeconfig"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

type modelAPIProviderRequest struct {
	Preset      string `json:"preset"`
	Name        string `json:"name"`
	Enabled     *bool  `json:"enabled"`
	APIKey      string `json:"api_key"`
	BaseURL     string `json:"base_url"`
	ModelName   string `json:"model_name"`
	ModelNames  string `json:"model_names"`
	RuntimeName string `json:"runtime_name"`
	ToolRoots   string `json:"tool_roots"`
}

type modelAPIProviderResponse struct {
	ID                string                                  `json:"id"`
	Name              string                                  `json:"name"`
	Preset            string                                  `json:"preset"`
	Enabled           bool                                    `json:"enabled"`
	ReadOnly          bool                                    `json:"readonly"`
	Provider          string                                  `json:"provider"`
	APIKeyConfigured  bool                                    `json:"api_key_configured"`
	BaseURL           string                                  `json:"base_url,omitempty"`
	BaseURLConfigured bool                                    `json:"base_url_configured"`
	ModelName         string                                  `json:"model_name,omitempty"`
	ModelNames        string                                  `json:"model_names,omitempty"`
	RuntimeName       string                                  `json:"runtime_name,omitempty"`
	ToolRoots         string                                  `json:"tool_roots,omitempty"`
	ConfigSource      string                                  `json:"config_source"`
	Status            string                                  `json:"status"`
	Ready             bool                                    `json:"ready"`
	Models            []runtimeconfig.APIRuntimeModel         `json:"models,omitempty"`
	LastTest          *runtimeconfig.APIRuntimeConnectionTest `json:"last_test,omitempty"`
	DiscoveredModels  []string                                `json:"discovered_models,omitempty"`
}

type modelAPIConnectionTestResponse struct {
	modelapi.ConnectionTestResult
	LastTestedAt     string   `json:"last_tested_at,omitempty"`
	LatencyMS        int64    `json:"latency_ms,omitempty"`
	DiscoveredModels []string `json:"discovered_models,omitempty"`
}

func newProviderID() string {
	b := make([]byte, 4)
	rand.Read(b)
	return "p_" + hex.EncodeToString(b)
}

// ---------------------------------------------------------------------------
// Provider CRUD
// ---------------------------------------------------------------------------

func (h *Handler) ListModelAPIProviders(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, h.listModelAPIProvidersResponse())
}

func (h *Handler) GetModelAPIProvider(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	p, ok := runtimeconfig.FindProvider(id, os.Getenv)
	if !ok {
		writeError(w, http.StatusNotFound, "provider not found")
		return
	}
	writeJSON(w, http.StatusOK, modelAPIProviderResponseFrom(p, h.providerConfig(p)))
}

func (h *Handler) CreateModelAPIProvider(w http.ResponseWriter, r *http.Request) {
	if !h.requireModelAPIConfigAdmin(w, r) {
		return
	}
	var req modelAPIProviderRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	p := h.providerFromRequest(req)
	p = runtimeconfig.ApplyProviderPreset(p)
	if p.Name == "" {
		p.Name = p.RuntimeName
	}
	if !h.validateProviderFields(w, &p) {
		return
	}
	if !h.validateProviderToolRoots(w, &p) {
		return
	}

	testResult, lastTest, discovered := h.testSavedProvider(r.Context(), p, true)
	p.LastTest = lastTest
	p.DiscoveredModels = discovered
	if !testResult.OK {
		writeJSON(w, http.StatusBadRequest, map[string]any{
			"error":  testResult.Message,
			"result": modelAPIConnectionTestResponseFrom(testResult, lastTest, discovered),
		})
		return
	}

	p.ID = newProviderID()
	if err := h.persistProvider(r, p); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to save model API provider")
		return
	}
	writeJSON(w, http.StatusOK, h.listModelAPIProvidersResponse())
}

func (h *Handler) UpdateModelAPIProvider(w http.ResponseWriter, r *http.Request) {
	if !h.requireModelAPIConfigAdmin(w, r) {
		return
	}
	id := chi.URLParam(r, "id")
	if id == runtimeconfig.EnvProviderID {
		writeError(w, http.StatusBadRequest, "environment provider is read-only")
		return
	}
	existing, ok := runtimeconfig.FindProvider(id, os.Getenv)
	if !ok {
		writeError(w, http.StatusNotFound, "provider not found")
		return
	}

	var req modelAPIProviderRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	p := h.providerFromRequest(req)
	p.ID = existing.ID
	p = runtimeconfig.ApplyProviderPreset(p)
	if strings.TrimSpace(p.APIKey) == "" {
		p.APIKey = existing.APIKey
	}
	if p.Name == "" {
		p.Name = existing.Name
	}
	if !h.validateProviderFields(w, &p) {
		return
	}
	if !h.validateProviderToolRoots(w, &p) {
		return
	}

	testResult, lastTest, discovered := h.testSavedProvider(r.Context(), p, true)
	p.LastTest = lastTest
	p.DiscoveredModels = discovered
	if !testResult.OK {
		writeJSON(w, http.StatusBadRequest, map[string]any{
			"error":  testResult.Message,
			"result": modelAPIConnectionTestResponseFrom(testResult, lastTest, discovered),
		})
		return
	}

	if err := h.persistProvider(r, p); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to save model API provider")
		return
	}
	writeJSON(w, http.StatusOK, h.listModelAPIProvidersResponse())
}

func (h *Handler) PatchModelAPIProvider(w http.ResponseWriter, r *http.Request) {
	if !h.requireModelAPIConfigAdmin(w, r) {
		return
	}
	id := chi.URLParam(r, "id")
	if id == runtimeconfig.EnvProviderID {
		writeError(w, http.StatusBadRequest, "environment provider is read-only")
		return
	}
	existing, ok := runtimeconfig.FindProvider(id, os.Getenv)
	if !ok {
		writeError(w, http.StatusNotFound, "provider not found")
		return
	}

	var req struct {
		Enabled *bool `json:"enabled"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.Enabled == nil {
		writeError(w, http.StatusBadRequest, "enabled is required")
		return
	}

	existing.Enabled = *req.Enabled
	if err := h.persistProvider(r, existing); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to save model API provider")
		return
	}
	writeJSON(w, http.StatusOK, h.listModelAPIProvidersResponse())
}

func (h *Handler) DeleteModelAPIProvider(w http.ResponseWriter, r *http.Request) {
	if !h.requireModelAPIConfigAdmin(w, r) {
		return
	}
	id := chi.URLParam(r, "id")
	if id == runtimeconfig.EnvProviderID {
		writeError(w, http.StatusBadRequest, "environment provider is read-only")
		return
	}
	if _, ok := runtimeconfig.FindProvider(id, os.Getenv); !ok {
		writeError(w, http.StatusNotFound, "provider not found")
		return
	}

	workspaceID := h.resolveWorkspaceID(r)
	userID := requestUserID(r)

	runtimes, err := h.Queries.ListAgentRuntimes(r.Context(), parseUUID(workspaceID))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list runtimes")
		return
	}

	// The providers file is shared across users, but each user gets their own
	// runtime row (daemon_id embeds the owner). Reject deletion while ANY
	// user's runtime for this provider still has active agents, and only touch
	// the requesting user's own runtime row.
	var target *db.AgentRuntime
	var totalActive int64
	for i := range runtimes {
		rt := &runtimes[i]
		if !runtimeconfig.IsAPIRuntimeMetadata(rt.Metadata) || !rt.DaemonID.Valid || !rt.OwnerID.Valid {
			continue
		}
		owner := uuidToString(rt.OwnerID)
		expectedDaemonID := runtimeconfig.SavedProvider{ID: id}.DaemonID(owner)
		if rt.DaemonID.String != expectedDaemonID {
			continue
		}
		count, err := h.Queries.CountActiveAgentsByRuntime(r.Context(), rt.ID)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed to check runtime dependencies")
			return
		}
		totalActive += count
		if owner == userID {
			target = rt
		}
	}
	if totalActive > 0 {
		writeError(w, http.StatusConflict, fmt.Sprintf("该 Provider 正被 %d 个 agent 使用，请先解绑或归档", totalActive))
		return
	}
	if target != nil {
		if err := h.Queries.DeleteArchivedAgentsByRuntime(r.Context(), target.ID); err != nil {
			writeError(w, http.StatusInternalServerError, "failed to clean up archived agents")
			return
		}
		if err := h.Queries.DeleteAgentRuntime(r.Context(), target.ID); err != nil {
			writeError(w, http.StatusInternalServerError, "failed to delete runtime")
			return
		}
	}

	providers, err := runtimeconfig.LoadProvidersFile(runtimeconfig.ConfigFilePath(os.Getenv))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load providers")
		return
	}
	kept := providers[:0]
	for _, p := range providers {
		if p.ID != id {
			kept = append(kept, p)
		}
	}
	if err := runtimeconfig.SaveProvidersFile(runtimeconfig.ConfigFilePath(os.Getenv), kept); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to save model API providers")
		return
	}
	if err := h.syncConfiguredAPIRuntimes(r, workspaceID, userID); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to refresh model API runtime")
		return
	}
	writeJSON(w, http.StatusOK, h.listModelAPIProvidersResponse())
}

func (h *Handler) TestModelAPIProvider(w http.ResponseWriter, r *http.Request) {
	if !h.requireModelAPIConfigAdmin(w, r) {
		return
	}
	id := chi.URLParam(r, "id")

	var req modelAPIProviderRequest
	hasPayload := false
	if err := json.NewDecoder(r.Body).Decode(&req); err == nil {
		hasPayload = true
	} else if !errors.Is(err, io.EOF) {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	p, ok := runtimeconfig.FindProvider(id, os.Getenv)
	if !ok {
		writeError(w, http.StatusNotFound, "provider not found")
		return
	}

	// Merge optional payload overrides onto the stored provider for a temp test.
	if hasPayload {
		override := h.providerFromRequest(req)
		if override.APIKey != "" {
			p.APIKey = override.APIKey
		}
		if override.BaseURL != "" {
			p.BaseURL = override.BaseURL
		}
		if override.ModelName != "" {
			p.ModelName = override.ModelName
		}
	}
	if !h.validateProviderFields(w, &p) {
		return
	}
	if !h.validateProviderToolRoots(w, &p) {
		return
	}

	result, lastTest, discovered := h.testSavedProvider(r.Context(), p, true)
	writeJSON(w, http.StatusOK, modelAPIConnectionTestResponseFrom(result, lastTest, discovered))
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

func (h *Handler) requireModelAPIConfigAdmin(w http.ResponseWriter, r *http.Request) bool {
	member, ok := h.workspaceMember(w, r, h.resolveWorkspaceID(r))
	if !ok {
		return false
	}
	if !roleAllowed(member.Role, "owner", "admin") {
		writeError(w, http.StatusForbidden, "insufficient permissions")
		return false
	}
	return true
}

func (h *Handler) providerFromRequest(req modelAPIProviderRequest) runtimeconfig.SavedProvider {
	p := runtimeconfig.SavedProvider{
		Name:        strings.TrimSpace(req.Name),
		Preset:      strings.TrimSpace(req.Preset),
		Enabled:     req.Enabled == nil || *req.Enabled,
		APIKey:      strings.TrimSpace(req.APIKey),
		BaseURL:     strings.TrimSpace(req.BaseURL),
		ModelName:   strings.TrimSpace(req.ModelName),
		ModelNames:  strings.TrimSpace(req.ModelNames),
		RuntimeName: strings.TrimSpace(req.RuntimeName),
		ToolRoots:   strings.TrimSpace(req.ToolRoots),
	}
	if p.ModelName == "" && p.ModelNames != "" {
		p.ModelName = strings.TrimSpace(strings.Split(p.ModelNames, ",")[0])
	}
	return p
}

func (h *Handler) validateProviderFields(w http.ResponseWriter, p *runtimeconfig.SavedProvider) bool {
	if strings.TrimSpace(p.APIKey) == "" {
		writeError(w, http.StatusBadRequest, "api_key is required")
		return false
	}
	if strings.TrimSpace(p.ModelName) == "" {
		writeError(w, http.StatusBadRequest, "model_name is required")
		return false
	}
	return true
}

func (h *Handler) validateProviderToolRoots(w http.ResponseWriter, p *runtimeconfig.SavedProvider) bool {
	roots := runtimeconfig.ParseToolRoots(p.ToolRoots, os.Getenv)
	if len(roots) == 0 {
		p.ToolRoots = ""
		return true
	}
	if err := runtimeconfig.ValidateToolRoots(roots); err != nil {
		writeError(w, http.StatusBadRequest, "invalid tool_roots: "+err.Error())
		return false
	}
	p.ToolRoots = strings.Join(roots, ",")
	return true
}

func (h *Handler) testSavedProvider(ctx context.Context, p runtimeconfig.SavedProvider, discoverModels bool) (modelapi.ConnectionTestResult, *runtimeconfig.APIRuntimeConnectionTest, []string) {
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	client := modelapi.NewClient(p.APIKey, p.BaseURL, nil)
	started := time.Now()
	result := client.TestConnection(ctx, p.ModelName)
	lastTest := &runtimeconfig.APIRuntimeConnectionTest{
		TestedAt:  time.Now().UTC().Format(time.RFC3339),
		OK:        result.OK,
		Code:      result.Code,
		Message:   result.Message,
		Detail:    result.Detail,
		LatencyMS: time.Since(started).Milliseconds(),
	}
	if !result.OK {
		return result, lastTest, nil
	}
	var discoveredModels []string
	if discoverModels {
		models, err := client.ListModels(ctx)
		if err == nil || errors.Is(err, modelapi.ErrModelsEndpointUnsupported) {
			discoveredModels = models
		}
	}
	return result, lastTest, discoveredModels
}

func modelAPIConnectionTestResponseFrom(
	result modelapi.ConnectionTestResult,
	lastTest *runtimeconfig.APIRuntimeConnectionTest,
	discoveredModels []string,
) modelAPIConnectionTestResponse {
	response := modelAPIConnectionTestResponse{
		ConnectionTestResult: result,
		DiscoveredModels:     discoveredModels,
	}
	if lastTest != nil {
		response.LastTestedAt = lastTest.TestedAt
		response.LatencyMS = lastTest.LatencyMS
	}
	return response
}

// persistProvider upserts the provider into the v2 file, then re-syncs the
// API runtimes so the runtime table reflects the new configuration.
func (h *Handler) persistProvider(r *http.Request, p runtimeconfig.SavedProvider) error {
	providers, err := runtimeconfig.LoadProvidersFile(runtimeconfig.ConfigFilePath(os.Getenv))
	if err != nil {
		return err
	}
	replaced := false
	for i := range providers {
		if providers[i].ID == p.ID {
			providers[i] = p
			replaced = true
			break
		}
	}
	if !replaced {
		providers = append(providers, p)
	}
	if err := runtimeconfig.SaveProvidersFile(runtimeconfig.ConfigFilePath(os.Getenv), providers); err != nil {
		return err
	}
	return h.syncConfiguredAPIRuntimes(r, h.resolveWorkspaceID(r), requestUserID(r))
}

// providerConfig resolves a provider's runtime config, honoring the env
// provider's read-only environment source.
func (h *Handler) providerConfig(p runtimeconfig.SavedProvider) runtimeconfig.APIRuntimeConfig {
	if p.ID == runtimeconfig.EnvProviderID {
		cfg, _ := runtimeconfig.LoadAPIRuntimeConfig(os.Getenv)
		cfg.ProviderID = runtimeconfig.EnvProviderID
		cfg.ReadOnly = true
		return cfg
	}
	return p.ToConfig()
}

func modelAPIProviderResponseFrom(p runtimeconfig.SavedProvider, cfg runtimeconfig.APIRuntimeConfig) modelAPIProviderResponse {
	return modelAPIProviderResponse{
		ID:                p.ID,
		Name:              p.Name,
		Preset:            p.Preset,
		Enabled:           p.Enabled,
		ReadOnly:          cfg.ReadOnly || p.ID == runtimeconfig.EnvProviderID,
		Provider:          cfg.Provider,
		APIKeyConfigured:  cfg.APIKeyConfigured,
		BaseURL:           cfg.BaseURL,
		BaseURLConfigured: cfg.BaseURLConfigured,
		ModelName:         cfg.DefaultModel,
		ModelNames:        p.ModelNames,
		RuntimeName:       cfg.RuntimeName,
		ToolRoots:         strings.Join(cfg.ToolRoots, ","),
		ConfigSource:      cfg.ConfigSource,
		Status:            cfg.Status(),
		Ready:             cfg.Status() == "online",
		Models:            cfg.Models(),
		LastTest:          p.LastTest,
		DiscoveredModels:  p.DiscoveredModels,
	}
}

func (h *Handler) listModelAPIProvidersResponse() []modelAPIProviderResponse {
	providers, err := runtimeconfig.ListProviders(os.Getenv)
	if err != nil {
		slog.Warn("failed to load model API providers", "error", err)
		providers = nil
	}
	out := make([]modelAPIProviderResponse, 0, len(providers))
	for _, p := range providers {
		out = append(out, modelAPIProviderResponseFrom(p, h.providerConfig(p)))
	}
	return out
}
