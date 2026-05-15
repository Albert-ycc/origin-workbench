package handler

import (
	"context"

	"github.com/jackc/pgx/v5/pgtype"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

func addIssueSourcePayload(payload map[string]any, issue db.Issue) map[string]any {
	if issue.SourceTeamMessageID.Valid {
		payload["source_team_message_id"] = uuidToString(issue.SourceTeamMessageID)
	}
	if issue.SourceTeamSessionID.Valid {
		payload["source_team_session_id"] = uuidToString(issue.SourceTeamSessionID)
	}
	return payload
}

func (h *Handler) issueSourcePayload(ctx context.Context, issueID, workspaceID pgtype.UUID) map[string]any {
	payload := map[string]any{}
	issue, err := h.Queries.GetIssueInWorkspace(ctx, db.GetIssueInWorkspaceParams{
		ID:          issueID,
		WorkspaceID: workspaceID,
	})
	if err != nil {
		return payload
	}
	return addIssueSourcePayload(payload, issue)
}
