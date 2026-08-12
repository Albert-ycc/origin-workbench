package service

import (
	"encoding/json"
	"testing"

	"github.com/multica-ai/multica/server/internal/tracing"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

func TestTaskCallerLabelDefaultsToChat(t *testing.T) {
	if got := taskCallerLabel(db.AgentTaskQueue{}); got != tracing.CallerChat {
		t.Fatalf("empty context label = %q, want %q", got, tracing.CallerChat)
	}
}

func TestTaskCallerLabelCouncilRoles(t *testing.T) {
	cases := []struct {
		role string
		want string
	}{
		{CouncilBroadcastRoleLead, tracing.CallerCouncilLead},
		{CouncilBroadcastRoleFollower, tracing.CallerCouncilFollower},
		{CouncilBroadcastRoleSalon, tracing.CallerCouncilSalon},
	}
	for _, tc := range cases {
		raw, _ := json.Marshal(CouncilBroadcastContext{Type: CouncilBroadcastContextType, Role: tc.role})
		task := db.AgentTaskQueue{Context: raw}
		if got := taskCallerLabel(task); got != tc.want {
			t.Fatalf("role %q label = %q, want %q", tc.role, got, tc.want)
		}
	}
}

func TestTaskCallerLabelOtherContexts(t *testing.T) {
	cases := []struct {
		name string
		raw  any
		want string
	}{
		{"quick_create", QuickCreateContext{Type: QuickCreateContextType}, tracing.CallerQuickCreate},
		{"project_compaction", ProjectCompactionContext{Type: ProjectCompactionContextType}, tracing.CallerProjectCompaction},
		{"team_delegation", TeamDelegationContext{Type: TeamDelegationContextType}, tracing.CallerTeamDelegation},
	}
	for _, tc := range cases {
		raw, _ := json.Marshal(tc.raw)
		task := db.AgentTaskQueue{Context: raw}
		if got := taskCallerLabel(task); got != tc.want {
			t.Fatalf("%s label = %q, want %q", tc.name, got, tc.want)
		}
	}
}

func TestTaskCallerLabelUnknownCouncilRoleFallsBackToChat(t *testing.T) {
	raw, _ := json.Marshal(CouncilBroadcastContext{Type: CouncilBroadcastContextType, Role: "unknown_role"})
	task := db.AgentTaskQueue{Context: raw}
	if got := taskCallerLabel(task); got != tracing.CallerChat {
		t.Fatalf("unknown council role label = %q, want %q", got, tracing.CallerChat)
	}
}
