package modelapi

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

const (
	DefaultBaseURL = "https://api.openai.com/v1"
	defaultTimeout = 2 * time.Minute
)

var ErrModelsEndpointUnsupported = errors.New("models endpoint unsupported")

type Message struct {
	Role       string     `json:"role"`
	Content    string     `json:"content,omitempty"`
	ToolCallID string     `json:"tool_call_id,omitempty"`
	ToolCalls  []ToolCall `json:"tool_calls,omitempty"`
}

type ChatRequest struct {
	Model    string    `json:"model"`
	Messages []Message `json:"messages"`
	Tools    []Tool    `json:"tools,omitempty"`
}

type Tool struct {
	Type     string       `json:"type"`
	Function ToolFunction `json:"function"`
}

type ToolFunction struct {
	Name        string         `json:"name"`
	Description string         `json:"description,omitempty"`
	Parameters  map[string]any `json:"parameters,omitempty"`
}

type ToolCall struct {
	ID       string           `json:"id"`
	Type     string           `json:"type"`
	Function ToolCallFunction `json:"function"`
}

type ToolCallFunction struct {
	Name      string `json:"name"`
	Arguments string `json:"arguments"`
}

type ChatResult struct {
	Content          string
	ToolCalls        []ToolCall
	InputTokens      int64
	OutputTokens     int64
	CacheReadTokens  int64
	CacheWriteTokens int64
}

type ConnectionTestResult struct {
	OK      bool   `json:"ok"`
	Code    string `json:"code,omitempty"`
	Message string `json:"message"`
	Detail  string `json:"detail,omitempty"`
}

type Client struct {
	apiKey     string
	baseURL    string
	httpClient *http.Client
}

func NewClient(apiKey, baseURL string, httpClient *http.Client) *Client {
	if httpClient == nil {
		httpClient = &http.Client{Timeout: defaultTimeout}
	}
	return &Client{
		apiKey:     strings.TrimSpace(apiKey),
		baseURL:    normalizeBaseURL(baseURL),
		httpClient: httpClient,
	}
}

func (c *Client) ListModels(ctx context.Context) ([]string, error) {
	if c == nil {
		return nil, fmt.Errorf("model API client is not configured")
	}
	if c.apiKey == "" {
		return nil, fmt.Errorf("model API key is not configured")
	}

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+"/models", nil)
	if err != nil {
		return nil, fmt.Errorf("build list models request: %w", err)
	}
	httpReq.Header.Set("Authorization", "Bearer "+c.apiKey)
	httpReq.Header.Set("Accept", "application/json")

	resp, err := c.httpClient.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("call model API models endpoint: %w", err)
	}
	defer resp.Body.Close()

	payload, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return nil, fmt.Errorf("read model API models response: %w", err)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		msg := parseAPIError(payload)
		if msg == "" {
			msg = strings.TrimSpace(string(payload))
		}
		if msg == "" {
			msg = resp.Status
		}
		err := fmt.Errorf("model API models endpoint returned %s: %s", resp.Status, msg)
		if resp.StatusCode == http.StatusNotFound ||
			resp.StatusCode == http.StatusMethodNotAllowed ||
			resp.StatusCode == http.StatusNotImplemented {
			return nil, fmt.Errorf("%w: %v", ErrModelsEndpointUnsupported, err)
		}
		return nil, err
	}

	var out listModelsResponse
	if err := json.Unmarshal(payload, &out); err != nil {
		return nil, fmt.Errorf("decode model API models response: %w", err)
	}
	models := make([]string, 0, len(out.Data))
	seen := make(map[string]struct{}, len(out.Data))
	for _, item := range out.Data {
		id := strings.TrimSpace(item.ID)
		if id == "" {
			continue
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		models = append(models, id)
	}
	return models, nil
}

func (c *Client) TestConnection(ctx context.Context, model string) ConnectionTestResult {
	_, err := c.Chat(ctx, ChatRequest{
		Model: strings.TrimSpace(model),
		Messages: []Message{{
			Role:    "user",
			Content: "Reply with exactly: ok",
		}},
	})
	if err != nil {
		return c.connectionTestError(err)
	}
	return ConnectionTestResult{
		OK:      true,
		Code:    "ok",
		Message: "连接成功，API Key、Base URL 和模型 ID 可用。",
	}
}

func (c *Client) connectionTestError(err error) ConnectionTestResult {
	detail := err.Error()
	if c != nil && c.apiKey != "" {
		detail = strings.ReplaceAll(detail, c.apiKey, "[redacted]")
	}
	lower := strings.ToLower(detail)
	code := "api_error"
	message := "模型服务返回错误，请检查供应商后台的配置。"

	switch {
	case strings.Contains(lower, "api key is not configured"):
		code = "missing_api_key"
		message = "请先填写 API Key。"
	case strings.Contains(lower, "model is not configured"):
		code = "missing_model"
		message = "请先填写模型 ID。"
	case strings.Contains(lower, "401") ||
		strings.Contains(lower, "403") ||
		strings.Contains(lower, "invalid api key") ||
		strings.Contains(lower, "unauthorized") ||
		strings.Contains(lower, "forbidden"):
		code = "auth_failed"
		message = "API Key 无效或没有访问权限。"
	case strings.Contains(lower, "404") ||
		(strings.Contains(lower, "model") &&
			(strings.Contains(lower, "not found") ||
				strings.Contains(lower, "does not exist") ||
				strings.Contains(lower, "bad model"))):
		code = "model_not_found"
		message = "模型 ID 不存在或当前 Key 无权调用这个模型。"
	case strings.Contains(lower, "call model api"):
		code = "connection_failed"
		message = "无法连接 Base URL，请检查地址是否可访问、是否包含 /v1。"
	}

	return ConnectionTestResult{
		OK:      false,
		Code:    code,
		Message: message,
		Detail:  detail,
	}
}

func (c *Client) Chat(ctx context.Context, req ChatRequest) (ChatResult, error) {
	if c == nil {
		return ChatResult{}, fmt.Errorf("model API client is not configured")
	}
	if c.apiKey == "" {
		return ChatResult{}, fmt.Errorf("model API key is not configured")
	}
	if strings.TrimSpace(req.Model) == "" {
		return ChatResult{}, fmt.Errorf("model is not configured")
	}
	if len(req.Messages) == 0 {
		return ChatResult{}, fmt.Errorf("messages are required")
	}

	body, err := json.Marshal(req)
	if err != nil {
		return ChatResult{}, fmt.Errorf("marshal chat request: %w", err)
	}

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/chat/completions", bytes.NewReader(body))
	if err != nil {
		return ChatResult{}, fmt.Errorf("build chat request: %w", err)
	}
	httpReq.Header.Set("Authorization", "Bearer "+c.apiKey)
	httpReq.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(httpReq)
	if err != nil {
		return ChatResult{}, fmt.Errorf("call model API: %w", err)
	}
	defer resp.Body.Close()

	payload, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return ChatResult{}, fmt.Errorf("read model API response: %w", err)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		msg := parseAPIError(payload)
		if msg == "" {
			msg = strings.TrimSpace(string(payload))
		}
		if msg == "" {
			msg = resp.Status
		}
		return ChatResult{}, fmt.Errorf("model API returned %s: %s", resp.Status, msg)
	}

	var out chatCompletionResponse
	if err := json.Unmarshal(payload, &out); err != nil {
		return ChatResult{}, fmt.Errorf("decode model API response: %w", err)
	}
	for _, choice := range out.Choices {
		content := strings.TrimSpace(choice.Message.Content.Value)
		if content != "" || len(choice.Message.ToolCalls) > 0 {
			return ChatResult{
				Content:         content,
				ToolCalls:       choice.Message.ToolCalls,
				InputTokens:     out.Usage.PromptTokens,
				OutputTokens:    out.Usage.CompletionTokens,
				CacheReadTokens: out.Usage.PromptTokensDetails.CachedTokens,
			}, nil
		}
	}
	return ChatResult{}, fmt.Errorf("model API returned no assistant content")
}

// ChatStream 流式调用 LLM（OpenAI 兼容 SSE 协议，stream: true）。
// 每收到一个文本 delta 就调用 onChunk，onChunk 返回错误时立即中止并返回该错误。
// ctx cancel 会立即中断流式读取。
// tool call 场景下模型可能返回 finish_reason="tool_calls"，此时 content delta 为空，
// 调用方应检查返回的 ChatResult.ToolCalls 并决定是否需要追加一轮非流式调用。
// 返回的 ChatResult 包含完整累积文本（Content）、ToolCalls 和 token usage。
func (c *Client) ChatStream(
	ctx context.Context,
	req ChatRequest,
	onChunk func(chunk string) error,
) (ChatResult, error) {
	if c == nil {
		return ChatResult{}, fmt.Errorf("model API client is not configured")
	}
	if c.apiKey == "" {
		return ChatResult{}, fmt.Errorf("model API key is not configured")
	}
	if strings.TrimSpace(req.Model) == "" {
		return ChatResult{}, fmt.Errorf("model is not configured")
	}
	if len(req.Messages) == 0 {
		return ChatResult{}, fmt.Errorf("messages are required")
	}

	// 构造请求体，开启 stream 模式
	type streamRequest struct {
		ChatRequest
		Stream bool `json:"stream"`
	}
	body, err := json.Marshal(streamRequest{ChatRequest: req, Stream: true})
	if err != nil {
		return ChatResult{}, fmt.Errorf("marshal chat stream request: %w", err)
	}

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/chat/completions", bytes.NewReader(body))
	if err != nil {
		return ChatResult{}, fmt.Errorf("build chat stream request: %w", err)
	}
	httpReq.Header.Set("Authorization", "Bearer "+c.apiKey)
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Accept", "text/event-stream")

	// 流式请求不设超时（通过 ctx 控制）
	streamClient := *c.httpClient
	streamClient.Timeout = 0
	resp, err := streamClient.Do(httpReq)
	if err != nil {
		return ChatResult{}, fmt.Errorf("call model API (stream): %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		payload, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
		msg := parseAPIError(payload)
		if msg == "" {
			msg = strings.TrimSpace(string(payload))
		}
		if msg == "" {
			msg = resp.Status
		}
		return ChatResult{}, fmt.Errorf("model API returned %s: %s", resp.Status, msg)
	}

	var (
		fullContent strings.Builder
		toolCalls   []ToolCall
		result      ChatResult
	)

	scanner := bufio.NewScanner(resp.Body)
	for scanner.Scan() {
		// 检查 ctx 是否已取消
		if ctx.Err() != nil {
			return ChatResult{}, ctx.Err()
		}

		line := scanner.Text()
		if line == "" || line == "data: [DONE]" {
			continue
		}
		if !strings.HasPrefix(line, "data: ") {
			continue
		}
		jsonData := line[len("data: "):]

		var chunk streamChunk
		if err := json.Unmarshal([]byte(jsonData), &chunk); err != nil {
			// 忽略无法解析的 chunk（某些 provider 会夹杂注释行）
			continue
		}

		// 提取 usage（某些 provider 在最后一个 chunk 里带 usage）
		if chunk.Usage.PromptTokens > 0 {
			result.InputTokens = chunk.Usage.PromptTokens
			result.OutputTokens = chunk.Usage.CompletionTokens
			result.CacheReadTokens = chunk.Usage.PromptTokensDetails.CachedTokens
		}

		for _, choice := range chunk.Choices {
			delta := choice.Delta

			// 文本 delta
			if delta.Content != "" {
				fullContent.WriteString(delta.Content)
				if onChunk != nil {
					if err := onChunk(delta.Content); err != nil {
						return ChatResult{}, fmt.Errorf("chunk callback: %w", err)
					}
				}
			}

			// tool call delta 累积（index 即 tool call 位置）
			for _, tc := range delta.ToolCalls {
				for len(toolCalls) <= tc.Index {
					toolCalls = append(toolCalls, ToolCall{})
				}
				existing := &toolCalls[tc.Index]
				if tc.ID != "" {
					existing.ID = tc.ID
				}
				if tc.Type != "" {
					existing.Type = tc.Type
				}
				if tc.Function.Name != "" {
					existing.Function.Name = tc.Function.Name
				}
				existing.Function.Arguments += tc.Function.Arguments
			}
		}
	}

	if err := scanner.Err(); err != nil {
		if ctx.Err() != nil {
			return ChatResult{}, ctx.Err()
		}
		return ChatResult{}, fmt.Errorf("read stream: %w", err)
	}

	result.Content = strings.TrimSpace(fullContent.String())
	if len(toolCalls) > 0 {
		result.ToolCalls = toolCalls
	}
	return result, nil
}

// streamChunk 是 OpenAI 兼容流式响应的单个 SSE data 行结构
type streamChunk struct {
	Choices []struct {
		Delta struct {
			Content   string `json:"content"`
			ToolCalls []struct {
				Index    int    `json:"index"`
				ID       string `json:"id"`
				Type     string `json:"type"`
				Function struct {
					Name      string `json:"name"`
					Arguments string `json:"arguments"`
				} `json:"function"`
			} `json:"tool_calls"`
		} `json:"delta"`
	} `json:"choices"`
	Usage struct {
		PromptTokens        int64 `json:"prompt_tokens"`
		CompletionTokens    int64 `json:"completion_tokens"`
		PromptTokensDetails struct {
			CachedTokens int64 `json:"cached_tokens"`
		} `json:"prompt_tokens_details"`
	} `json:"usage"`
}

func normalizeBaseURL(baseURL string) string {
	baseURL = strings.TrimRight(strings.TrimSpace(baseURL), "/")
	if baseURL == "" {
		return DefaultBaseURL
	}
	const chatCompletionsSuffix = "/chat/completions"
	if strings.HasSuffix(strings.ToLower(baseURL), chatCompletionsSuffix) {
		baseURL = strings.TrimRight(baseURL[:len(baseURL)-len(chatCompletionsSuffix)], "/")
	}
	if baseURL == "" {
		return DefaultBaseURL
	}
	return baseURL
}

func parseAPIError(payload []byte) string {
	var out struct {
		Error struct {
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.Unmarshal(payload, &out); err != nil {
		return ""
	}
	return strings.TrimSpace(out.Error.Message)
}

type chatCompletionResponse struct {
	Choices []struct {
		Message struct {
			Content   nullableString `json:"content"`
			ToolCalls []ToolCall     `json:"tool_calls"`
		} `json:"message"`
	} `json:"choices"`
	Usage struct {
		PromptTokens        int64 `json:"prompt_tokens"`
		CompletionTokens    int64 `json:"completion_tokens"`
		PromptTokensDetails struct {
			CachedTokens int64 `json:"cached_tokens"`
		} `json:"prompt_tokens_details"`
	} `json:"usage"`
}

type listModelsResponse struct {
	Data []struct {
		ID string `json:"id"`
	} `json:"data"`
}

type nullableString struct {
	Value string
}

func (s *nullableString) UnmarshalJSON(raw []byte) error {
	if string(raw) == "null" {
		s.Value = ""
		return nil
	}
	return json.Unmarshal(raw, &s.Value)
}
