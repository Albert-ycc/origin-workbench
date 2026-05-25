package runtimeconfig

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
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
	EnvConfigFile  = "ORIGIN_MODEL_CONFIG_FILE"

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

type SavedAPIRuntimeConfig struct {
	Provider         string                    `json:"provider,omitempty"`
	APIKey           string                    `json:"api_key,omitempty"`
	BaseURL          string                    `json:"base_url,omitempty"`
	ModelName        string                    `json:"model_name,omitempty"`
	ModelNames       string                    `json:"model_names,omitempty"`
	RuntimeName      string                    `json:"runtime_name,omitempty"`
	ToolRoots        string                    `json:"tool_roots,omitempty"`
	LastTest         *APIRuntimeConnectionTest `json:"last_test,omitempty"`
	DiscoveredModels []string                  `json:"discovered_models,omitempty"`
}

type APIRuntimeConnectionTest struct {
	TestedAt  string `json:"last_tested_at,omitempty"`
	OK        bool   `json:"ok"`
	Code      string `json:"code,omitempty"`
	Message   string `json:"message"`
	Detail    string `json:"detail,omitempty"`
	LatencyMS int64  `json:"latency_ms,omitempty"`
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

func LoadAPIRuntimeConfigFromSources(getenv func(string) string) (APIRuntimeConfig, bool) {
	if cfg, ok := LoadAPIRuntimeConfig(getenv); ok {
		return cfg, true
	}
	cfg, ok, err := LoadAPIRuntimeConfigFromFile(ConfigFilePath(getenv))
	if err != nil || !ok {
		return APIRuntimeConfig{}, false
	}
	return cfg, true
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

func ConfigFilePath(getenv func(string) string) string {
	if path := strings.TrimSpace(getenv(EnvConfigFile)); path != "" {
		return path
	}
	home, err := os.UserHomeDir()
	if err != nil || strings.TrimSpace(home) == "" {
		return ""
	}
	return filepath.Join(home, ".multica", "model_api_config.json")
}

func LoadSavedAPIRuntimeConfig(path string) (SavedAPIRuntimeConfig, bool, error) {
	if strings.TrimSpace(path) == "" {
		return SavedAPIRuntimeConfig{}, false, nil
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return SavedAPIRuntimeConfig{}, false, nil
		}
		return SavedAPIRuntimeConfig{}, false, err
	}
	var saved SavedAPIRuntimeConfig
	if err := json.Unmarshal(raw, &saved); err != nil {
		return SavedAPIRuntimeConfig{}, false, err
	}
	if !saved.HasConfiguredValue() {
		return SavedAPIRuntimeConfig{}, false, nil
	}
	return saved, true, nil
}

func (c SavedAPIRuntimeConfig) HasConfiguredValue() bool {
	return strings.TrimSpace(c.Provider) != "" ||
		strings.TrimSpace(c.APIKey) != "" ||
		strings.TrimSpace(c.BaseURL) != "" ||
		strings.TrimSpace(c.ModelName) != "" ||
		strings.TrimSpace(c.ModelNames) != "" ||
		strings.TrimSpace(c.RuntimeName) != "" ||
		strings.TrimSpace(c.ToolRoots) != "" ||
		c.LastTest != nil ||
		len(c.DiscoveredModels) > 0
}

func LoadAPIRuntimeConfigFromFile(path string) (APIRuntimeConfig, bool, error) {
	saved, ok, err := LoadSavedAPIRuntimeConfig(path)
	if err != nil || !ok {
		return APIRuntimeConfig{}, false, err
	}
	modelNames := saved.ModelNames
	if len(saved.DiscoveredModels) > 0 {
		modelNames = strings.Join(normalizeModelIDs(append(splitComma(modelNames), saved.DiscoveredModels...)), ",")
	}
	env := map[string]string{
		EnvProvider:    saved.Provider,
		EnvAPIKey:      saved.APIKey,
		EnvBaseURL:     saved.BaseURL,
		EnvModelName:   saved.ModelName,
		EnvModelNames:  modelNames,
		EnvRuntimeName: saved.RuntimeName,
		EnvToolRoots:   saved.ToolRoots,
	}
	cfg, configured := LoadAPIRuntimeConfig(func(key string) string { return env[key] })
	if !configured {
		return APIRuntimeConfig{}, false, nil
	}
	cfg.ConfigSource = "file"
	return cfg, true, nil
}

func SaveAPIRuntimeConfigFile(path string, cfg SavedAPIRuntimeConfig) error {
	if strings.TrimSpace(path) == "" {
		return os.ErrInvalid
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	cfg = sanitizeSavedAPIRuntimeConfig(cfg)
	raw, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, raw, 0o600)
}

func sanitizeSavedAPIRuntimeConfig(cfg SavedAPIRuntimeConfig) SavedAPIRuntimeConfig {
	if cfg.LastTest != nil {
		lastTest := *cfg.LastTest
		lastTest.Detail = redactSecret(lastTest.Detail, cfg.APIKey)
		cfg.LastTest = &lastTest
	}
	cfg.DiscoveredModels = normalizeModelIDs(cfg.DiscoveredModels)
	return cfg
}

func normalizeModelIDs(ids []string) []string {
	seen := map[string]struct{}{}
	out := make([]string, 0, len(ids))
	for _, raw := range ids {
		id := strings.TrimSpace(raw)
		if id == "" {
			continue
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		out = append(out, id)
	}
	return out
}

func splitComma(value string) []string {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	return strings.Split(value, ",")
}

func redactSecret(value string, secrets ...string) string {
	out := value
	for _, secret := range secrets {
		secret = strings.TrimSpace(secret)
		if secret == "" {
			continue
		}
		out = strings.ReplaceAll(out, secret, "[redacted]")
	}
	return out
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
	return ParseToolRoots(getenv(EnvToolRoots), getenv)
}

func ParseToolRoots(raw string, getenv func(string) string) []string {
	seen := map[string]struct{}{}
	var out []string
	for _, part := range strings.Split(raw, ",") {
		root := expandToolRoot(strings.TrimSpace(part), getenv)
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

func ValidateToolRoots(roots []string) error {
	for _, root := range roots {
		info, err := os.Stat(root)
		if err != nil {
			return fmt.Errorf("%s: %w", root, err)
		}
		if !info.IsDir() {
			return fmt.Errorf("%s is not a directory", root)
		}
	}
	return nil
}

func expandToolRoot(root string, getenv func(string) string) string {
	if root == "" {
		return ""
	}
	home := strings.TrimSpace(getenv("HOME"))
	if home == "" {
		if detected, err := os.UserHomeDir(); err == nil {
			home = detected
		}
	}
	if home != "" {
		switch {
		case root == "~":
			root = home
		case strings.HasPrefix(root, "~/"):
			root = filepath.Join(home, strings.TrimPrefix(root, "~/"))
		default:
			root = strings.ReplaceAll(root, "${HOME}", home)
			root = strings.ReplaceAll(root, "$HOME", home)
		}
	}
	return filepath.Clean(root)
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
