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

	EnvProviderID        = "env"
	LegacyProviderID     = "legacy"
	PresetDeepseek       = "deepseek"
	PresetCustom         = "custom"
	ProvidersFileVersion = 2
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
	ProviderID        string
	ReadOnly          bool
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

// SavedProvider is a single model API provider entry in the v2 config file.
// It is the persisted, provider-granular form that replaced the legacy
// single SavedAPIRuntimeConfig document.
type SavedProvider struct {
	ID               string                    `json:"id,omitempty"`
	Name             string                    `json:"name,omitempty"`
	Preset           string                    `json:"preset,omitempty"`
	Enabled          bool                      `json:"enabled"`
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

// SavedProvidersFile is the v2 on-disk document shape.
type SavedProvidersFile struct {
	Version   int             `json:"version"`
	Providers []SavedProvider `json:"providers"`
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
	ProviderID        string            `json:"provider_id,omitempty"`
	ReadOnly          bool              `json:"readonly,omitempty"`
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
	providers, err := LoadProvidersFile(path)
	if err != nil || len(providers) == 0 {
		return APIRuntimeConfig{}, false, err
	}
	for _, p := range providers {
		if !p.Enabled || !p.HasConfiguredValue() {
			continue
		}
		return p.ToConfig(), true, nil
	}
	return APIRuntimeConfig{}, false, nil
}

// LoadProvidersFile reads the v2 providers document. When the file is in the
// legacy single-config format (no top-level "providers" key), it is migrated
// in memory to a single legacy provider entry.
func LoadProvidersFile(path string) ([]SavedProvider, error) {
	if strings.TrimSpace(path) == "" {
		return nil, nil
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}

	var probe map[string]json.RawMessage
	if json.Unmarshal(raw, &probe) == nil {
		if _, ok := probe["providers"]; ok {
			var file SavedProvidersFile
			if err := json.Unmarshal(raw, &file); err != nil {
				return nil, err
			}
			return file.Providers, nil
		}
	}

	// Legacy single-config format: wrap as one "legacy" provider.
	saved, ok, err := LoadSavedAPIRuntimeConfig(path)
	if err != nil || !ok {
		return nil, err
	}
	name := strings.TrimSpace(saved.RuntimeName)
	if name == "" {
		name = DefaultRuntimeName
	}
	return []SavedProvider{{
		ID:               LegacyProviderID,
		Name:             name,
		Preset:           PresetCustom,
		Enabled:          true,
		Provider:         saved.Provider,
		APIKey:           saved.APIKey,
		BaseURL:          saved.BaseURL,
		ModelName:        saved.ModelName,
		ModelNames:       saved.ModelNames,
		RuntimeName:      saved.RuntimeName,
		ToolRoots:        saved.ToolRoots,
		LastTest:         saved.LastTest,
		DiscoveredModels: saved.DiscoveredModels,
	}}, nil
}

func SaveProvidersFile(path string, providers []SavedProvider) error {
	if strings.TrimSpace(path) == "" {
		return os.ErrInvalid
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	sanitized := make([]SavedProvider, 0, len(providers))
	for _, p := range providers {
		sanitized = append(sanitized, sanitizeSavedProvider(p))
	}
	raw, err := json.MarshalIndent(SavedProvidersFile{Version: ProvidersFileVersion, Providers: sanitized}, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, raw, 0o600)
}

func sanitizeSavedProvider(p SavedProvider) SavedProvider {
	if p.LastTest != nil {
		lastTest := *p.LastTest
		lastTest.Detail = redactSecret(lastTest.Detail, p.APIKey)
		p.LastTest = &lastTest
	}
	p.DiscoveredModels = normalizeModelIDs(p.DiscoveredModels)
	return p
}

// HasConfiguredValue reports whether the provider carries any configuration,
// mirroring the legacy SavedAPIRuntimeConfig detection used for migration.
func (p SavedProvider) HasConfiguredValue() bool {
	return strings.TrimSpace(p.Provider) != "" ||
		strings.TrimSpace(p.APIKey) != "" ||
		strings.TrimSpace(p.BaseURL) != "" ||
		strings.TrimSpace(p.ModelName) != "" ||
		strings.TrimSpace(p.ModelNames) != "" ||
		strings.TrimSpace(p.RuntimeName) != "" ||
		strings.TrimSpace(p.ToolRoots) != "" ||
		p.LastTest != nil ||
		len(p.DiscoveredModels) > 0
}

// ToConfig resolves a saved provider into a runtime config, merging configured
// model names with any discovered models (deduplicated).
func (p SavedProvider) ToConfig() APIRuntimeConfig {
	modelNames := p.ModelNames
	if len(p.DiscoveredModels) > 0 {
		modelNames = strings.Join(normalizeModelIDs(append(splitComma(modelNames), p.DiscoveredModels...)), ",")
	}
	env := map[string]string{
		EnvProvider:    p.Provider,
		EnvAPIKey:      p.APIKey,
		EnvBaseURL:     p.BaseURL,
		EnvModelName:   p.ModelName,
		EnvModelNames:  modelNames,
		EnvRuntimeName: p.RuntimeName,
		EnvToolRoots:   p.ToolRoots,
	}
	cfg, _ := LoadAPIRuntimeConfig(func(key string) string { return env[key] })
	cfg.ConfigSource = "file"
	cfg.ProviderID = p.ID
	return cfg
}

// DaemonID derives the runtime daemon_id for a provider. The legacy provider
// keeps the pre-migration value (origin-api:{ownerID}) so already-bound agents
// keep referencing the same runtime row; named providers get a provider-scoped
// suffix and the env provider a fixed "env" suffix.
func (p SavedProvider) DaemonID(ownerID string) string {
	ownerID = strings.TrimSpace(ownerID)
	if ownerID == "" {
		return DaemonIDPrefix
	}
	switch p.ID {
	case EnvProviderID:
		return DaemonIDPrefix + ":" + ownerID + ":env"
	case LegacyProviderID:
		return DaemonIDPrefix + ":" + ownerID
	default:
		return DaemonIDPrefix + ":" + ownerID + ":" + p.ID
	}
}

// ApplyProviderPreset fills preset defaults in place and returns the provider.
func ApplyProviderPreset(p SavedProvider) SavedProvider {
	switch p.Preset {
	case PresetDeepseek:
		p.Provider = "deepseek"
		if strings.TrimSpace(p.BaseURL) == "" {
			p.BaseURL = "https://api.deepseek.com/v1"
		}
		if strings.TrimSpace(p.RuntimeName) == "" {
			p.RuntimeName = "DeepSeek API"
		}
		if strings.TrimSpace(p.ModelName) == "" {
			p.ModelName = "deepseek-chat"
		}
	case PresetCustom:
		p.Provider = "custom"
		if strings.TrimSpace(p.RuntimeName) == "" {
			p.RuntimeName = "外接模型 API"
		}
	}
	return p
}

// ListProviders returns the persisted providers plus a read-only env provider
// entry when environment configuration is present.
func ListProviders(getenv func(string) string) []SavedProvider {
	providers, _ := LoadProvidersFile(ConfigFilePath(getenv))
	if cfg, ok := LoadAPIRuntimeConfig(getenv); ok {
		providers = append(providers, SavedProvider{
			ID:          EnvProviderID,
			Name:        "环境变量",
			Preset:      PresetCustom,
			Enabled:     true,
			Provider:    cfg.Provider,
			BaseURL:     cfg.BaseURL,
			ModelName:   cfg.DefaultModel,
			ModelNames:  strings.Join(cfg.ModelIDs, ","),
			RuntimeName: cfg.RuntimeName,
			ToolRoots:   strings.Join(cfg.ToolRoots, ","),
		})
	}
	return providers
}

func FindProvider(id string, getenv func(string) string) (SavedProvider, bool) {
	for _, p := range ListProviders(getenv) {
		if p.ID == id {
			return p, true
		}
	}
	return SavedProvider{}, false
}

// LoadProviderConfigByID resolves a single provider to a runtime config.
// id == EnvProviderID reads directly from the environment.
func LoadProviderConfigByID(id string, getenv func(string) string) (APIRuntimeConfig, bool, error) {
	if id == EnvProviderID {
		cfg, ok := LoadAPIRuntimeConfig(getenv)
		if !ok {
			return APIRuntimeConfig{}, false, nil
		}
		cfg.ProviderID = EnvProviderID
		cfg.ReadOnly = true
		return cfg, true, nil
	}
	p, ok := FindProvider(id, getenv)
	if !ok || !p.Enabled {
		return APIRuntimeConfig{}, false, nil
	}
	return p.ToConfig(), true, nil
}

func ProviderIDFromMetadata(raw []byte) string {
	var md APIRuntimeMetadata
	if err := json.Unmarshal(raw, &md); err != nil {
		return ""
	}
	return md.ProviderID
}

// ProviderConfigForRuntime resolves the config for a runtime's metadata. When
// the metadata carries a provider_id it loads that provider; otherwise it falls
// back to the legacy env-first-file behavior for pre-migration runtimes.
func ProviderConfigForRuntime(rawMetadata []byte, getenv func(string) string) (APIRuntimeConfig, bool) {
	if id := ProviderIDFromMetadata(rawMetadata); id != "" {
		cfg, ok, err := LoadProviderConfigByID(id, getenv)
		if err != nil || !ok {
			return APIRuntimeConfig{}, false
		}
		return cfg, true
	}
	return LoadAPIRuntimeConfigFromSources(getenv)
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
		ProviderID:        c.ProviderID,
		ReadOnly:          c.ReadOnly,
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
