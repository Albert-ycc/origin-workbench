package apitools

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/multica-ai/multica/server/internal/modelapi"
)

func TestLocalExecutorReadsListsAndSearchesWithinRoot(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "README.md"), []byte("hello from README\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	docsDir := filepath.Join(root, "docs")
	if err := os.Mkdir(docsDir, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(docsDir, "guide.txt"), []byte("A guide with Needle text\n"), 0o600); err != nil {
		t.Fatal(err)
	}

	executor, err := NewLocalExecutor(Config{Roots: []string{root}})
	if err != nil {
		t.Fatalf("executor: %v", err)
	}
	if len(executor.Tools()) != 3 {
		t.Fatalf("tools = %d, want 3", len(executor.Tools()))
	}

	read := executeTool(t, executor, "read_text_file", `{"path":"README.md"}`)
	if read["path"] != "README.md" || read["content"] != "hello from README\n" {
		t.Fatalf("read output = %+v", read)
	}

	list := executeTool(t, executor, "list_directory", `{"path":"."}`)
	entries, ok := list["entries"].([]any)
	if !ok || len(entries) != 2 {
		t.Fatalf("list entries = %+v", list["entries"])
	}

	search := executeTool(t, executor, "search_text", `{"query":"needle","path":"docs"}`)
	matches, ok := search["matches"].([]any)
	if !ok || len(matches) != 1 {
		t.Fatalf("search matches = %+v", search["matches"])
	}
	match := matches[0].(map[string]any)
	if match["path"] != "docs/guide.txt" || match["line"].(float64) != 1 {
		t.Fatalf("search match = %+v", match)
	}
}

func TestLocalExecutorRejectsOutsideRootAndSecrets(t *testing.T) {
	root := t.TempDir()
	outside := t.TempDir()
	if err := os.WriteFile(filepath.Join(outside, "outside.txt"), []byte("secret"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, ".env"), []byte("TOKEN=secret"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, ".npmrc"), []byte("//registry.example.test/:_authToken=needle-secret"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(filepath.Join(root, ".aws"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, ".aws", "credentials"), []byte("aws_access_key_id=needle-secret"), 0o600); err != nil {
		t.Fatal(err)
	}

	executor, err := NewLocalExecutor(Config{Roots: []string{root}})
	if err != nil {
		t.Fatalf("executor: %v", err)
	}

	_, err = executor.Execute(context.Background(), modelapi.ToolCall{
		Function: modelapi.ToolCallFunction{
			Name:      "read_text_file",
			Arguments: `{"path":"` + filepath.ToSlash(filepath.Join(outside, "outside.txt")) + `"}`,
		},
	})
	if err == nil || !strings.Contains(err.Error(), "outside configured API tool roots") {
		t.Fatalf("outside path err = %v", err)
	}

	_, err = executor.Execute(context.Background(), modelapi.ToolCall{
		Function: modelapi.ToolCallFunction{
			Name:      "read_text_file",
			Arguments: `{"path":".env"}`,
		},
	})
	if err == nil || !strings.Contains(err.Error(), "sensitive file") {
		t.Fatalf("secret path err = %v", err)
	}

	for _, path := range []string{".npmrc", ".aws/credentials"} {
		_, err = executor.Execute(context.Background(), modelapi.ToolCall{
			Function: modelapi.ToolCallFunction{
				Name:      "read_text_file",
				Arguments: `{"path":"` + path + `"}`,
			},
		})
		if err == nil || !strings.Contains(err.Error(), "sensitive file") {
			t.Fatalf("sensitive path %s err = %v", path, err)
		}
	}

	search := executeTool(t, executor, "search_text", `{"query":"needle-secret","path":"."}`)
	if rawMatches, ok := search["matches"]; ok && rawMatches != nil {
		matches, ok := rawMatches.([]any)
		if !ok {
			t.Fatalf("search matches = %+v", rawMatches)
		}
		if len(matches) != 0 {
			t.Fatalf("sensitive files should be excluded from search, got %+v", matches)
		}
	}
}

func TestLocalExecutorDefaultsToWorkspaceRoot(t *testing.T) {
	temp := t.TempDir()
	repoRoot := filepath.Join(temp, "repo")
	serverDir := filepath.Join(repoRoot, "server")
	if err := os.MkdirAll(serverDir, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(repoRoot, "pnpm-workspace.yaml"), []byte("packages: []\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(serverDir, "go.mod"), []byte("module example.test/server\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	wantRoot, err := resolveExistingPath(repoRoot)
	if err != nil {
		t.Fatal(err)
	}

	originalWD, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Chdir(serverDir); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := os.Chdir(originalWD); err != nil {
			t.Fatalf("restore wd: %v", err)
		}
	})

	executor, err := NewLocalExecutor(Config{})
	if err != nil {
		t.Fatalf("executor: %v", err)
	}
	if len(executor.roots) != 1 || executor.roots[0] != wantRoot {
		t.Fatalf("roots = %+v, want [%s]", executor.roots, wantRoot)
	}
}

func executeTool(t *testing.T, executor *LocalExecutor, name, args string) map[string]any {
	t.Helper()
	out, err := executor.Execute(context.Background(), modelapi.ToolCall{
		Function: modelapi.ToolCallFunction{
			Name:      name,
			Arguments: args,
		},
	})
	if err != nil {
		t.Fatalf("%s: %v", name, err)
	}
	var decoded map[string]any
	if err := json.Unmarshal([]byte(out), &decoded); err != nil {
		t.Fatalf("decode %s output %q: %v", name, out, err)
	}
	return decoded
}
