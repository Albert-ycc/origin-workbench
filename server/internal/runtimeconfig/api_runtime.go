package runtimeconfig

import (
	"encoding/json"
	"os"
	"strings"
)

const (
	EnvProvider    = "ORIGIN_MODEL_PROVIDER"
	EnvAPIKey      = "ORIGIN_MODEL_API_KEY"
	EnvBaseURL     = "ORIGIN_MODEL_BASE_URL"
	EnvModelName   = "ORIGIN_MODEL_NAME"
	EnvModelNames  = "ORIGIN_MODEL_NAMES"
	EnvRuntimeName = "ORIGIN_MODEL_RUNTIME_NAME"

	DefaultProvider    = "openai_compatible"
	DefaultRuntimeName = "External Model API"
	ManagedByOriginAPI = "origin_api"
	RuntimeModeCloud   = "cloud"
	DaemonIDPrefix     = "origin-api"
)

type APIRuntimeConfig struct {
	Provider          string
	RuntimeName       string
	APIKey            string
	BaseURL           string
	ModelIDs          []string
	DefaultModel      string
	APIKeyConfigured  bool
	BaseURLConfigured bool
}

type APIRuntimeMetadata struct {
	APIRuntime        bool              `json:"api_runtime"`
	ManagedBy         string            `json:"managed_by"`
	ConfigSource      string            `json:"config_source"`
	APIKeyConfigured  bool              `json:"api_key_configured"`
	BaseURLConfigured bool              `json:"base_url_configured"`
	SupportsTools     bool              `json:"supports_tools"`
	TaskExecution     string            `json:"task_execution"`
	DefaultModel      string            `json:"default_model,omitempty"`
	Models            []APIRuntimeModel `json:"models,omitempty"`
	RequiredEnv       []string          `json:"required_env,omitempty"`
	OptionalEnv       []string          `json:"optional_env,omitempty"`
}

type APIRuntimeModel struct {
	ID       string `json:"id"`
	Label    string `json:"label"`
	Provider string `json:"provider,omitempty"`
	Default  bool   `json:"default,omitempty"`
}

func LoadAPIRuntimeConfigFromEnv() (APIRuntimeConfig, bool) {
	return LoadAPIRuntimeConfig(os.Getenv)
}

func LoadAPIRuntimeConfig(getenv func(string) string) (APIRuntimeConfig, bool) {
	rawProvider := strings.TrimSpace(getenv(EnvProvider))
	provider := rawProvider
	if provider == "" {
		provider = DefaultProvider
	}

	apiKey := strings.TrimSpace(getenv(EnvAPIKey))
	baseURL := strings.TrimSpace(getenv(EnvBaseURL))
	apiKeyConfigured := apiKey != ""
	baseURLConfigured := baseURL != ""
	modelIDs := configuredModelIDs(getenv)
	runtimeName := strings.TrimSpace(getenv(EnvRuntimeName))
	if runtimeName == "" {
		runtimeName = DefaultRuntimeName
	}

	configured := rawProvider != "" ||
		apiKeyConfigured ||
		baseURLConfigured ||
		len(modelIDs) > 0 ||
		strings.TrimSpace(getenv(EnvRuntimeName)) != ""
	if !configured {
		return APIRuntimeConfig{}, false
	}

	defaultModel := strings.TrimSpace(getenv(EnvModelName))
	if defaultModel == "" && len(modelIDs) > 0 {
		defaultModel = modelIDs[0]
	}

	return APIRuntimeConfig{
		Provider:          provider,
		RuntimeName:       runtimeName,
		APIKey:            apiKey,
		BaseURL:           baseURL,
		ModelIDs:          modelIDs,
		DefaultModel:      defaultModel,
		APIKeyConfigured:  apiKeyConfigured,
		BaseURLConfigured: baseURLConfigured,
	}, true
}

func (c APIRuntimeConfig) Status() string {
	if c.APIKeyConfigured && len(c.ModelIDs) > 0 {
		return "online"
	}
	return "offline"
}

func (c APIRuntimeConfig) DeviceInfo() string {
	if c.Provider == "" || c.Provider == DefaultProvider {
		return "OpenAI-compatible API"
	}
	return c.Provider + " API"
}

func (c APIRuntimeConfig) DaemonID(ownerID string) string {
	ownerID = strings.TrimSpace(ownerID)
	if ownerID == "" {
		return DaemonIDPrefix
	}
	return DaemonIDPrefix + ":" + ownerID
}

func (c APIRuntimeConfig) Models() []APIRuntimeModel {
	models := make([]APIRuntimeModel, 0, len(c.ModelIDs))
	for _, id := range c.ModelIDs {
		models = append(models, APIRuntimeModel{
			ID:       id,
			Label:    id,
			Provider: c.Provider,
			Default:  id == c.DefaultModel,
		})
	}
	return models
}

func MetadataFromConfig(c APIRuntimeConfig) ([]byte, error) {
	md := APIRuntimeMetadata{
		APIRuntime:        true,
		ManagedBy:         ManagedByOriginAPI,
		ConfigSource:      "environment",
		APIKeyConfigured:  c.APIKeyConfigured,
		BaseURLConfigured: c.BaseURLConfigured,
		SupportsTools:     false,
		TaskExecution:     "chat_only",
		DefaultModel:      c.DefaultModel,
		Models:            c.Models(),
		RequiredEnv:       []string{EnvAPIKey, EnvModelName},
		OptionalEnv:       []string{EnvProvider, EnvBaseURL, EnvModelNames, EnvRuntimeName},
	}
	return json.Marshal(md)
}

func IsAPIRuntimeMetadata(raw []byte) bool {
	var md APIRuntimeMetadata
	if err := json.Unmarshal(raw, &md); err != nil {
		return false
	}
	return md.APIRuntime && md.ManagedBy == ManagedByOriginAPI
}

func ModelsFromMetadata(raw []byte) []APIRuntimeModel {
	var md APIRuntimeMetadata
	if err := json.Unmarshal(raw, &md); err != nil {
		return nil
	}
	return md.Models
}

func configuredModelIDs(getenv func(string) string) []string {
	seen := map[string]struct{}{}
	var out []string
	add := func(value string) {
		id := strings.TrimSpace(value)
		if id == "" {
			return
		}
		if _, ok := seen[id]; ok {
			return
		}
		seen[id] = struct{}{}
		out = append(out, id)
	}

	add(getenv(EnvModelName))
	for _, part := range strings.Split(getenv(EnvModelNames), ",") {
		add(part)
	}
	return out
}
