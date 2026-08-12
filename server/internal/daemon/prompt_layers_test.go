package daemon

import (
	"strings"
	"testing"
)

// TestPromptLayersBuildSkipsEmptyLayers verifies Build concatenates non-empty
// layers in order with blank-line separators and skips empty ones.
func TestPromptLayersBuildSkipsEmptyLayers(t *testing.T) {
	layers := PromptLayers{
		OperatorPreferences: "OP",
		Persona:             "",
		RoleInstructions:    "ROLE",
		TaskContext:         "CTX",
		TurnTail:            "TAIL",
	}
	got := layers.Build()
	want := "OP\n\nROLE\n\nCTX\n\nTAIL\n"
	if got != want {
		t.Fatalf("Build() mismatch\n got: %q\nwant: %q", got, want)
	}
}

// TestPromptLayersBuildAllEmpty verifies an all-empty layers struct builds to
// the empty string.
func TestPromptLayersBuildAllEmpty(t *testing.T) {
	if got := (PromptLayers{}).Build(); got != "" {
		t.Fatalf("empty layers should build to \"\", got %q", got)
	}
}

// TestPromptLayersBuildTrimsLayers verifies each layer is trimmed before
// joining, so stray indentation from callers cannot corrupt the structure.
func TestPromptLayersBuildTrimsLayers(t *testing.T) {
	layers := PromptLayers{
		OperatorPreferences: "  OP  \n",
		RoleInstructions:    "\nROLE\n",
	}
	got := layers.Build()
	want := "OP\n\nROLE\n"
	if got != want {
		t.Fatalf("Build() must trim layers\n got: %q\nwant: %q", got, want)
	}
}

// TestBuildCouncilBroadcastPromptFiveLayers verifies the assembled council
// prompt keeps all five layers in order: operator prefs, persona (with room
// override), role shape, task context, turn tail.
func TestBuildCouncilBroadcastPromptFiveLayers(t *testing.T) {
	prompt := BuildPrompt(Task{
		ChatSessionID:   "chat-1",
		ChatMessage:     "你们现在用的都是什么模型?",
		RequestedSkills: []string{"prd-writer"},
		OperatorPreferences: &OperatorPreferences{
			RoleCard:           "产品经理",
			CommunicationStyle: "简洁，先结论后展开",
		},
		Agent: &AgentData{ID: "agent-pm", Name: "产品经理"},
		CouncilBroadcast: &CouncilBroadcastData{
			Type:             "council_broadcast",
			CouncilSessionID: "team-1",
			CouncilTopic:     "私域一体化",
			ChatSessionID:    "chat-1",
			BroadcasterKind:  "user",
			BroadcasterName:  "用户",
			UserMessage:      "你们现在用的都是什么模型?",
			SelfAgentID:      "agent-pm",
			SelfAgentName:    "产品经理",
			Role:             "lead",
			SourceKind:       "team",
			Participants: []CouncilBroadcastMemberData{
				{AgentID: "agent-pm", Name: "产品经理", Role: "captain"},
				{AgentID: "agent-qa", Name: "测试工程师", Role: "member"},
			},
			PersonaOverride: map[string]any{
				"话痨":   "稍微克制一点",
				"口头禅": "差不多得了",
			},
		},
	})

	for _, want := range []string{
		// L1 operator prefs injected via prependOperatorPreferences
		"[Operator preferences — read first, override defaults]",
		"Communication style:",
		"简洁，先结论后展开",
		// L2 persona — personabible lead card with the real name substituted
		"你是 产品经理。",
		"写作禁忌（安全网，必须遵守）",
		"不要用「不是 A，而是 B」句式",
		// L2 room persona override as the highest-priority layer
		"房间人格覆盖（本房间管理员设定，优先级高于上面的人设）",
		"- 口头禅: 差不多得了",
		"- 话痨: 稍微克制一点",
		// L3 role shape
		"You are the team LEAD",
		// L4 task context
		"Council topic: 私域一体化",
		"- 产品经理 (captain)  ← you",
		"用户 addressed the whole room with @全体",
		// L5 turn tail
		"Requested skills for this turn",
		"- prd-writer",
	} {
		if !strings.Contains(prompt, want) {
			t.Fatalf("prompt missing %q\n----- prompt -----\n%s", want, prompt)
		}
	}

	// Layer order: operator prefs must precede the persona, which precedes the
	// role shape, which precedes the task context, which precedes the tail.
	order := []string{
		"[Operator preferences",
		"你是 产品经理。",
		"房间人格覆盖",
		"You are the team LEAD",
		"Council topic: 私域一体化",
		"Requested skills for this turn",
	}
	last := -1
	for _, s := range order {
		idx := strings.Index(prompt, s)
		if idx < 0 {
			t.Fatalf("prompt missing layer marker %q", s)
		}
		if idx <= last {
			t.Fatalf("layer marker %q out of order (idx %d <= prev %d)", s, idx, last)
		}
		last = idx
	}
}

// TestBuildCouncilPersonaPromptNameReplacement verifies the personabible
// default name is replaced with the agent's real display name.
func TestBuildCouncilPersonaPromptNameReplacement(t *testing.T) {
	prompt := buildCouncilPersonaPrompt(&CouncilBroadcastData{
		Role:          "lead",
		SelfAgentID:   "agent-pm",
		SelfAgentName: "产品经理",
	}, Task{})
	if !strings.Contains(prompt, "你是 产品经理。") {
		t.Fatalf("persona prompt must use the real agent name\n%s", prompt)
	}
	if strings.Contains(prompt, "林知遥") {
		t.Fatalf("persona prompt must not contain the personabible default name\n%s", prompt)
	}
}

// TestBuildCouncilPersonaPromptFallsBackToTaskAgent verifies the name falls
// back to task.Agent.Name when SelfAgentName is empty.
func TestBuildCouncilPersonaPromptFallsBackToTaskAgent(t *testing.T) {
	prompt := buildCouncilPersonaPrompt(&CouncilBroadcastData{
		Role: "follower",
	}, Task{Agent: &AgentData{Name: "测试工程师"}})
	if !strings.Contains(prompt, "你是 测试工程师。") {
		t.Fatalf("persona prompt must fall back to task.Agent.Name\n%s", prompt)
	}
}

// TestBuildCouncilPersonaPromptUnknownRoleNoPanic verifies a role with no
// personabible card degrades to the override block instead of an empty string.
func TestBuildCouncilPersonaPromptUnknownRoleNoPanic(t *testing.T) {
	prompt := buildCouncilPersonaPrompt(&CouncilBroadcastData{
		Role: "captain",
	}, Task{})
	if strings.Contains(prompt, "写作禁忌") {
		t.Fatalf("unknown role must not inject a persona card\n%s", prompt)
	}
}

// TestFormatPersonaOverrideStableOrder verifies override keys are rendered in
// sorted order so the injected bytes are stable across turns.
func TestFormatPersonaOverrideStableOrder(t *testing.T) {
	override := map[string]any{
		"beta":  "B",
		"alpha": "A",
		"gamma": "G",
	}
	got := formatPersonaOverride(override)
	want := "- alpha: A\n- beta: B\n- gamma: G\n"
	if got != want {
		t.Fatalf("formatPersonaOverride mismatch\n got: %q\nwant: %q", got, want)
	}
}

// TestFormatPersonaOverrideNonStringValues verifies non-string values are JSON
// serialized and empty strings are skipped.
func TestFormatPersonaOverrideNonStringValues(t *testing.T) {
	override := map[string]any{
		"话痨":   "",
		"回合数": int64(3),
		"开灯":   true,
	}
	got := formatPersonaOverride(override)
	if strings.Contains(got, "话痨") {
		t.Fatalf("empty-string override key must be skipped\n%s", got)
	}
	for _, want := range []string{"- 回合数: 3\n", "- 开灯: true\n"} {
		if !strings.Contains(got, want) {
			t.Fatalf("override output missing %q\n%s", want, got)
		}
	}
}

// TestFormatPersonaOverrideEmpty verifies nil / empty maps render as "".
func TestFormatPersonaOverrideEmpty(t *testing.T) {
	if got := formatPersonaOverride(nil); got != "" {
		t.Fatalf("nil override should render empty, got %q", got)
	}
	if got := formatPersonaOverride(map[string]any{}); got != "" {
		t.Fatalf("empty override should render empty, got %q", got)
	}
}

// TestBuildCouncilRoleInstructionsByRole verifies each role gets its own
// shape and unknown roles fall back to the defensive self-introduction.
func TestBuildCouncilRoleInstructionsByRole(t *testing.T) {
	cases := []struct {
		role string
		want string
	}{
		{"lead", "You are the team LEAD"},
		{"follower", "PICK UP THE RELAY"},
		{"salon_speaker", "salon (chillout) mode"},
		{"captain", "Self-introduce briefly"},
	}
	for _, c := range cases {
		got := buildCouncilRoleInstructions(&CouncilBroadcastData{Role: c.role})
		if !strings.Contains(got, c.want) {
			t.Fatalf("role %q instructions missing %q\n%s", c.role, c.want, got)
		}
	}
}

// TestBuildCouncilRoleInstructionsLeadBansFollowerShape verifies the lead's
// bans exclude the follower's self-introduction bullet shape.
func TestBuildCouncilRoleInstructionsLeadBansFollowerShape(t *testing.T) {
	got := buildCouncilRoleInstructions(&CouncilBroadcastData{Role: "lead"})
	for _, banned := range []string{
		"List 3–5 bullet points",
		"Reference the OTHER teammates' scope",
	} {
		if strings.Contains(got, banned) {
			t.Fatalf("lead instructions must not include %q\n%s", banned, got)
		}
	}
}

// TestBuildCouncilTaskContextSalonTurnState verifies salon turn counting is
// rendered when present and absent.
func TestBuildCouncilTaskContextSalonTurnState(t *testing.T) {
	withTurn := buildCouncilTaskContext(&CouncilBroadcastData{
		Role:             "salon_speaker",
		UserMessage:      "现在谁先来接话？",
		BroadcasterName:  "用户",
		SelfAgentName:    "产品经理",
		TurnIndex:        2,
		MaxTurns:         4,
		PriorSpeakerName: "医学经理",
		Transcript: []CouncilSalonTurnData{
			{Speaker: "医学经理", Content: "我来接第一棒。"},
		},
	}, Task{})
	for _, want := range []string{
		"This is turn 2 of 4 in this salon",
		"Pick up naturally from where the room is",
		"Prior speaker was: 医学经理",
		"[医学经理] 我来接第一棒。",
	} {
		if !strings.Contains(withTurn, want) {
			t.Fatalf("salon turn context missing %q\n%s", want, withTurn)
		}
	}

	// No TurnIndex → fall back to maxTurns 8, no transcript block.
	noTurn := buildCouncilTaskContext(&CouncilBroadcastData{
		Role:            "salon_speaker",
		UserMessage:     "现在谁先来接话？",
		BroadcasterName: "用户",
	}, Task{})
	if !strings.Contains(noTurn, "This is turn 0 of 8 in this salon") {
		t.Fatalf("salon context must default turn counting\n%s", noTurn)
	}
}
