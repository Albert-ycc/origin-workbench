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
	EnvToolRoots   = "ORIGIN_MODEL_TOOL_ROOTS"

	EnvOpenAIAPIKey     = "OPENAI_API_KEY"
	EnvOpenAIBaseURL    = "OPENAI_BASE_URL"
	EnvOpenAIAPIBase    = "OPENAI_API_BASE"
	EnvOpenAIAPIBaseURL = "OPENAI_API_BASE_URL"
	EnvOpenAIModel      = "OPENAI_MODEL"
	EnvOpenAIModelName  = "OPENAI_MODEL_NAME"
	EnvOpenAIModels     = "OPENAI_MODELS"

	DefaultProvider    = "openai_compatible"
	DefaultRuntimeName = "External Model API"
	ManagedByOriginAPI = "origin_api"
	RuntimeModeCloud   = "cloud"
	DaemonIDPrefix     = "origin-api"
)

type APIRuntimeConfig struct {
	Provider          string
	RuntimeName       string
	ConfigSource      string
	APIKey            string
	BaseURL           string
	ModelIDs          []string
	DefaultModel      string
	ToolRoots         []string
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

	apiKey := firstConfiguredEnv(getenv, EnvAPIKey, EnvOpenAIAPIKey)
	baseURL := firstConfiguredEnv(getenv, EnvBaseURL, EnvOpenAIBaseURL, EnvOpenAIAPIBaseURL, EnvOpenAIAPIBase)
	apiKeyConfigured := apiKey != ""
	baseURLConfigured := baseURL != ""
	modelIDs := configuredModelIDs(getenv)
	toolRoots := ConfiguredToolRoots(getenv)
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

	defaultModel := firstConfiguredEnv(getenv, EnvModelName, EnvOpenAIModel, EnvOpenAIModelName)
	if defaultModel == "" && len(modelIDs) > 0 {
		defaultModel = modelIDs[0]
	}

	return APIRuntimeConfig{
		Provider:          provider,
		RuntimeName:       runtimeName,
		ConfigSource:      apiRuntimeConfigSource(getenv),
		APIKey:            apiKey,
		BaseURL:           baseURL,
		ModelIDs:          modelIDs,
		DefaultModel:      defaultModel,
		ToolRoots:         toolRoots,
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
	configSource := strings.TrimSpace(c.ConfigSource)
	if configSource == "" {
		configSource = "environment"
	}
	md := APIRuntimeMetadata{
		APIRuntime:        true,
		ManagedBy:         ManagedByOriginAPI,
		ConfigSource:      configSource,
		APIKeyConfigured:  c.APIKeyConfigured,
		BaseURLConfigured: c.BaseURLConfigured,
		SupportsTools:     true,
		TaskExecution:     "tool_loop",
		DefaultModel:      c.DefaultModel,
		Models:            c.Models(),
		RequiredEnv:       []string{EnvAPIKey, EnvModelName},
		OptionalEnv: []string{
			EnvProvider,
			EnvBaseURL,
			EnvModelNames,
			EnvRuntimeName,
			EnvToolRoots,
			EnvOpenAIAPIKey,
			EnvOpenAIBaseURL,
			EnvOpenAIAPIBase,
			EnvOpenAIAPIBaseURL,
			EnvOpenAIModel,
			EnvOpenAIModelName,
			EnvOpenAIModels,
		},
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
	add(getenv(EnvOpenAIModel))
	add(getenv(EnvOpenAIModelName))
	for _, part := range strings.Split(getenv(EnvOpenAIModels), ",") {
		add(part)
	}
	return out
}

func ConfiguredToolRoots(getenv func(string) string) []string {
	seen := map[string]struct{}{}
	var out []string
	for _, part := range strings.Split(getenv(EnvToolRoots), ",") {
		root := strings.TrimSpace(part)
		if root == "" {
			continue
		}
		if _, ok := seen[root]; ok {
			continue
		}
		seen[root] = struct{}{}
		out = append(out, root)
	}
	return out
}

func firstConfiguredEnv(getenv func(string) string, names ...string) string {
	for _, name := range names {
		if value := strings.TrimSpace(getenv(name)); value != "" {
			return value
		}
	}
	return ""
}

func apiRuntimeConfigSource(getenv func(string) string) string {
	originNames := []string{
		EnvProvider,
		EnvAPIKey,
		EnvBaseURL,
		EnvModelName,
		EnvModelNames,
		EnvRuntimeName,
	}
	if hasConfiguredEnv(getenv, originNames...) {
		return "environment:origin"
	}
	openAICompatibleNames := []string{
		EnvOpenAIAPIKey,
		EnvOpenAIBaseURL,
		EnvOpenAIAPIBase,
		EnvOpenAIAPIBaseURL,
		EnvOpenAIModel,
		EnvOpenAIModelName,
		EnvOpenAIModels,
	}
	if hasConfiguredEnv(getenv, openAICompatibleNames...) {
		return "environment:openai_compatible"
	}
	return "environment"
}

func hasConfiguredEnv(getenv func(string) string, names ...string) bool {
	for _, name := range names {
		if strings.TrimSpace(getenv(name)) != "" {
			return true
		}
	}
	return false
}
