package service

import (
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

func TestTeamMessageEventPayloadForSessionIncludesProjectID(t *testing.T) {
	teamID := testUUID(1)
	projectID := testUUID(2)
	chatSessionID := testUUID(3)
	messageID := testUUID(4)
	senderID := testUUID(5)
	createdAt := pgtype.Timestamptz{Time: time.Unix(1_700_000_000, 0).UTC(), Valid: true}

	payload := teamMessageEventPayloadForSession(
		db.ChatSession{
			ID:        chatSessionID,
			TeamID:    teamID,
			ProjectID: projectID,
		},
		teamID,
		&db.ChatMessage{
			ID:            messageID,
			ChatSessionID: chatSessionID,
			Role:          "assistant",
			Content:       "done",
			SenderAgentID: senderID,
			CreatedAt:     createdAt,
		},
	)

	if got, want := payload["team_id"], "01000000-0000-0000-0000-000000000000"; got != want {
		t.Fatalf("team_id = %v, want %s", got, want)
	}
	if got, want := payload["project_id"], "02000000-0000-0000-0000-000000000000"; got != want {
		t.Fatalf("project_id = %v, want %s", got, want)
	}
	message, ok := payload["message"].(map[string]any)
	if !ok {
		t.Fatalf("message payload missing or wrong type: %#v", payload["message"])
	}
	if got, want := message["chat_session_id"], "03000000-0000-0000-0000-000000000000"; got != want {
		t.Fatalf("message.chat_session_id = %v, want %s", got, want)
	}
	if got, want := message["id"], "04000000-0000-0000-0000-000000000000"; got != want {
		t.Fatalf("message.id = %v, want %s", got, want)
	}
	sender, ok := message["sender_agent_id"].(*string)
	if !ok || sender == nil {
		t.Fatalf("message.sender_agent_id missing or wrong type: %#v", message["sender_agent_id"])
	}
	if got, want := *sender, "05000000-0000-0000-0000-000000000000"; got != want {
		t.Fatalf("message.sender_agent_id = %v, want %s", got, want)
	}
}
