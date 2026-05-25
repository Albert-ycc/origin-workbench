package modelapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
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

func TestClientListModelsParsesOpenAICompatibleResponse(t *testing.T) {
	var gotAuth string
	var gotPath string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		gotPath = r.URL.Path
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{
			"object":"list",
			"data":[
				{"id":"model-a","object":"model"},
				{"id":" model-b "},
				{"id":""},
				{"object":"model"}
			]
		}`))
	}))
	defer server.Close()

	client := NewClient("sk-test", server.URL+"/v1/chat/completions", server.Client())
	models, err := client.ListModels(context.Background())
	if err != nil {
		t.Fatalf("ListModels: %v", err)
	}

	if gotPath != "/v1/models" {
		t.Fatalf("path = %q, want /v1/models", gotPath)
	}
	if gotAuth != "Bearer sk-test" {
		t.Fatalf("authorization header mismatch: %q", gotAuth)
	}
	if len(models) != 2 || models[0] != "model-a" || models[1] != "model-b" {
		t.Fatalf("models = %+v", models)
	}
}

func TestClientListModelsClassifiesUnsupportedEndpointWithoutBreakingChat(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/models":
			w.WriteHeader(http.StatusNotFound)
			_, _ = w.Write([]byte(`{"error":{"message":"not found"}}`))
		case "/chat/completions":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"ok"}}]}`))
		default:
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
	}))
	defer server.Close()

	client := NewClient("sk-test", server.URL, server.Client())
	models, err := client.ListModels(context.Background())
	if !errors.Is(err, ErrModelsEndpointUnsupported) {
		t.Fatalf("expected ErrModelsEndpointUnsupported, got models=%+v err=%v", models, err)
	}

	res, err := client.Chat(context.Background(), ChatRequest{
		Model:    "model-a",
		Messages: []Message{{Role: "user", Content: "hi"}},
	})
	if err != nil {
		t.Fatalf("chat should still use chat completions: %v", err)
	}
	if res.Content != "ok" {
		t.Fatalf("chat content = %q", res.Content)
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

func TestClientTestConnectionSucceedsWithMinimalChatCompletion(t *testing.T) {
	var gotReq ChatRequest
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := json.NewDecoder(r.Body).Decode(&gotReq); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"ok"}}]}`))
	}))
	defer server.Close()

	client := NewClient("sk-test", server.URL, server.Client())
	result := client.TestConnection(context.Background(), "model-a")
	if !result.OK {
		t.Fatalf("expected successful connection test, got %+v", result)
	}
	if gotReq.Model != "model-a" || len(gotReq.Messages) != 1 {
		t.Fatalf("unexpected test request: %+v", gotReq)
	}
}

func TestClientTestConnectionClassifiesAuthFailure(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte(`{"error":{"message":"invalid api key"}}`))
	}))
	defer server.Close()

	client := NewClient("sk-bad", server.URL, server.Client())
	result := client.TestConnection(context.Background(), "model-a")
	if result.OK {
		t.Fatalf("expected failed connection test")
	}
	if result.Code != "auth_failed" {
		t.Fatalf("code = %q, want auth_failed (full result: %+v)", result.Code, result)
	}
	if strings.Contains(strings.ToLower(result.Message), "sk-bad") || strings.Contains(result.Detail, "sk-bad") {
		t.Fatalf("connection test result must not echo API key: %+v", result)
	}
}

// SSE 响应构建辅助
func sseLines(chunks ...string) string {
	var b strings.Builder
	for _, c := range chunks {
		b.WriteString(c)
		b.WriteString("\n")
	}
	b.WriteString("data: [DONE]\n")
	return b.String()
}

func sseChunk(content string) string {
	return fmt.Sprintf(`data: {"choices":[{"delta":{"content":%s}}]}`, jsonStr(content))
}

func sseUsageChunk(prompt, completion int64) string {
	return fmt.Sprintf(`data: {"choices":[],"usage":{"prompt_tokens":%d,"completion_tokens":%d}}`, prompt, completion)
}

func jsonStr(s string) string {
	b, _ := json.Marshal(s)
	return string(b)
}

func TestClientChatStreamBasicCase(t *testing.T) {
	var gotStreamParam bool
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req map[string]any
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			t.Fatalf("decode: %v", err)
		}
		gotStreamParam, _ = req["stream"].(bool)

		w.Header().Set("Content-Type", "text/event-stream")
		body := sseLines(
			sseChunk("Hello"),
			sseChunk(", world"),
			sseChunk("!"),
			sseUsageChunk(10, 5),
		)
		_, _ = w.Write([]byte(body))
	}))
	defer server.Close()

	client := NewClient("sk-test", server.URL, server.Client())

	var got []string
	res, err := client.ChatStream(context.Background(), ChatRequest{
		Model:    "model-a",
		Messages: []Message{{Role: "user", Content: "hi"}},
	}, func(chunk string) error {
		got = append(got, chunk)
		return nil
	})
	if err != nil {
		t.Fatalf("ChatStream: %v", err)
	}
	if !gotStreamParam {
		t.Fatal("expected stream=true in request body")
	}
	if res.Content != "Hello, world!" {
		t.Fatalf("content = %q", res.Content)
	}
	if len(got) != 3 {
		t.Fatalf("expected 3 chunks, got %v", got)
	}
	if res.InputTokens != 10 || res.OutputTokens != 5 {
		t.Fatalf("usage mismatch: %+v", res)
	}
}

func TestClientChatStreamCtxCancel(t *testing.T) {
	// 服务端先发一个 chunk，然后阻塞（模拟长流）
	started := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		flusher, ok := w.(http.Flusher)
		if !ok {
			t.Error("ResponseWriter is not a Flusher")
			return
		}
		_, _ = fmt.Fprint(w, sseChunk("first")+"\n")
		flusher.Flush()
		close(started)
		// 阻塞直到请求断开
		<-r.Context().Done()
	}))
	defer server.Close()

	ctx, cancel := context.WithCancel(context.Background())
	client := NewClient("sk-test", server.URL, server.Client())

	go func() {
		<-started
		cancel()
	}()

	_, err := client.ChatStream(ctx, ChatRequest{
		Model:    "model-a",
		Messages: []Message{{Role: "user", Content: "hi"}},
	}, nil)

	if err == nil {
		t.Fatal("expected error on ctx cancel, got nil")
	}
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("expected context.Canceled, got %v", err)
	}
}

func TestClientChatStreamOnChunkError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		body := sseLines(sseChunk("tok1"), sseChunk("tok2"), sseChunk("tok3"))
		_, _ = w.Write([]byte(body))
	}))
	defer server.Close()

	client := NewClient("sk-test", server.URL, server.Client())

	callCount := 0
	wantErr := errors.New("downstream closed")
	_, err := client.ChatStream(context.Background(), ChatRequest{
		Model:    "model-a",
		Messages: []Message{{Role: "user", Content: "hi"}},
	}, func(chunk string) error {
		callCount++
		if callCount == 2 {
			return wantErr
		}
		return nil
	})

	if !errors.Is(err, wantErr) {
		t.Fatalf("expected wantErr, got %v", err)
	}
	// 第 2 次 callback 返回错误后必须立即中止，不再调用第 3 次
	if callCount != 2 {
		t.Fatalf("expected 2 callback calls, got %d", callCount)
	}
}
