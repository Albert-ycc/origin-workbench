// Package personabible is the persona bible for Origin's living-room agents.
//
// Each council role (lead / follower / salon speaker) has a markdown persona
// card embedded at build time. The frontmatter carries the stable identity
// fields; the body is free-form role guidance. Inject is the single entry
// point that prepends a persona and a hard-coded writing-taboo safety net
// (independent of the markdown files) in front of any agent prompt.
package personabible

import (
	"embed"
	"fmt"
	"strings"
)

//go:embed bibles/*.md
var biblesFS embed.FS

// Role constants shared with the council relay and prompt builder.
const (
	RoleLead         = "lead"
	RoleFollower     = "follower"
	RoleSalonSpeaker = "salon_speaker"
)

// roleToFile maps a council role to its embedded persona markdown file.
var roleToFile = map[string]string{
	RoleLead:         "lead.md",
	RoleFollower:     "follower.md",
	RoleSalonSpeaker: "salon-speaker.md",
}

// Persona is the parsed persona card for one council role.
type Persona struct {
	Name             string
	Role             string
	Personality      string
	LanguageStyle    string
	ForbiddenPhrases []string
	// Body is the markdown body below the frontmatter (我是谁 / 我怎么说话 /
	// 我什么时候出场).
	Body string
}

// Load reads and parses the persona card for role. It returns a nil persona
// and a descriptive error when the role is unknown or the embedded file is
// malformed — callers should treat any error as "no persona for this role".
func Load(role string) (*Persona, error) {
	filename, ok := roleToFile[role]
	if !ok {
		return nil, fmt.Errorf("personabible: unknown role %q", role)
	}
	data, err := biblesFS.ReadFile("bibles/" + filename)
	if err != nil {
		return nil, fmt.Errorf("personabible: read %s: %w", filename, err)
	}
	fm, body, err := parseFrontmatter(string(data))
	if err != nil {
		return nil, fmt.Errorf("personabible: parse %s: %w", filename, err)
	}
	p := &Persona{
		Name:             stringVal(fm["name"]),
		Role:             stringVal(fm["role"]),
		Personality:      stringVal(fm["personality"]),
		LanguageStyle:    stringVal(fm["language_style"]),
		ForbiddenPhrases: stringListVal(fm["forbidden_phrases"]),
		Body:             strings.TrimSpace(body),
	}
	if p.Name == "" {
		return nil, fmt.Errorf("personabible: %s missing frontmatter name", filename)
	}
	return p, nil
}

// writingTaboos is the hard-coded writing-taboo safety net injected on every
// persona-bearing prompt. It is deliberately independent of the markdown
// files so a malformed persona card can never remove the writing guardrails.
// Rule 7 (heading-level style) is intentionally out of scope for this layer.
var writingTaboos = []string{
	"1. 不要用「不是 A，而是 B」句式，直接说 B。",
	"2. 不要用破折号「——」。",
	"3. 不要用强调引号「『…』」，除非是在引用别人的话。",
	"4. 不要用「这句话背后 / 这件事背后」这类元叙事句式。",
	"5. 不要堆叠语气词（真的 / 其实 / 确实 连续出现两次以上）。",
	"6. 不要用「破防了 / 刺穿了 / 泪目了」这类网文情绪词。",
	"7. 标题级写作规范不在本层约束。",
}

// Inject prepends persona's identity, role guidance, and the writing-taboo
// safety net to prompt. A nil persona is a no-op that returns prompt
// unchanged — callers that failed to Load must not silently drop the prompt.
func Inject(persona *Persona, prompt string) string {
	if persona == nil {
		return prompt
	}
	var b strings.Builder
	b.WriteString("你是 ")
	b.WriteString(persona.Name)
	b.WriteString("。\n\n")
	if persona.Role != "" {
		b.WriteString("角色：")
		b.WriteString(persona.Role)
		b.WriteString("\n")
	}
	if persona.Personality != "" {
		b.WriteString("人格：")
		b.WriteString(persona.Personality)
		b.WriteString("\n")
	}
	if persona.LanguageStyle != "" {
		b.WriteString("语言风格：")
		b.WriteString(persona.LanguageStyle)
		b.WriteString("\n")
	}
	if persona.Body != "" {
		b.WriteString("\n")
		b.WriteString(persona.Body)
		b.WriteString("\n")
	}
	b.WriteString("\n写作禁忌（安全网，必须遵守）：\n")
	for _, t := range writingTaboos {
		b.WriteString(t)
		b.WriteString("\n")
	}
	b.WriteString("\n")
	b.WriteString(prompt)
	return b.String()
}

// parseFrontmatter splits a markdown file into its YAML frontmatter block and
// body. A minimal hand-rolled parser keeps this package free of a yaml
// dependency: it supports `key: value` scalars and `key:` blocks followed by
// `- item` list lines.
func parseFrontmatter(data string) (map[string]any, string, error) {
	const delim = "---"
	rest := data
	if !strings.HasPrefix(rest, delim) {
		return nil, "", fmt.Errorf("missing opening %s delimiter", delim)
	}
	rest = rest[len(delim):]
	end := strings.Index(rest, "\n"+delim)
	if end < 0 {
		return nil, "", fmt.Errorf("missing closing %s delimiter", delim)
	}
	fmText := rest[:end]
	body := rest[end+len("\n"+delim):]
	body = strings.TrimPrefix(body, "\n")

	fm := make(map[string]any)
	var lastListKey string
	for _, rawLine := range strings.Split(fmText, "\n") {
		line := strings.TrimRight(rawLine, "\r")
		trimmed := strings.TrimSpace(line)
		if trimmed == "" {
			continue
		}
		if strings.HasPrefix(trimmed, "- ") {
			if lastListKey == "" {
				return nil, "", fmt.Errorf("list item %q outside any key", trimmed)
			}
			items, _ := fm[lastListKey].([]string)
			fm[lastListKey] = append(items, strings.TrimSpace(strings.TrimPrefix(trimmed, "- ")))
			continue
		}
		colon := strings.Index(line, ":")
		if colon <= 0 {
			return nil, "", fmt.Errorf("unparseable frontmatter line %q", line)
		}
		key := strings.TrimSpace(line[:colon])
		value := strings.TrimSpace(line[colon+1:])
		fm[key] = value
		if value == "" {
			lastListKey = key
		} else {
			lastListKey = ""
		}
	}
	return fm, body, nil
}

func stringVal(v any) string {
	if v == nil {
		return ""
	}
	if s, ok := v.(string); ok {
		return s
	}
	return ""
}

func stringListVal(v any) []string {
	if v == nil {
		return nil
	}
	if l, ok := v.([]string); ok {
		return l
	}
	return nil
}
