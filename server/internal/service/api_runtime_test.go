package service

import (
	"context"
	"testing"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/multica-ai/multica/server/internal/modelapi"
	"github.com/multica-ai/multica/server/internal/runtimeconfig"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

type fakeAPIRuntimeChatClient struct {
	requests  []modelapi.ChatRequest
	responses []modelapi.ChatResult
}

func (f *fakeAPIRuntimeChatClient) Chat(_ context.Context, req modelapi.ChatRequest) (modelapi.ChatResult, error) {
	f.requests = append(f.requests, req)
	if len(f.responses) == 0 {
		return modelapi.ChatResult{}, nil
	}
	res := f.responses[0]
	f.responses = f.responses[1:]
	return res, nil
}

type fakeAPIRuntimeToolExecutor struct {
	tools []modelapi.Tool
	calls []modelapi.ToolCall
}

func (f *fakeAPIRuntimeToolExecutor) Tools() []modelapi.Tool {
	return f.tools
}

func (f *fakeAPIRuntimeToolExecutor) Execute(_ context.Context, call modelapi.ToolCall) (string, error) {
	f.calls = append(f.calls, call)
	return `{"content":"hello from README"}`, nil
}

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

func TestRunAPIRuntimeChatLoopExecutesToolCalls(t *testing.T) {
	client := &fakeAPIRuntimeChatClient{
		responses: []modelapi.ChatResult{
			{
				ToolCalls: []modelapi.ToolCall{{
					ID:   "call_1",
					Type: "function",
					Function: modelapi.ToolCallFunction{
						Name:      "read_text_file",
						Arguments: `{"path":"README.md"}`,
					},
				}},
				InputTokens:  7,
				OutputTokens: 2,
			},
			{
				Content:      "README says hello",
				InputTokens:  11,
				OutputTokens: 5,
			},
		},
	}
	executor := &fakeAPIRuntimeToolExecutor{
		tools: []modelapi.Tool{{
			Type: "function",
			Function: modelapi.ToolFunction{
				Name:        "read_text_file",
				Description: "read file",
				Parameters:  map[string]any{"type": "object"},
			},
		}},
	}

	res, err := runAPIRuntimeChatLoop(context.Background(), client, executor, "model-a", []modelapi.Message{
		{Role: "user", Content: "read README"},
	})
	if err != nil {
		t.Fatalf("chat loop: %v", err)
	}
	if res.Content != "README says hello" {
		t.Fatalf("content = %q", res.Content)
	}
	if res.InputTokens != 18 || res.OutputTokens != 7 {
		t.Fatalf("usage = %d/%d, want 18/7", res.InputTokens, res.OutputTokens)
	}
	if len(client.requests) != 2 {
		t.Fatalf("requests = %d, want 2", len(client.requests))
	}
	if len(client.requests[0].Tools) != 1 {
		t.Fatalf("first request should expose tools: %+v", client.requests[0].Tools)
	}

	secondMessages := client.requests[1].Messages
	if len(secondMessages) != 3 {
		t.Fatalf("second request messages = %d, want 3: %+v", len(secondMessages), secondMessages)
	}
	if got := secondMessages[1].ToolCalls[0].ID; got != "call_1" {
		t.Fatalf("assistant tool call id = %q", got)
	}
	if secondMessages[2].Role != "tool" || secondMessages[2].ToolCallID != "call_1" {
		t.Fatalf("tool message not appended correctly: %+v", secondMessages[2])
	}
	if secondMessages[2].Content != `{"content":"hello from README"}` {
		t.Fatalf("tool output = %q", secondMessages[2].Content)
	}
	if len(executor.calls) != 1 || executor.calls[0].Function.Name != "read_text_file" {
		t.Fatalf("executor calls = %+v", executor.calls)
	}
}
