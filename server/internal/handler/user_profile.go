package handler

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

// =====================
// UserProfile (Origin §14.10): the user's identity card and communication
// preferences for the *current* workspace. Acts as the closest layer in the
// three-layer system prompt that PRD §15.4 prescribes for any LLM call:
//
//     UserProfile.style_notes  ← layer 1 (this handler's payload)
//     Agent.long_context        ← layer 2
//     Mission.bound_contexts    ← layer 3
//
// In Origin's single-user single-workspace mode there is exactly one row per
// (workspace, user). The endpoint is idempotent upsert — empty strings are a
// valid value (means "no preference yet").
// =====================

type UserProfileResponse struct {
	ID                    string `json:"id"`
	WorkspaceID           string `json:"workspace_id"`
	UserID                string `json:"user_id"`
	RoleCard              string `json:"role_card"`
	CommunicationStyle    string `json:"communication_style"`
	Presence              string `json:"presence"`
	PreferencesSourcePath string `json:"preferences_source_path"`
	CreatedAt             string `json:"created_at"`
	UpdatedAt             string `json:"updated_at"`
}

type UpsertUserProfileRequest struct {
	RoleCard              string `json:"role_card"`
	CommunicationStyle    string `json:"communication_style"`
	Presence              string `json:"presence"`
	PreferencesSourcePath string `json:"preferences_source_path"`
}

func userProfileToResponse(p db.UserProfile) UserProfileResponse {
	return UserProfileResponse{
		ID:                    uuidToString(p.ID),
		WorkspaceID:           uuidToString(p.WorkspaceID),
		UserID:                uuidToString(p.UserID),
		RoleCard:              p.RoleCard,
		CommunicationStyle:    p.CommunicationStyle,
		Presence:              p.Presence,
		PreferencesSourcePath: p.PreferencesSourcePath,
		CreatedAt:             timestampToString(p.CreatedAt),
		UpdatedAt:             timestampToString(p.UpdatedAt),
	}
}

func normalizePresence(raw string) string {
	switch strings.TrimSpace(raw) {
	case "offline", "dnd":
		return raw
	default:
		return "online"
	}
}

// emptyUserProfileResponse returns a zero-valued profile shape so the frontend
// can render the form on first load (before the user has saved anything) using
// the same component as for an existing profile. The id is empty string —
// frontend treats empty id as "not yet persisted, fields are server defaults".
func emptyUserProfileResponse(workspaceID, userID string) UserProfileResponse {
	return UserProfileResponse{
		ID:                    "",
		WorkspaceID:           workspaceID,
		UserID:                userID,
		RoleCard:              "",
		CommunicationStyle:    "",
		Presence:              "online",
		PreferencesSourcePath: "",
		CreatedAt:             "",
		UpdatedAt:             "",
	}
}

func (h *Handler) GetUserProfile(w http.ResponseWriter, r *http.Request) {
	workspaceID := h.resolveWorkspaceID(r)
	wsUUID, ok := parseUUIDOrBadRequest(w, workspaceID, "workspace id")
	if !ok {
		return
	}
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}
	userUUID, ok := parseUUIDOrBadRequest(w, userID, "user id")
	if !ok {
		return
	}

	profile, err := h.Queries.GetUserProfile(r.Context(), db.GetUserProfileParams{
		WorkspaceID: wsUUID,
		UserID:      userUUID,
	})
	if err != nil {
		if isNotFound(err) {
			writeJSON(w, http.StatusOK, emptyUserProfileResponse(workspaceID, userID))
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to get user profile")
		return
	}
	writeJSON(w, http.StatusOK, userProfileToResponse(profile))
}

func (h *Handler) UpsertUserProfile(w http.ResponseWriter, r *http.Request) {
	var req UpsertUserProfileRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil && !errors.Is(err, http.ErrBodyReadAfterClose) {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	workspaceID := h.resolveWorkspaceID(r)
	wsUUID, ok := parseUUIDOrBadRequest(w, workspaceID, "workspace id")
	if !ok {
		return
	}
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}
	userUUID, ok := parseUUIDOrBadRequest(w, userID, "user id")
	if !ok {
		return
	}

	if utf8RuneCount(req.RoleCard) > 200 {
		writeError(w, http.StatusBadRequest, "role_card too long (max 200 chars)")
		return
	}
	if utf8RuneCount(req.CommunicationStyle) > 2000 {
		writeError(w, http.StatusBadRequest, "communication_style too long (max 2000 chars)")
		return
	}
	if utf8RuneCount(req.PreferencesSourcePath) > 500 {
		writeError(w, http.StatusBadRequest, "preferences_source_path too long (max 500 chars)")
		return
	}

	profile, err := h.Queries.UpsertUserProfile(r.Context(), db.UpsertUserProfileParams{
		WorkspaceID:           wsUUID,
		UserID:                userUUID,
		RoleCard:              strings.TrimSpace(req.RoleCard),
		CommunicationStyle:    strings.TrimRight(req.CommunicationStyle, " \n\t"),
		Presence:              normalizePresence(req.Presence),
		PreferencesSourcePath: strings.TrimSpace(req.PreferencesSourcePath),
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to save user profile")
		return
	}
	writeJSON(w, http.StatusOK, userProfileToResponse(profile))
}
