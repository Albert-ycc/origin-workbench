package modelapi

import (
	"bytes"
	"context"
	"encoding/json"
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

type Message struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type ChatRequest struct {
	Model    string    `json:"model"`
	Messages []Message `json:"messages"`
}

type ChatResult struct {
	Content          string
	InputTokens      int64
	OutputTokens     int64
	CacheReadTokens  int64
	CacheWriteTokens int64
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
		content := strings.TrimSpace(choice.Message.Content)
		if content != "" {
			return ChatResult{
				Content:         content,
				InputTokens:     out.Usage.PromptTokens,
				OutputTokens:    out.Usage.CompletionTokens,
				CacheReadTokens: out.Usage.PromptTokensDetails.CachedTokens,
			}, nil
		}
	}
	return ChatResult{}, fmt.Errorf("model API returned no assistant content")
}

func normalizeBaseURL(baseURL string) string {
	baseURL = strings.TrimRight(strings.TrimSpace(baseURL), "/")
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
			Content string `json:"content"`
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
