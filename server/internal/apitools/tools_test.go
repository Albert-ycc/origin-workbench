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
