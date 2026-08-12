package personabible

import (
	"strings"
	"testing"
)

func TestLoadAllRoles(t *testing.T) {
	cases := []struct {
		role string
		want string
	}{
		{RoleLead, "林知遥"},
		{RoleFollower, "周维"},
		{RoleSalonSpeaker, "江照"},
	}
	for _, c := range cases {
		t.Run(c.role, func(t *testing.T) {
			p, err := Load(c.role)
			if err != nil {
				t.Fatalf("Load(%q) error: %v", c.role, err)
			}
			if p == nil {
				t.Fatalf("Load(%q) returned nil persona", c.role)
			}
			if p.Name != c.want {
				t.Errorf("Load(%q).Name = %q, want %q", c.role, p.Name, c.want)
			}
			if p.Role != c.role {
				t.Errorf("Load(%q).Role = %q, want %q", c.role, p.Role, c.role)
			}
			if p.Body == "" {
				t.Errorf("Load(%q).Body is empty", c.role)
			}
		})
	}
}

func TestLoadUnknownRoleReturnsNil(t *testing.T) {
	p, err := Load("ghost")
	if err == nil {
		t.Fatalf("Load(unknown) error = nil, want non-nil")
	}
	if p != nil {
		t.Errorf("Load(unknown) persona = %+v, want nil", p)
	}
}

func TestInjectNilPersonaShortCircuits(t *testing.T) {
	prompt := "用户消息：你好"
	if got := Inject(nil, prompt); got != prompt {
		t.Errorf("Inject(nil) = %q, want %q", got, prompt)
	}
}

func TestInjectContainsPersonaAndTaboos(t *testing.T) {
	p, err := Load(RoleLead)
	if err != nil {
		t.Fatalf("Load(lead) error: %v", err)
	}
	out := Inject(p, "用户消息：说说这个方案")
	for _, want := range []string{
		"你是 林知遥",
		"写作禁忌",
		"安全网",
		"破折号",
	} {
		if !strings.Contains(out, want) {
			t.Errorf("Inject output missing %q\n%s", want, out)
		}
	}
}

func TestInjectPreservesOriginalPrompt(t *testing.T) {
	p, err := Load(RoleFollower)
	if err != nil {
		t.Fatalf("Load(follower) error: %v", err)
	}
	original := "用户消息：请给一个结论\n"
	out := Inject(p, original)
	if !strings.HasSuffix(out, original) {
		t.Errorf("Inject output must end with the original prompt\n%s", out)
	}
}

func TestParseFrontmatterList(t *testing.T) {
	fm, body, err := parseFrontmatter("---\nname: 测试\nforbidden_phrases:\n  - a\n  - b\n---\n正文")
	if err != nil {
		t.Fatalf("parseFrontmatter error: %v", err)
	}
	if got := stringVal(fm["name"]); got != "测试" {
		t.Errorf("name = %q, want 测试", got)
	}
	if got := stringListVal(fm["forbidden_phrases"]); len(got) != 2 || got[0] != "a" || got[1] != "b" {
		t.Errorf("forbidden_phrases = %v, want [a b]", got)
	}
	if body != "正文" {
		t.Errorf("body = %q, want 正文", body)
	}
}

func TestParseFrontmatterMissingDelimiter(t *testing.T) {
	if _, _, err := parseFrontmatter("no frontmatter"); err == nil {
		t.Fatalf("expected error for missing frontmatter, got nil")
	}
}
