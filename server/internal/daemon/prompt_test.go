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

func TestBuildPromptCouncilBroadcastLeadOpensTheRoomDoesNotAnswer(t *testing.T) {
	prompt := BuildPrompt(Task{
		ChatSessionID:      "chat-1",
		ChatMessage:        "你们现在用的都是什么模型?",
		TeamID:             "team-1",
		TeamName:           "Origin Captains",
		TeamCaptainAgentID: "agent-pm",
		Agent:              &AgentData{ID: "agent-pm", Name: "产品经理"},
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
				{AgentID: "agent-be", Name: "后端开发工程师", Role: "member"},
			},
		},
	})

	for _, want := range []string{
		"serial relay (NOT a parallel fan-out)",
		"Council topic: 私域一体化",
		"You are: 产品经理",
		"- 产品经理 (captain)  ← you",
		"- 测试工程师 (member)",
		"用户 addressed the whole room with @全体",
		"You are the team LEAD",
		"OPEN THE ROOM as chairperson — NOT to answer",
		"Name every teammate that is standing by",
		"Do NOT answer the user's actual question",
		"chairperson's opening, not an essay",
	} {
		if !strings.Contains(prompt, want) {
			t.Fatalf("lead broadcast prompt missing %q\n----- prompt -----\n%s", want, prompt)
		}
	}

	for _, banned := range []string{
		"Delegation = `@成员名 具体指令`",
		"You (as captain) need other members to do work",
		// Lead must not get the follower's "list 3-5 bullet points" shape.
		"List 3–5 bullet points of concrete things YOU can do",
		"Reference the OTHER teammates' scope",
	} {
		if strings.Contains(prompt, banned) {
			t.Fatalf("lead broadcast prompt must not include %q\n----- prompt -----\n%s", banned, prompt)
		}
	}
}

func TestBuildPromptCouncilBroadcastFollowerSelfIntroducesAndReferences(t *testing.T) {
	prompt := BuildPrompt(Task{
		ChatSessionID: "chat-1",
		ChatMessage:   "你们现在用的都是什么模型?",
		Agent:         &AgentData{ID: "agent-qa", Name: "测试工程师"},
		CouncilBroadcast: &CouncilBroadcastData{
			Type:             "council_broadcast",
			CouncilSessionID: "team-1",
			CouncilTopic:     "私域一体化",
			ChatSessionID:    "chat-1",
			BroadcasterKind:  "user",
			BroadcasterName:  "用户",
			UserMessage:      "你们现在用的都是什么模型?",
			SelfAgentID:      "agent-qa",
			SelfAgentName:    "测试工程师",
			Role:             "follower",
			SourceKind:       "team",
			PriorSpeakerName: "产品经理",
			Participants: []CouncilBroadcastMemberData{
				{AgentID: "agent-pm", Name: "产品经理", Role: "captain"},
				{AgentID: "agent-qa", Name: "测试工程师", Role: "member"},
				{AgentID: "agent-be", Name: "后端开发工程师", Role: "member"},
			},
		},
	})

	for _, want := range []string{
		"serial relay (NOT a parallel fan-out)",
		"You are: 测试工程师",
		"- 测试工程师 (member)  ← you",
		"产品经理 just opened the room",
		"PICK UP THE RELAY",
		"State your own role identity",
		"Reference the OTHER teammates' scope",
		"List 3–5 bullet points",
		"End with one open question",
		"Do NOT repeat the lead's opening",
	} {
		if !strings.Contains(prompt, want) {
			t.Fatalf("follower broadcast prompt missing %q\n----- prompt -----\n%s", want, prompt)
		}
	}

	for _, banned := range []string{
		"You are the team LEAD",
		"OPEN THE ROOM as chairperson",
		// Follower must not get the lead's "do not answer the question" ban.
		"Do NOT answer the user's actual question",
	} {
		if strings.Contains(prompt, banned) {
			t.Fatalf("follower broadcast prompt must not include lead-only text %q\n----- prompt -----\n%s", banned, prompt)
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
