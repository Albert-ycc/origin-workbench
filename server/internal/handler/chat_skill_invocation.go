package handler

import (
	"net/http"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/multica-ai/multica/server/internal/service"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

func (h *Handler) buildChatSkillContextOrBadRequest(
	w http.ResponseWriter,
	r *http.Request,
	workspaceID pgtype.UUID,
	rawSkillIDs []string,
) ([]byte, bool) {
	contextJSON, hasSkills := service.BuildChatSkillInvocationContext(rawSkillIDs)
	if !hasSkills {
		return nil, true
	}
	ctx, _ := service.ParseChatSkillInvocationContext(contextJSON)
	for _, rawID := range ctx.SkillIDs {
		skillID, ok := parseUUIDOrBadRequest(w, rawID, "skill_ids")
		if !ok {
			return nil, false
		}
		if _, err := h.Queries.GetSkillInWorkspace(r.Context(), db.GetSkillInWorkspaceParams{
			ID:          skillID,
			WorkspaceID: workspaceID,
		}); err != nil {
			writeError(w, http.StatusBadRequest, "skill not found")
			return nil, false
		}
	}
	return contextJSON, true
}
