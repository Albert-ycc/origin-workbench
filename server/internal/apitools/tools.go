package apitools

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"unicode/utf8"

	"github.com/multica-ai/multica/server/internal/modelapi"
	"github.com/multica-ai/multica/server/internal/runtimeconfig"
)

const (
	defaultMaxFileBytes       = 64 * 1024
	defaultMaxSearchFileBytes = 512 * 1024
	defaultMaxSearchMatches   = 50
)

var errSearchLimit = errors.New("search match limit reached")

type Config struct {
	Roots              []string
	MaxFileBytes       int64
	MaxSearchFileBytes int64
	MaxSearchMatches   int
}

type LocalExecutor struct {
	roots              []string
	maxFileBytes       int64
	maxSearchFileBytes int64
	maxSearchMatches   int
}

type directoryEntry struct {
	Name string `json:"name"`
	Type string `json:"type"`
	Size int64  `json:"size,omitempty"`
}

type searchMatch struct {
	Path string `json:"path"`
	Line int    `json:"line"`
	Text string `json:"text"`
}

func ConfigFromEnv() Config {
	return Config{Roots: runtimeconfig.ConfiguredToolRoots(os.Getenv)}
}

func NewLocalExecutor(cfg Config) (*LocalExecutor, error) {
	roots := cfg.Roots
	if len(roots) == 0 {
		defaultRoot, err := defaultToolRoot()
		if err != nil {
			return nil, err
		}
		roots = []string{defaultRoot}
	}

	resolved := make([]string, 0, len(roots))
	seen := map[string]struct{}{}
	for _, root := range roots {
		clean, err := resolveExistingPath(root)
		if err != nil {
			return nil, fmt.Errorf("resolve tool root %q: %w", root, err)
		}
		info, err := os.Stat(clean)
		if err != nil {
			return nil, fmt.Errorf("stat tool root %q: %w", root, err)
		}
		if !info.IsDir() {
			return nil, fmt.Errorf("tool root %q is not a directory", root)
		}
		if _, ok := seen[clean]; ok {
			continue
		}
		seen[clean] = struct{}{}
		resolved = append(resolved, clean)
	}

	maxFileBytes := cfg.MaxFileBytes
	if maxFileBytes <= 0 {
		maxFileBytes = defaultMaxFileBytes
	}
	maxSearchFileBytes := cfg.MaxSearchFileBytes
	if maxSearchFileBytes <= 0 {
		maxSearchFileBytes = defaultMaxSearchFileBytes
	}
	maxSearchMatches := cfg.MaxSearchMatches
	if maxSearchMatches <= 0 {
		maxSearchMatches = defaultMaxSearchMatches
	}

	return &LocalExecutor{
		roots:              resolved,
		maxFileBytes:       maxFileBytes,
		maxSearchFileBytes: maxSearchFileBytes,
		maxSearchMatches:   maxSearchMatches,
	}, nil
}

func (e *LocalExecutor) Tools() []modelapi.Tool {
	if e == nil {
		return nil
	}
	return []modelapi.Tool{
		{
			Type: "function",
			Function: modelapi.ToolFunction{
				Name:        "list_directory",
				Description: "List files and directories inside the configured local tool roots.",
				Parameters: objectSchema(map[string]any{
					"path": map[string]any{
						"type":        "string",
						"description": "Directory path relative to a configured tool root, or an absolute path inside a root.",
					},
				}, nil),
			},
		},
		{
			Type: "function",
			Function: modelapi.ToolFunction{
				Name:        "read_text_file",
				Description: "Read a UTF-8 text file inside the configured local tool roots.",
				Parameters: objectSchema(map[string]any{
					"path": map[string]any{
						"type":        "string",
						"description": "File path relative to a configured tool root, or an absolute path inside a root.",
					},
				}, []string{"path"}),
			},
		},
		{
			Type: "function",
			Function: modelapi.ToolFunction{
				Name:        "search_text",
				Description: "Search UTF-8 text files inside the configured local tool roots.",
				Parameters: objectSchema(map[string]any{
					"query": map[string]any{
						"type":        "string",
						"description": "Case-insensitive text to search for.",
					},
					"path": map[string]any{
						"type":        "string",
						"description": "Optional directory path to search under.",
					},
					"max_matches": map[string]any{
						"type":        "integer",
						"description": "Optional maximum number of matches.",
					},
				}, []string{"query"}),
			},
		},
	}
}

func (e *LocalExecutor) Execute(ctx context.Context, call modelapi.ToolCall) (string, error) {
	if e == nil {
		return "", fmt.Errorf("API runtime tool executor is not configured")
	}
	switch call.Function.Name {
	case "list_directory":
		return e.listDirectory(call.Function.Arguments)
	case "read_text_file":
		return e.readTextFile(call.Function.Arguments)
	case "search_text":
		return e.searchText(ctx, call.Function.Arguments)
	default:
		return "", fmt.Errorf("unknown API runtime tool %q", call.Function.Name)
	}
}

func (e *LocalExecutor) listDirectory(rawArgs string) (string, error) {
	var args struct {
		Path string `json:"path"`
	}
	if err := json.Unmarshal([]byte(defaultJSON(rawArgs)), &args); err != nil {
		return "", fmt.Errorf("decode list_directory arguments: %w", err)
	}
	target, root, err := e.resolvePath(args.Path)
	if err != nil {
		return "", err
	}
	info, err := os.Stat(target)
	if err != nil {
		return "", fmt.Errorf("stat directory: %w", err)
	}
	if !info.IsDir() {
		return "", fmt.Errorf("%s is not a directory", e.displayPath(root, target))
	}
	entries, err := os.ReadDir(target)
	if err != nil {
		return "", fmt.Errorf("list directory: %w", err)
	}
	out := make([]directoryEntry, 0, len(entries))
	for _, entry := range entries {
		info, err := entry.Info()
		if err != nil {
			continue
		}
		entryType := "file"
		if info.IsDir() {
			entryType = "directory"
		}
		out = append(out, directoryEntry{Name: entry.Name(), Type: entryType, Size: info.Size()})
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Type != out[j].Type {
			return out[i].Type == "directory"
		}
		return out[i].Name < out[j].Name
	})
	return jsonString(map[string]any{
		"path":    e.displayPath(root, target),
		"entries": out,
	})
}

func (e *LocalExecutor) readTextFile(rawArgs string) (string, error) {
	var args struct {
		Path string `json:"path"`
	}
	if err := json.Unmarshal([]byte(defaultJSON(rawArgs)), &args); err != nil {
		return "", fmt.Errorf("decode read_text_file arguments: %w", err)
	}
	target, root, err := e.resolvePath(args.Path)
	if err != nil {
		return "", err
	}
	if isSensitivePath(target) {
		return "", fmt.Errorf("refusing to read sensitive file %s", e.displayPath(root, target))
	}
	info, err := os.Stat(target)
	if err != nil {
		return "", fmt.Errorf("stat file: %w", err)
	}
	if info.IsDir() {
		return "", fmt.Errorf("%s is a directory", e.displayPath(root, target))
	}
	content, truncated, err := readLimitedText(target, e.maxFileBytes)
	if err != nil {
		return "", err
	}
	return jsonString(map[string]any{
		"path":      e.displayPath(root, target),
		"content":   content,
		"truncated": truncated,
	})
}

func (e *LocalExecutor) searchText(ctx context.Context, rawArgs string) (string, error) {
	var args struct {
		Query      string `json:"query"`
		Path       string `json:"path"`
		MaxMatches int    `json:"max_matches"`
	}
	if err := json.Unmarshal([]byte(defaultJSON(rawArgs)), &args); err != nil {
		return "", fmt.Errorf("decode search_text arguments: %w", err)
	}
	query := strings.TrimSpace(args.Query)
	if query == "" {
		return "", fmt.Errorf("search query is required")
	}
	target, root, err := e.resolvePath(args.Path)
	if err != nil {
		return "", err
	}
	info, err := os.Stat(target)
	if err != nil {
		return "", fmt.Errorf("stat search path: %w", err)
	}
	if !info.IsDir() {
		return "", fmt.Errorf("%s is not a directory", e.displayPath(root, target))
	}
	limit := args.MaxMatches
	if limit <= 0 || limit > e.maxSearchMatches {
		limit = e.maxSearchMatches
	}

	var matches []searchMatch
	lowerQuery := strings.ToLower(query)
	err = filepath.WalkDir(target, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return nil
		}
		if err := ctx.Err(); err != nil {
			return err
		}
		if path != target && entry.IsDir() && shouldSkipSearchDir(entry.Name()) {
			return filepath.SkipDir
		}
		if entry.IsDir() || isSensitivePath(path) {
			return nil
		}
		info, err := entry.Info()
		if err != nil || info.Size() > e.maxSearchFileBytes {
			return nil
		}
		content, _, err := readLimitedText(path, e.maxSearchFileBytes)
		if err != nil {
			return nil
		}
		lines := strings.Split(content, "\n")
		for i, line := range lines {
			if strings.Contains(strings.ToLower(line), lowerQuery) {
				matches = append(matches, searchMatch{
					Path: e.displayPath(root, path),
					Line: i + 1,
					Text: strings.TrimSpace(line),
				})
				if len(matches) >= limit {
					return errSearchLimit
				}
			}
		}
		return nil
	})
	truncated := errors.Is(err, errSearchLimit)
	if err != nil && !truncated {
		return "", fmt.Errorf("search files: %w", err)
	}
	return jsonString(map[string]any{
		"path":      e.displayPath(root, target),
		"query":     query,
		"matches":   matches,
		"truncated": truncated,
	})
}

func (e *LocalExecutor) resolvePath(rawPath string) (target, root string, err error) {
	candidate := strings.TrimSpace(rawPath)
	if candidate == "" {
		candidate = "."
	}
	if filepath.IsAbs(candidate) {
		target, err = resolveExistingPath(candidate)
	} else {
		target, err = resolveExistingPath(filepath.Join(e.roots[0], candidate))
	}
	if err != nil {
		return "", "", fmt.Errorf("resolve path: %w", err)
	}
	for _, root := range e.roots {
		if pathInsideRoot(target, root) {
			return target, root, nil
		}
	}
	return "", "", fmt.Errorf("path %q is outside configured API tool roots", rawPath)
}

func (e *LocalExecutor) displayPath(root, path string) string {
	rel, err := filepath.Rel(root, path)
	if err != nil || rel == "." {
		return "."
	}
	return filepath.ToSlash(rel)
}

func resolveExistingPath(path string) (string, error) {
	abs, err := filepath.Abs(path)
	if err != nil {
		return "", err
	}
	return filepath.EvalSymlinks(abs)
}

func defaultToolRoot() (string, error) {
	wd, err := os.Getwd()
	if err != nil {
		return "", fmt.Errorf("resolve working directory: %w", err)
	}
	root, err := discoverWorkspaceRoot(wd)
	if err != nil {
		return "", err
	}
	return root, nil
}

func discoverWorkspaceRoot(start string) (string, error) {
	current, err := resolveExistingPath(start)
	if err != nil {
		return "", fmt.Errorf("resolve working directory: %w", err)
	}

	var goModRoot string
	for {
		if pathExists(filepath.Join(current, "pnpm-workspace.yaml")) || pathExists(filepath.Join(current, ".git")) {
			return current, nil
		}
		if goModRoot == "" && pathExists(filepath.Join(current, "go.mod")) {
			goModRoot = current
		}

		parent := filepath.Dir(current)
		if parent == current {
			break
		}
		current = parent
	}

	if goModRoot != "" {
		return goModRoot, nil
	}
	return resolveExistingPath(start)
}

func pathExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

func pathInsideRoot(path, root string) bool {
	rel, err := filepath.Rel(root, path)
	if err != nil {
		return false
	}
	return rel == "." || (rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator)))
}

func readLimitedText(path string, maxBytes int64) (string, bool, error) {
	file, err := os.Open(path)
	if err != nil {
		return "", false, fmt.Errorf("read file: %w", err)
	}
	defer file.Close()

	data, err := io.ReadAll(io.LimitReader(file, maxBytes+1))
	if err != nil {
		return "", false, fmt.Errorf("read file: %w", err)
	}
	truncated := int64(len(data)) > maxBytes
	if truncated {
		data = data[:maxBytes]
		for !utf8.Valid(data) && len(data) > 0 {
			data = data[:len(data)-1]
		}
	}
	if !utf8.Valid(data) || strings.ContainsRune(string(data), '\x00') {
		return "", false, fmt.Errorf("file is not valid UTF-8 text")
	}
	return string(data), truncated, nil
}

func isSensitivePath(path string) bool {
	for _, part := range strings.Split(filepath.ToSlash(path), "/") {
		name := strings.ToLower(part)
		switch {
		case name == ".ssh" || name == ".aws" || name == ".azure" || name == ".docker" || name == ".gnupg" || name == ".kube":
			return true
		case name == ".env" || strings.HasPrefix(name, ".env."):
			return true
		case name == ".npmrc" || name == ".pypirc" || name == ".netrc" || name == ".pgpass":
			return true
		case name == "id_rsa" || name == "id_ed25519" || name == "id_ecdsa" || name == "id_dsa" || name == "known_hosts":
			return true
		case strings.HasSuffix(name, ".pem") || strings.HasSuffix(name, ".key") || strings.HasSuffix(name, ".p12") || strings.HasSuffix(name, ".pfx"):
			return true
		}
	}
	return false
}

func shouldSkipSearchDir(name string) bool {
	switch name {
	case ".git", "node_modules", "dist", "dist-local", "build", ".next", ".turbo", "vendor":
		return true
	default:
		return false
	}
}

func defaultJSON(raw string) string {
	if strings.TrimSpace(raw) == "" {
		return "{}"
	}
	return raw
}

func jsonString(value any) (string, error) {
	raw, err := json.Marshal(value)
	if err != nil {
		return "", err
	}
	return string(raw), nil
}

func objectSchema(properties map[string]any, required []string) map[string]any {
	schema := map[string]any{
		"type":                 "object",
		"properties":           properties,
		"additionalProperties": false,
	}
	if len(required) > 0 {
		schema["required"] = required
	}
	return schema
}
