package service

import "testing"

func TestBuildChatSkillInvocationContextDedupesAndTrims(t *testing.T) {
	raw, ok := BuildChatSkillInvocationContext([]string{
		" skill-a ",
		"",
		"skill-b",
		"skill-a",
	})
	if !ok {
		t.Fatal("expected context to be built")
	}

	ctx, ok := ParseChatSkillInvocationContext(raw)
	if !ok {
		t.Fatalf("expected context to parse, got raw=%s", string(raw))
	}
	if ctx.Type != ChatSkillInvocationContextType {
		t.Fatalf("type = %q, want %q", ctx.Type, ChatSkillInvocationContextType)
	}
	if got, want := ctx.SkillIDs, []string{"skill-a", "skill-b"}; !equalStrings(got, want) {
		t.Fatalf("skill ids = %#v, want %#v", got, want)
	}
}

func TestBuildChatSkillInvocationContextSkipsEmpty(t *testing.T) {
	raw, ok := BuildChatSkillInvocationContext([]string{"", "  "})
	if ok {
		t.Fatalf("expected empty context to be skipped, got %s", string(raw))
	}
}

func equalStrings(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}
