package daemon

import (
	"strings"
	"testing"
)

func TestBuildPromptProjectCompactionRequiresStrictJSON(t *testing.T) {
	prompt := BuildPrompt(Task{
		ProjectCompaction: &ProjectCompactionData{
			ProjectID:     "project-1",
			ProjectTitle:  "Origin",
			ChatSessionID: "chat-1",
			MessageCount:  1,
			Messages: []ProjectCompactionMessage{{
				ID:        "msg-1",
				Role:      "assistant",
				Speaker:   "Captain",
				Content:   "Decision: ship the async compaction preview.",
				CreatedAt: "2026-05-06T00:00:00Z",
			}},
		},
	})

	for _, want := range []string{
		"Output strict JSON only",
		"pinned_message_ids",
		"id=msg-1",
	} {
		if !strings.Contains(prompt, want) {
			t.Fatalf("prompt missing %q\n%s", want, prompt)
		}
	}
	if strings.Contains(prompt, "multica issue get") {
		t.Fatalf("compaction prompt must not ask for issue workflow\n%s", prompt)
	}
}
