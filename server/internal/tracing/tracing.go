// Package tracing 提供轻量的 LLM 调用追踪：会话级 Trace + 单次调用 Span，
// 输出结构化 slog 日志。只依赖标准库，不引入 OpenTelemetry。
//
// 用法：
//
//	t := tracing.NewTrace(caller, sessionID)
//	ctx = tracing.WithTrace(ctx, t)
//	...
//	// modelapi 客户端内部在每次 Chat / ChatStream 进出时自动开启/关闭 span，
//	// 调用方无需手动包 span。
package tracing

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"log/slog"
	"time"
)

// Caller 标签标识一次 LLM 调用链的发起方。由 service 层从任务上下文解析后
// 注入，值固定为 snake_case，便于日志聚合与前端过滤。
const (
	CallerChat              = "chat"
	CallerQuickCreate       = "quick_create"
	CallerCouncilLead       = "council_lead"
	CallerCouncilFollower   = "council_follower"
	CallerCouncilSalon      = "council_salon"
	CallerProjectCompaction = "project_compaction"
	CallerTeamDelegation    = "team_delegation"
	CallerSkillInvocation   = "skill_invocation"
	CallerAutopilot         = "autopilot"
)

// Trace 是一次会话级追踪的根：同一 chat session / task 内的所有 LLM 调用
// 共享一个 TraceID，日志里按 trace_id 即可串起一次完整的 agent 交互。
type Trace struct {
	TraceID   string
	Caller    string
	SessionID string
	StartedAt time.Time
}

// Span 是单次 LLM 调用的追踪记录。modelapi 客户端在每次 Chat / ChatStream
// 请求进出时开启与关闭，输出结构化 slog 日志（llm_call / llm_call_failed）。
type Span struct {
	TraceID      string
	SpanID       string
	Caller       string
	SessionID    string
	Model        string
	StartedAt    time.Time
	InputTokens  int64
	OutputTokens int64
}

type traceKey struct{}

// WithTrace 把会话级 Trace 注入 ctx，随调用链穿透到 modelapi 客户端。
func WithTrace(ctx context.Context, t *Trace) context.Context {
	return context.WithValue(ctx, traceKey{}, t)
}

// FromContext 取回 ctx 里的 Trace；无 trace 时 ok=false，调用方静默跳过。
func FromContext(ctx context.Context) (*Trace, bool) {
	t, ok := ctx.Value(traceKey{}).(*Trace)
	return t, ok
}

// NewTrace 开启一次会话级 trace。caller 用本包导出的 Caller 常量。
func NewTrace(caller, sessionID string) *Trace {
	return &Trace{
		TraceID:   newID(),
		Caller:    caller,
		SessionID: sessionID,
		StartedAt: time.Now(),
	}
}

// StartSpan 从 ctx 里的 Trace 派生一次 LLM 调用 span。ctx 无 trace（例如
// 连接测试、非 LLM 调用路径）时返回 nil，调用方据此跳过，避免空日志污染。
func StartSpan(ctx context.Context, model string) *Span {
	t, ok := FromContext(ctx)
	if !ok || t == nil {
		return nil
	}
	return &Span{
		TraceID:   t.TraceID,
		SpanID:    newID(),
		Caller:    t.Caller,
		SessionID: t.SessionID,
		Model:     model,
		StartedAt: time.Now(),
	}
}

// Finish 结束一次 LLM 调用 span，输出结构化日志。err 非 nil 时输出
// llm_call_failed（Warn 级），否则 llm_call（Info 级）。
func (s *Span) Finish(inputTokens, outputTokens int64, err error) {
	s.InputTokens = inputTokens
	s.OutputTokens = outputTokens
	attrs := []any{
		"trace_id", s.TraceID,
		"span_id", s.SpanID,
		"caller", s.Caller,
		"model", s.Model,
		"input_tokens", inputTokens,
		"output_tokens", outputTokens,
		"duration_ms", time.Since(s.StartedAt).Milliseconds(),
	}
	if s.SessionID != "" {
		attrs = append(attrs, "session_id", s.SessionID)
	}
	if err != nil {
		slog.Warn("llm_call_failed", append(attrs, "error", err.Error())...)
		return
	}
	slog.Info("llm_call", attrs...)
}

// newID 生成 32 位 hex 随机 ID（trace_id / span_id 共用）。
func newID() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}
