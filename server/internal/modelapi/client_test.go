package modelapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestClientChatCallsOpenAICompatibleEndpoint(t *testing.T) {
	var gotAuth string
	var gotPath string
	var gotReq ChatRequest

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		gotPath = r.URL.Path
		if err := json.NewDecoder(r.Body).Decode(&gotReq); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{
			"choices":[{"message":{"content":"  hello from api  "}}],
			"usage":{"prompt_tokens":12,"completion_tokens":4}
		}`))
	}))
	defer server.Close()

	client := NewClient("sk-test", server.URL+"/", server.Client())
	res, err := client.Chat(context.Background(), ChatRequest{
		Model: "model-a",
		Messages: []Message{
			{Role: "user", Content: "hi"},
		},
	})
	if err != nil {
		t.Fatalf("chat: %v", err)
	}

	if gotPath != "/chat/completions" {
		t.Fatalf("path = %q, want /chat/completions", gotPath)
	}
	if gotAuth != "Bearer sk-test" {
		t.Fatalf("authorization header mismatch: %q", gotAuth)
	}
	if gotReq.Model != "model-a" || len(gotReq.Messages) != 1 || gotReq.Messages[0].Content != "hi" {
		t.Fatalf("unexpected request: %+v", gotReq)
	}
	if res.Content != "hello from api" {
		t.Fatalf("content = %q", res.Content)
	}
	if res.InputTokens != 12 || res.OutputTokens != 4 {
		t.Fatalf("usage mismatch: %+v", res)
	}
}

func TestClientChatSendsToolsAndParsesToolCalls(t *testing.T) {
	var gotReq ChatRequest

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := json.NewDecoder(r.Body).Decode(&gotReq); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{
			"choices":[{
				"message":{
					"content": null,
					"tool_calls":[{
						"id":"call_1",
						"type":"function",
						"function":{
							"name":"read_text_file",
							"arguments":"{\"path\":\"README.md\"}"
						}
					}]
				}
			}],
			"usage":{"prompt_tokens":9,"completion_tokens":3}
		}`))
	}))
	defer server.Close()

	client := NewClient("sk-test", server.URL, server.Client())
	res, err := client.Chat(context.Background(), ChatRequest{
		Model: "model-a",
		Messages: []Message{
			{Role: "user", Content: "read README"},
		},
		Tools: []Tool{{
			Type: "function",
			Function: ToolFunction{
				Name:        "read_text_file",
				Description: "Read a file",
				Parameters:  map[string]any{"type": "object"},
			},
		}},
	})
	if err != nil {
		t.Fatalf("chat: %v", err)
	}

	if len(gotReq.Tools) != 1 || gotReq.Tools[0].Function.Name != "read_text_file" {
		t.Fatalf("tools not sent: %+v", gotReq.Tools)
	}
	if len(res.ToolCalls) != 1 {
		t.Fatalf("expected 1 tool call, got %+v", res.ToolCalls)
	}
	call := res.ToolCalls[0]
	if call.ID != "call_1" || call.Function.Name != "read_text_file" || call.Function.Arguments != `{"path":"README.md"}` {
		t.Fatalf("unexpected tool call: %+v", call)
	}
	if res.InputTokens != 9 || res.OutputTokens != 3 {
		t.Fatalf("usage mismatch: %+v", res)
	}
}

func TestClientChatAcceptsFullChatCompletionsEndpointAsBaseURL(t *testing.T) {
	var gotPath string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{
			"choices":[{"message":{"content":"ok"}}],
			"usage":{"prompt_tokens":1,"completion_tokens":1}
		}`))
	}))
	defer server.Close()

	client := NewClient("sk-test", server.URL+"/v1/chat/completions", server.Client())
	_, err := client.Chat(context.Background(), ChatRequest{
		Model:    "model-a",
		Messages: []Message{{Role: "user", Content: "hi"}},
	})
	if err != nil {
		t.Fatalf("chat: %v", err)
	}
	if gotPath != "/v1/chat/completions" {
		t.Fatalf("path = %q, want /v1/chat/completions", gotPath)
	}
}

func TestClientChatSurfacesAPIError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"error":{"message":"bad model"}}`))
	}))
	defer server.Close()

	client := NewClient("sk-test", server.URL, server.Client())
	_, err := client.Chat(context.Background(), ChatRequest{
		Model:    "missing",
		Messages: []Message{{Role: "user", Content: "hi"}},
	})
	if err == nil || !strings.Contains(err.Error(), "bad model") {
		t.Fatalf("expected API error, got %v", err)
	}
}
