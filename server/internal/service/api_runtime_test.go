package service

import (
	"testing"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/multica-ai/multica/server/internal/runtimeconfig"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

func TestRuntimeCanQueueDaemonTaskRejectsAPIRuntime(t *testing.T) {
	metadata, err := runtimeconfig.MetadataFromConfig(runtimeconfig.APIRuntimeConfig{
		Provider:          "openai_compatible",
		ModelIDs:          []string{"gpt-4.1-mini"},
		DefaultModel:      "gpt-4.1-mini",
		APIKeyConfigured:  true,
		BaseURLConfigured: true,
	})
	if err != nil {
		t.Fatalf("metadata: %v", err)
	}

	err = runtimeCanQueueDaemonTask(db.AgentRuntime{
		RuntimeMode: runtimeconfig.RuntimeModeCloud,
		Metadata:    metadata,
	})
	if err == nil {
		t.Fatal("expected API runtime to be rejected for daemon task queueing")
	}
}

func TestAPIRuntimeModelForAgentPrefersAgentModel(t *testing.T) {
	model := apiRuntimeModelForAgent(db.Agent{
		Model: pgtype.Text{String: "agent-model", Valid: true},
	}, runtimeconfig.APIRuntimeConfig{
		DefaultModel: "default-model",
	})

	if model != "agent-model" {
		t.Fatalf("expected agent model, got %q", model)
	}
}

func TestAPIRuntimeModelForAgentFallsBackToDefaultModel(t *testing.T) {
	model := apiRuntimeModelForAgent(db.Agent{}, runtimeconfig.APIRuntimeConfig{
		DefaultModel: "default-model",
	})

	if model != "default-model" {
		t.Fatalf("expected default model, got %q", model)
	}
}
