package tracing

import (
	"bytes"
	"context"
	"errors"
	"log/slog"
	"strings"
	"testing"
)

func TestNewTraceFields(t *testing.T) {
	tr := NewTrace(CallerCouncilLead, "task-1")
	if tr.TraceID == "" {
		t.Fatal("TraceID should not be empty")
	}
	if tr.Caller != CallerCouncilLead {
		t.Fatalf("Caller = %q, want %q", tr.Caller, CallerCouncilLead)
	}
	if tr.SessionID != "task-1" {
		t.Fatalf("SessionID = %q, want task-1", tr.SessionID)
	}
}

func TestTraceIDsUnique(t *testing.T) {
	a := NewTrace(CallerChat, "s1")
	b := NewTrace(CallerChat, "s2")
	if a.TraceID == b.TraceID {
		t.Fatal("trace IDs should be unique")
	}
}

func TestWithTraceRoundTrip(t *testing.T) {
	ctx := context.Background()
	if _, ok := FromContext(ctx); ok {
		t.Fatal("bare context should carry no trace")
	}
	tr := NewTrace(CallerChat, "s1")
	ctx = WithTrace(ctx, tr)
	got, ok := FromContext(ctx)
	if !ok {
		t.Fatal("WithTrace context should carry a trace")
	}
	if got != tr {
		t.Fatal("WithTrace/FromContext should return the same trace")
	}
}

func TestStartSpanDerivesFromTrace(t *testing.T) {
	tr := NewTrace(CallerCouncilSalon, "chat-9")
	ctx := WithTrace(context.Background(), tr)

	span := StartSpan(ctx, "deepseek-chat")
	if span == nil {
		t.Fatal("StartSpan with traced ctx should not return nil")
	}
	if span.TraceID != tr.TraceID {
		t.Fatalf("Span.TraceID = %q, want %q", span.TraceID, tr.TraceID)
	}
	if span.Caller != CallerCouncilSalon {
		t.Fatalf("Span.Caller = %q, want %q", span.Caller, CallerCouncilSalon)
	}
	if span.SessionID != "chat-9" {
		t.Fatalf("Span.SessionID = %q, want chat-9", span.SessionID)
	}
	if span.SpanID == "" {
		t.Fatal("SpanID should not be empty")
	}
	if span.Model != "deepseek-chat" {
		t.Fatalf("Span.Model = %q, want deepseek-chat", span.Model)
	}
}

func TestStartSpanWithoutTraceReturnsNil(t *testing.T) {
	if s := StartSpan(context.Background(), "gpt-4o"); s != nil {
		t.Fatal("StartSpan with untraced ctx should return nil")
	}
}

func TestSpanIDsUnique(t *testing.T) {
	tr := NewTrace(CallerChat, "s1")
	ctx := WithTrace(context.Background(), tr)
	a := StartSpan(ctx, "m1")
	b := StartSpan(ctx, "m2")
	if a.SpanID == b.SpanID {
		t.Fatal("span IDs should be unique")
	}
}

// captureLogs 把 slog 默认输出重定向到 buffer 跑完 fn 后恢复，返回日志文本。
func captureLogs(t *testing.T, fn func()) string {
	t.Helper()
	var buf bytes.Buffer
	prev := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&buf, &slog.HandlerOptions{Level: slog.LevelDebug})))
	defer slog.SetDefault(prev)
	fn()
	return buf.String()
}

func TestFinishLogsStructured(t *testing.T) {
	tr := NewTrace(CallerCouncilLead, "task-42")
	ctx := WithTrace(context.Background(), tr)
	span := StartSpan(ctx, "deepseek-chat")

	out := captureLogs(t, func() {
		span.Finish(120, 80, nil)
	})
	for _, want := range []string{
		"llm_call",
		"trace_id=" + tr.TraceID,
		"caller=council_lead",
		"session_id=task-42",
		"model=deepseek-chat",
		"input_tokens=120",
		"output_tokens=80",
		"duration_ms=",
	} {
		if !strings.Contains(out, want) {
			t.Fatalf("log missing %q:\n%s", want, out)
		}
	}
}

func TestFinishLogsError(t *testing.T) {
	tr := NewTrace(CallerChat, "s1")
	ctx := WithTrace(context.Background(), tr)
	span := StartSpan(ctx, "gpt-4o")

	out := captureLogs(t, func() {
		span.Finish(10, 0, errors.New("boom"))
	})
	for _, want := range []string{"llm_call_failed", "caller=chat", "error=boom"} {
		if !strings.Contains(out, want) {
			t.Fatalf("log missing %q:\n%s", want, out)
		}
	}
	if strings.Contains(out, "msg=llm_call ") {
		t.Fatalf("failed call should not emit llm_call info log:\n%s", out)
	}
}
