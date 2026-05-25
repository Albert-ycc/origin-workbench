package handler

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/multica-ai/multica/server/internal/modelapi"
	"github.com/multica-ai/multica/server/internal/runtimeconfig"
)

type modelAPIConfigRequest struct {
	Provider    string `json:"provider"`
	APIKey      string `json:"api_key"`
	BaseURL     string `json:"base_url"`
	ModelName   string `json:"model_name"`
	ModelNames  string `json:"model_names"`
	RuntimeName string `json:"runtime_name"`
	ToolRoots   string `json:"tool_roots"`
}

type modelAPIConfigResponse struct {
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
	EnvOverride       bool                                    `json:"env_override"`
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

func (h *Handler) GetModelAPIConfig(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, h.modelAPIConfigResponse())
}

func (h *Handler) SaveModelAPIConfig(w http.ResponseWriter, r *http.Request) {
	if !h.requireModelAPIConfigAdmin(w, r) {
		return
	}

	var req modelAPIConfigRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	cfg, ok := h.savedModelAPIConfigFromRequest(w, req, true, false)
	if !ok {
		return
	}
	if !h.validateModelAPIConfigToolRoots(w, &cfg) {
		return
	}
	testResult, lastTest, discoveredModels := h.testSavedModelAPIConfig(r.Context(), cfg, true)
	cfg.LastTest = lastTest
	cfg.DiscoveredModels = discoveredModels
	if !testResult.OK {
		writeJSON(w, http.StatusBadRequest, map[string]any{
			"error":  testResult.Message,
			"result": modelAPIConnectionTestResponseFrom(testResult, lastTest, discoveredModels),
		})
		return
	}
	if err := runtimeconfig.SaveAPIRuntimeConfigFile(runtimeconfig.ConfigFilePath(os.Getenv), cfg); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to save model API config")
		return
	}

	if err := h.syncConfiguredAPIRuntime(r, h.resolveWorkspaceID(r), requestUserID(r)); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to refresh model API runtime")
		return
	}
	writeJSON(w, http.StatusOK, h.modelAPIConfigResponse())
}

func (h *Handler) TestModelAPIConfig(w http.ResponseWriter, r *http.Request) {
	if !h.requireModelAPIConfigAdmin(w, r) {
		return
	}

	var req modelAPIConfigRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	cfg, ok := h.savedModelAPIConfigFromRequest(w, req, true, true)
	if !ok {
		return
	}
	if !h.validateModelAPIConfigToolRoots(w, &cfg) {
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	result, lastTest, discoveredModels := h.testSavedModelAPIConfig(ctx, cfg, true)
	writeJSON(w, http.StatusOK, modelAPIConnectionTestResponseFrom(result, lastTest, discoveredModels))
}

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

func (h *Handler) validateModelAPIConfigToolRoots(w http.ResponseWriter, cfg *runtimeconfig.SavedAPIRuntimeConfig) bool {
	roots := runtimeconfig.ParseToolRoots(cfg.ToolRoots, os.Getenv)
	if len(roots) == 0 {
		cfg.ToolRoots = ""
		return true
	}
	if err := runtimeconfig.ValidateToolRoots(roots); err != nil {
		writeError(w, http.StatusBadRequest, "invalid tool_roots: "+err.Error())
		return false
	}
	cfg.ToolRoots = strings.Join(roots, ",")
	return true
}

func (h *Handler) testSavedModelAPIConfig(ctx context.Context, cfg runtimeconfig.SavedAPIRuntimeConfig, discoverModels bool) (modelapi.ConnectionTestResult, *runtimeconfig.APIRuntimeConnectionTest, []string) {
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	client := modelapi.NewClient(cfg.APIKey, cfg.BaseURL, nil)
	started := time.Now()
	result := client.TestConnection(ctx, cfg.ModelName)
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

func (h *Handler) savedModelAPIConfigFromRequest(w http.ResponseWriter, req modelAPIConfigRequest, keepExistingSecret bool, useCurrentSourceSecret bool) (runtimeconfig.SavedAPIRuntimeConfig, bool) {
	existing, _, _ := runtimeconfig.LoadSavedAPIRuntimeConfig(runtimeconfig.ConfigFilePath(os.Getenv))
	cfg := runtimeconfig.SavedAPIRuntimeConfig{
		Provider:         strings.TrimSpace(req.Provider),
		APIKey:           strings.TrimSpace(req.APIKey),
		BaseURL:          strings.TrimSpace(req.BaseURL),
		ModelName:        strings.TrimSpace(req.ModelName),
		ModelNames:       strings.TrimSpace(req.ModelNames),
		RuntimeName:      strings.TrimSpace(req.RuntimeName),
		ToolRoots:        strings.TrimSpace(req.ToolRoots),
		LastTest:         existing.LastTest,
		DiscoveredModels: existing.DiscoveredModels,
	}
	if cfg.Provider == "" {
		cfg.Provider = runtimeconfig.DefaultProvider
	}
	if cfg.APIKey == "" && keepExistingSecret {
		cfg.APIKey = existing.APIKey
	}
	if useCurrentSourceSecret && cfg.APIKey == "" {
		if current, ok := runtimeconfig.LoadAPIRuntimeConfigFromSources(os.Getenv); ok {
			cfg.APIKey = current.APIKey
			if cfg.BaseURL == "" {
				cfg.BaseURL = current.BaseURL
			}
			if cfg.ModelName == "" {
				cfg.ModelName = current.DefaultModel
			}
			if cfg.ModelNames == "" {
				cfg.ModelNames = strings.Join(current.ModelIDs, ",")
			}
			if cfg.RuntimeName == "" || cfg.RuntimeName == runtimeconfig.DefaultRuntimeName {
				cfg.RuntimeName = current.RuntimeName
			}
			if cfg.ToolRoots == "" {
				cfg.ToolRoots = strings.Join(current.ToolRoots, ",")
			}
		}
	}
	if cfg.RuntimeName == "" {
		cfg.RuntimeName = runtimeconfig.DefaultRuntimeName
	}
	if cfg.ModelNames == "" {
		cfg.ModelNames = cfg.ModelName
	}

	if cfg.APIKey == "" {
		writeError(w, http.StatusBadRequest, "api_key is required")
		return runtimeconfig.SavedAPIRuntimeConfig{}, false
	}
	if cfg.ModelName == "" {
		writeError(w, http.StatusBadRequest, "model_name is required")
		return runtimeconfig.SavedAPIRuntimeConfig{}, false
	}
	return cfg, true
}

func (h *Handler) modelAPIConfigResponse() modelAPIConfigResponse {
	saved, savedOK, _ := runtimeconfig.LoadSavedAPIRuntimeConfig(runtimeconfig.ConfigFilePath(os.Getenv))
	cfg, cfgOK := runtimeconfig.LoadAPIRuntimeConfigFromSources(os.Getenv)
	if !cfgOK {
		return modelAPIConfigResponse{
			Provider:          runtimeconfig.DefaultProvider,
			APIKeyConfigured:  savedOK && strings.TrimSpace(saved.APIKey) != "",
			BaseURL:           saved.BaseURL,
			BaseURLConfigured: savedOK && strings.TrimSpace(saved.BaseURL) != "",
			ModelName:         saved.ModelName,
			ModelNames:        saved.ModelNames,
			RuntimeName:       saved.RuntimeName,
			ToolRoots:         saved.ToolRoots,
			ConfigSource:      "none",
			Status:            "offline",
			LastTest:          saved.LastTest,
			DiscoveredModels:  saved.DiscoveredModels,
		}
	}

	source := strings.TrimSpace(cfg.ConfigSource)
	envOverride := strings.HasPrefix(source, "environment")
	return modelAPIConfigResponse{
		Provider:          cfg.Provider,
		APIKeyConfigured:  cfg.APIKeyConfigured,
		BaseURL:           cfg.BaseURL,
		BaseURLConfigured: cfg.BaseURLConfigured,
		ModelName:         cfg.DefaultModel,
		ModelNames:        strings.Join(cfg.ModelIDs, ","),
		RuntimeName:       cfg.RuntimeName,
		ToolRoots:         strings.Join(cfg.ToolRoots, ","),
		ConfigSource:      source,
		Status:            cfg.Status(),
		Ready:             cfg.Status() == "online",
		EnvOverride:       envOverride && savedOK,
		Models:            cfg.Models(),
		LastTest:          saved.LastTest,
		DiscoveredModels:  saved.DiscoveredModels,
	}
}
