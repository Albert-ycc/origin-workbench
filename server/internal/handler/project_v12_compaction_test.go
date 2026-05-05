package handler

import (
	"strings"
	"testing"
)

func TestParseCompactionDraftOutputAcceptsFencedJSON(t *testing.T) {
	out := "```json\n{\"key_decisions\":[\"ship v1\"],\"deliverables\":[\"docs\"],\"current_status\":\"ready\",\"carry_forward\":[\"tag release\"],\"pinned_message_ids\":[\"m1\"]}\n```"

	got, err := parseCompactionDraftOutput(out)
	if err != nil {
		t.Fatalf("parseCompactionDraftOutput returned error: %v", err)
	}
	if got.CurrentStatus != "ready" {
		t.Fatalf("current_status = %q", got.CurrentStatus)
	}
	if len(got.KeyDecisions) != 1 || got.KeyDecisions[0] != "ship v1" {
		t.Fatalf("key_decisions = %#v", got.KeyDecisions)
	}
	if len(got.PinnedMessageIDs) != 1 || got.PinnedMessageIDs[0] != "m1" {
		t.Fatalf("pinned_message_ids = %#v", got.PinnedMessageIDs)
	}
}

func TestParseCompactionDraftOutputRejectsNonJSON(t *testing.T) {
	_, err := parseCompactionDraftOutput("I think the project is ready.")
	if err == nil {
		t.Fatal("expected error")
	}
	if !strings.Contains(err.Error(), "JSON object") {
		t.Fatalf("unexpected error: %v", err)
	}
}
