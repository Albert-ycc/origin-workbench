package service

import (
	"encoding/json"
	"testing"
)

func TestCouncilBroadcastContextJSONRoundTrip(t *testing.T) {
	want := CouncilBroadcastContext{
		Type:             CouncilBroadcastContextType,
		CouncilSessionID: "council-1",
		CouncilTopic:     "私域一体化",
		ChatSessionID:    "chat-1",
		BroadcasterKind:  "user",
		BroadcasterName:  "用户",
		UserMessage:      "你们现在用的都是什么模型?",
		SelfAgentID:      "agent-pm",
		SelfAgentName:    "产品经理",
		Participants: []CouncilBroadcastMemberInfo{
			{AgentID: "agent-pm", Name: "产品经理", Role: "convener"},
			{AgentID: "agent-qa", Name: "测试工程师", Role: "member"},
		},
	}

	raw, err := json.Marshal(want)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}

	var got CouncilBroadcastContext
	if err := json.Unmarshal(raw, &got); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}

	if got.Type != CouncilBroadcastContextType {
		t.Fatalf("Type = %q, want %q", got.Type, CouncilBroadcastContextType)
	}
	if got.CouncilSessionID != want.CouncilSessionID {
		t.Fatalf("CouncilSessionID = %q, want %q", got.CouncilSessionID, want.CouncilSessionID)
	}
	if got.UserMessage != want.UserMessage {
		t.Fatalf("UserMessage = %q, want %q", got.UserMessage, want.UserMessage)
	}
	if len(got.Participants) != 2 {
		t.Fatalf("Participants len = %d, want 2", len(got.Participants))
	}
	if got.Participants[0].Role != "convener" || got.Participants[1].Role != "member" {
		t.Fatalf("Participants roles wrong: %+v", got.Participants)
	}
}

func TestCouncilBroadcastContextDistinctFromTeamDelegation(t *testing.T) {
	// Round-trip both types and ensure the daemon-side Unmarshal cannot
	// confuse the two by Type marker. This protects daemon.go's two-step
	// unmarshal pattern from accidentally matching the wrong context kind.
	broadcastRaw, _ := json.Marshal(CouncilBroadcastContext{Type: CouncilBroadcastContextType})
	delegationRaw, _ := json.Marshal(TeamDelegationContext{Type: TeamDelegationContextType})

	var asBroadcast CouncilBroadcastContext
	if err := json.Unmarshal(delegationRaw, &asBroadcast); err != nil {
		t.Fatalf("unmarshal delegation as broadcast: %v", err)
	}
	if asBroadcast.Type == CouncilBroadcastContextType {
		t.Fatalf("delegation payload should not deserialize with broadcast type marker")
	}

	var asDelegation TeamDelegationContext
	if err := json.Unmarshal(broadcastRaw, &asDelegation); err != nil {
		t.Fatalf("unmarshal broadcast as delegation: %v", err)
	}
	if asDelegation.Type == TeamDelegationContextType {
		t.Fatalf("broadcast payload should not deserialize with delegation type marker")
	}
}
