package daemon

import (
	"strings"
	"testing"
)

func TestBuildPromptProjectCompactionRequiresStrictJSON(t *testing.T) {
	prompt := BuildPrompt(Task{
		ProjectCompaction: &ProjectCompactionData{
			ProjectID:     "project-1",
			ProjectTitle:  "Origin",
			ChatSessionID: "chat-1",
			MessageCount:  1,
			Messages: []ProjectCompactionMessage{{
				ID:        "msg-1",
				Role:      "assistant",
				Speaker:   "Captain",
				Content:   "Decision: ship the async compaction preview.",
				CreatedAt: "2026-05-06T00:00:00Z",
			}},
		},
	})

	for _, want := range []string{
		"Output strict JSON only",
		"pinned_message_ids",
		"id=msg-1",
	} {
		if !strings.Contains(prompt, want) {
			t.Fatalf("prompt missing %q\n%s", want, prompt)
		}
	}
	if strings.Contains(prompt, "multica issue get") {
		t.Fatalf("compaction prompt must not ask for issue workflow\n%s", prompt)
	}
}

func TestBuildPromptCouncilBroadcastReplaceTeamCaptainPath(t *testing.T) {
	prompt := BuildPrompt(Task{
		ChatSessionID: "chat-1",
		ChatMessage:   "你们现在用的都是什么模型?",
		// TeamID set on purpose to make sure CouncilBroadcast wins over the
		// team captain branch even when a council borrows a team session.
		TeamID:             "team-1",
		TeamName:           "Origin Captains",
		TeamCaptainAgentID: "agent-pm",
		Agent: &AgentData{
			ID:   "agent-pm",
			Name: "产品经理",
		},
		CouncilBroadcast: &CouncilBroadcastData{
			Type:             "council_broadcast",
			CouncilSessionID: "council-1",
			CouncilTopic:     "私域一体化",
			ChatSessionID:    "chat-1",
			BroadcasterKind:  "user",
			BroadcasterName:  "用户",
			UserMessage:      "你们现在用的都是什么模型?",
			SelfAgentID:      "agent-pm",
			SelfAgentName:    "产品经理",
			Participants: []CouncilBroadcastMemberData{
				{AgentID: "agent-pm", Name: "产品经理", Role: "convener"},
				{AgentID: "agent-qa", Name: "测试工程师", Role: "member"},
				{AgentID: "agent-be", Name: "后端开发工程师", Role: "member"},
			},
		},
	})

	for _, want := range []string{
		"Council Session as one member",
		"Council topic: 私域一体化",
		"You are: 产品经理",
		"Room roster (everyone is receiving this same broadcast in parallel)",
		"- 产品经理 (convener)",
		"- 测试工程师 (member)",
		"- 后端开发工程师 (member)",
		"用户 addressed the whole room with @全体.",
		"Broadcast reply rules — STRICT",
		"ONE short paragraph",
		"NEVER narrate your reasoning",
		"Do NOT @mention or delegate",
		"User broadcast:\n你们现在用的都是什么模型?",
	} {
		if !strings.Contains(prompt, want) {
			t.Fatalf("broadcast prompt missing %q\n----- prompt -----\n%s", want, prompt)
		}
	}

	for _, banned := range []string{
		// Team captain delegation prompt must NOT leak into the broadcast
		// branch — that's the bug we just fixed.
		"Delegation = `@成员名 具体指令`",
		"You (as captain) need other members to do work",
		"Each mention from a new line gets its own task card",
	} {
		if strings.Contains(prompt, banned) {
			t.Fatalf("broadcast prompt must not include captain instructions, found %q\n----- prompt -----\n%s", banned, prompt)
		}
	}
}

func TestBuildPromptChatIncludesRequestedSkills(t *testing.T) {
	prompt := BuildPrompt(Task{
		ChatSessionID:   "chat-1",
		ChatMessage:     "帮我整理成 PRD",
		RequestedSkills: []string{"prd-writer", "lark-doc"},
	})

	for _, want := range []string{
		"Requested skills for this turn",
		"prd-writer",
		"lark-doc",
		"User message:\n帮我整理成 PRD",
	} {
		if !strings.Contains(prompt, want) {
			t.Fatalf("prompt missing %q\n%s", want, prompt)
		}
	}
}
