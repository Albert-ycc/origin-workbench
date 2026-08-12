package handler

import (
	"encoding/base64"
	"encoding/json"
	"log/slog"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/multica-ai/multica/server/internal/service"
	"github.com/multica-ai/multica/server/internal/util"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
	"github.com/multica-ai/multica/server/pkg/protocol"
)

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------

type RoomResponse struct {
	ID           string  `json:"id"`
	WorkspaceID  string  `json:"workspace_id"`
	Name         string  `json:"name"`
	Description  string  `json:"description"`
	Theme        string  `json:"theme"`
	CreatedAt    string  `json:"created_at"`
	UpdatedAt    string  `json:"updated_at"`
	ArchivedAt   *string `json:"archived_at"`
	LastActiveAt string  `json:"last_active_at"`
}

type ListRoomsResponse struct {
	Rooms []RoomResponse `json:"rooms"`
	Total int            `json:"total"`
}

type RoomMemberResponse struct {
	ID         string  `json:"id"`
	RoomID     string  `json:"room_id"`
	MemberType string  `json:"member_type"`
	MemberID   string  `json:"member_id"`
	AgentID    string  `json:"agent_id,omitempty"`
	Role       string  `json:"role"`
	JoinedAt   string  `json:"joined_at"`
	LeftAt     *string `json:"left_at"`
}

type ListRoomMembersResponse struct {
	Members []RoomMemberResponse `json:"members"`
}

type RoomMessageResponse struct {
	ID               string   `json:"id"`
	RoomID           string   `json:"room_id"`
	SenderType       string   `json:"sender_type"`
	SenderID         string   `json:"sender_id"`
	SenderName       string   `json:"sender_name,omitempty"`
	Content          string   `json:"content"`
	ReplyToMessageID *string  `json:"reply_to_message_id"`
	Mentions         []string `json:"mentions"`
	IsAutonomous     bool     `json:"is_autonomous"`
	CreatedAt        string   `json:"created_at"`
}

type ListRoomMessagesResponse struct {
	Messages   []RoomMessageResponse `json:"messages"`
	NextCursor *string               `json:"next_cursor,omitempty"`
}

type roomMessageCursor struct {
	CreatedAt string `json:"created_at"`
	ID        string `json:"id"`
}

type RoomAgentPersonaResponse struct {
	ID              string `json:"id"`
	RoomID          string `json:"room_id"`
	AgentID         string `json:"agent_id"`
	PersonaOverride any    `json:"persona_override"`
	CreatedAt       string `json:"created_at"`
	UpdatedAt       string `json:"updated_at"`
}

// ---------------------------------------------------------------------------
// Request types
// ---------------------------------------------------------------------------

type CreateRoomRequest struct {
	Name        string   `json:"name"`
	Description string   `json:"description"`
	Theme       string   `json:"theme"`
	AgentIDs    []string `json:"agent_ids"`
}

type UpdateRoomRequest struct {
	Name        *string `json:"name"`
	Description *string `json:"description"`
	Theme       *string `json:"theme"`
}

type AddRoomMemberRequest struct {
	MemberType string `json:"member_type"`
	MemberID   string `json:"member_id"`
	AgentID    string `json:"agent_id"`
	Role       string `json:"role"`
}

type SendRoomMessageRequest struct {
	Content          string   `json:"content"`
	ReplyToMessageID *string  `json:"reply_to_message_id"`
	Mentions         []string `json:"mentions"`
	MentionAgentIDs  []string `json:"mention_agent_ids"`
}

type UpsertRoomAgentPersonaRequest struct {
	PersonaOverride map[string]any `json:"persona_override"`
}

// ---------------------------------------------------------------------------
// Handler implements service.RoomEventPublisher
// ---------------------------------------------------------------------------

// PublishRoomMessage 推送 room:message ws 事件给所有 workspace 订阅者。
// 实现 service.RoomEventPublisher 接口，避免 service 层直接依赖 handler 包。
func (h *Handler) PublishRoomMessage(workspaceID string, agentID string, payload protocol.RoomMessagePayload) {
	h.publish(protocol.EventRoomMessage, workspaceID, "agent", agentID, payload)
}

// 编译期检查：Handler 实现了 service.RoomEventPublisher
var _ service.RoomEventPublisher = (*Handler)(nil)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

func roomToResponse(r db.Room) RoomResponse {
	return RoomResponse{
		ID:           uuidToString(r.ID),
		WorkspaceID:  uuidToString(r.WorkspaceID),
		Name:         r.Name,
		Description:  r.Description,
		Theme:        r.Theme,
		CreatedAt:    timestampToString(r.CreatedAt),
		UpdatedAt:    timestampToString(r.UpdatedAt),
		ArchivedAt:   timestampToPtr(r.ArchivedAt),
		LastActiveAt: timestampToString(r.LastActiveAt),
	}
}

func roomMemberToResponse(m db.RoomMember) RoomMemberResponse {
	resp := RoomMemberResponse{
		ID:         uuidToString(m.ID),
		RoomID:     uuidToString(m.RoomID),
		MemberType: m.MemberType,
		MemberID:   uuidToString(m.MemberID),
		Role:       m.Role,
		JoinedAt:   timestampToString(m.JoinedAt),
		LeftAt:     timestampToPtr(m.LeftAt),
	}
	if m.MemberType == "agent" {
		resp.AgentID = resp.MemberID
	}
	return resp
}

func roomMessageToResponse(m db.RoomMessage) RoomMessageResponse {
	mentions := m.Mentions
	if mentions == nil {
		mentions = []string{}
	}
	return RoomMessageResponse{
		ID:               uuidToString(m.ID),
		RoomID:           uuidToString(m.RoomID),
		SenderType:       m.SenderType,
		SenderID:         uuidToString(m.SenderID),
		Content:          m.Content,
		ReplyToMessageID: uuidToPtr(m.ReplyToMessageID),
		Mentions:         mentions,
		IsAutonomous:     m.IsAutonomous,
		CreatedAt:        timestampToString(m.CreatedAt),
	}
}

func encodeRoomMessageCursor(msg db.RoomMessage) string {
	createdAt := timestampToString(msg.CreatedAt)
	if msg.CreatedAt.Valid {
		createdAt = msg.CreatedAt.Time.Format(time.RFC3339Nano)
	}
	raw, _ := json.Marshal(roomMessageCursor{
		CreatedAt: createdAt,
		ID:        uuidToString(msg.ID),
	})
	return base64.RawURLEncoding.EncodeToString(raw)
}

func decodeRoomMessageCursor(raw string) (pgtype.Timestamptz, pgtype.UUID, bool) {
	if raw == "" {
		return pgtype.Timestamptz{}, pgtype.UUID{}, true
	}
	if ts, err := time.Parse(time.RFC3339Nano, raw); err == nil {
		return pgtype.Timestamptz{Time: ts, Valid: true}, pgtype.UUID{}, true
	}
	decoded, err := base64.RawURLEncoding.DecodeString(raw)
	if err != nil {
		return pgtype.Timestamptz{}, pgtype.UUID{}, false
	}
	var cur roomMessageCursor
	if err := json.Unmarshal(decoded, &cur); err != nil {
		return pgtype.Timestamptz{}, pgtype.UUID{}, false
	}
	ts, err := time.Parse(time.RFC3339Nano, cur.CreatedAt)
	if err != nil {
		return pgtype.Timestamptz{}, pgtype.UUID{}, false
	}
	id, err := util.ParseUUID(cur.ID)
	if err != nil {
		return pgtype.Timestamptz{}, pgtype.UUID{}, false
	}
	return pgtype.Timestamptz{Time: ts, Valid: true}, id, true
}

func roomAgentPersonaToResponse(p db.RoomAgentPersona) RoomAgentPersonaResponse {
	var override any
	if err := json.Unmarshal(p.PersonaOverride, &override); err != nil {
		override = map[string]any{}
	}
	return RoomAgentPersonaResponse{
		ID:              uuidToString(p.ID),
		RoomID:          uuidToString(p.RoomID),
		AgentID:         uuidToString(p.AgentID),
		PersonaOverride: override,
		CreatedAt:       timestampToString(p.CreatedAt),
		UpdatedAt:       timestampToString(p.UpdatedAt),
	}
}

// loadRoomForWorkspace 根据 URL /{id} 参数加载 room，校验 workspace 归属。
func (h *Handler) loadRoomForWorkspace(w http.ResponseWriter, r *http.Request, workspaceID string) (db.Room, bool) {
	roomID := chi.URLParam(r, "id")
	roomUUID, ok := parseUUIDOrBadRequest(w, roomID, "room id")
	if !ok {
		return db.Room{}, false
	}
	wsUUID, ok := parseUUIDOrBadRequest(w, workspaceID, "workspace id")
	if !ok {
		return db.Room{}, false
	}
	room, err := h.Queries.GetRoomInWorkspace(r.Context(), db.GetRoomInWorkspaceParams{
		ID:          roomUUID,
		WorkspaceID: wsUUID,
	})
	if err != nil {
		writeError(w, http.StatusNotFound, "room not found")
		return db.Room{}, false
	}
	return room, true
}

// ---------------------------------------------------------------------------
// Room CRUD
// ---------------------------------------------------------------------------

func (h *Handler) ListRooms(w http.ResponseWriter, r *http.Request) {
	_, ok := requireUserID(w, r)
	if !ok {
		return
	}
	workspaceID := h.resolveWorkspaceID(r)
	wsUUID, ok := parseUUIDOrBadRequest(w, workspaceID, "workspace id")
	if !ok {
		return
	}

	rooms, err := h.Queries.ListRooms(r.Context(), wsUUID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list rooms")
		return
	}

	resp := make([]RoomResponse, len(rooms))
	for i, room := range rooms {
		resp[i] = roomToResponse(room)
	}
	writeJSON(w, http.StatusOK, ListRoomsResponse{Rooms: resp, Total: len(resp)})
}

func (h *Handler) CreateRoom(w http.ResponseWriter, r *http.Request) {
	_, ok := requireUserID(w, r)
	if !ok {
		return
	}
	workspaceID := h.resolveWorkspaceID(r)
	wsUUID, ok := parseUUIDOrBadRequest(w, workspaceID, "workspace id")
	if !ok {
		return
	}

	var req CreateRoomRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.Name == "" {
		writeError(w, http.StatusBadRequest, "name is required")
		return
	}
	agentUUIDs := make([]pgtype.UUID, 0, len(req.AgentIDs))
	for _, agentID := range req.AgentIDs {
		agentUUID, ok := parseUUIDOrBadRequest(w, agentID, "agent_id")
		if !ok {
			return
		}
		if _, err := h.Queries.GetAgentInWorkspace(r.Context(), db.GetAgentInWorkspaceParams{
			ID:          agentUUID,
			WorkspaceID: wsUUID,
		}); err != nil {
			writeError(w, http.StatusBadRequest, "agent not found in this workspace")
			return
		}
		agentUUIDs = append(agentUUIDs, agentUUID)
	}

	theme := req.Theme
	if theme == "" {
		theme = "default"
	}

	tx, err := h.TxStarter.Begin(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to create room")
		return
	}
	defer tx.Rollback(r.Context())
	qtx := h.Queries.WithTx(tx)

	room, err := qtx.CreateRoom(r.Context(), db.CreateRoomParams{
		WorkspaceID: wsUUID,
		Name:        req.Name,
		Description: req.Description,
		Theme:       theme,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to create room")
		return
	}
	for _, agentUUID := range agentUUIDs {
		if _, err := qtx.AddRoomMember(r.Context(), db.AddRoomMemberParams{
			RoomID:     room.ID,
			MemberType: "agent",
			MemberID:   agentUUID,
			Role:       "participant",
		}); err != nil {
			writeError(w, http.StatusInternalServerError, "failed to add room member")
			return
		}
	}
	if err := tx.Commit(r.Context()); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to create room")
		return
	}

	writeJSON(w, http.StatusCreated, roomToResponse(room))
}

func (h *Handler) GetRoom(w http.ResponseWriter, r *http.Request) {
	_, ok := requireUserID(w, r)
	if !ok {
		return
	}
	workspaceID := h.resolveWorkspaceID(r)

	room, ok := h.loadRoomForWorkspace(w, r, workspaceID)
	if !ok {
		return
	}

	writeJSON(w, http.StatusOK, roomToResponse(room))
}

func (h *Handler) UpdateRoom(w http.ResponseWriter, r *http.Request) {
	_, ok := requireUserID(w, r)
	if !ok {
		return
	}
	workspaceID := h.resolveWorkspaceID(r)

	room, ok := h.loadRoomForWorkspace(w, r, workspaceID)
	if !ok {
		return
	}

	var req UpdateRoomRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	updated, err := h.Queries.UpdateRoom(r.Context(), db.UpdateRoomParams{
		ID:          room.ID,
		Name:        ptrToText(req.Name),
		Description: ptrToText(req.Description),
		Theme:       ptrToText(req.Theme),
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to update room")
		return
	}

	writeJSON(w, http.StatusOK, roomToResponse(updated))
}

func (h *Handler) ArchiveRoom(w http.ResponseWriter, r *http.Request) {
	_, ok := requireUserID(w, r)
	if !ok {
		return
	}
	workspaceID := h.resolveWorkspaceID(r)

	room, ok := h.loadRoomForWorkspace(w, r, workspaceID)
	if !ok {
		return
	}

	if room.ArchivedAt.Valid {
		writeJSON(w, http.StatusOK, roomToResponse(room))
		return
	}

	updated, err := h.Queries.ArchiveRoom(r.Context(), room.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to archive room")
		return
	}

	writeJSON(w, http.StatusOK, roomToResponse(updated))
}

func (h *Handler) DeleteRoom(w http.ResponseWriter, r *http.Request) {
	_, ok := requireUserID(w, r)
	if !ok {
		return
	}
	workspaceID := h.resolveWorkspaceID(r)

	room, ok := h.loadRoomForWorkspace(w, r, workspaceID)
	if !ok {
		return
	}

	if err := h.Queries.DeleteRoom(r.Context(), room.ID); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to delete room")
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// ---------------------------------------------------------------------------
// Room Messages
// ---------------------------------------------------------------------------

func (h *Handler) ListRoomMessages(w http.ResponseWriter, r *http.Request) {
	_, ok := requireUserID(w, r)
	if !ok {
		return
	}
	workspaceID := h.resolveWorkspaceID(r)

	room, ok := h.loadRoomForWorkspace(w, r, workspaceID)
	if !ok {
		return
	}

	limit := int32(50)
	if raw := r.URL.Query().Get("limit"); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil || n <= 0 {
			writeError(w, http.StatusBadRequest, "invalid limit")
			return
		}
		if n > 100 {
			n = 100
		}
		limit = int32(n)
	}
	var before pgtype.Timestamptz
	var beforeID pgtype.UUID
	rawCursor := r.URL.Query().Get("cursor")
	if rawCursor == "" {
		rawCursor = r.URL.Query().Get("before")
	}
	if rawCursor != "" {
		var ok bool
		before, beforeID, ok = decodeRoomMessageCursor(rawCursor)
		if !ok {
			writeError(w, http.StatusBadRequest, "invalid cursor")
			return
		}
	}

	rows, err := h.Queries.ListRoomMessages(r.Context(), db.ListRoomMessagesParams{
		RoomID:          room.ID,
		BeforeCreatedAt: before,
		BeforeID:        beforeID,
		LimitCount:      limit + 1,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list room messages")
		return
	}
	hasMore := len(rows) > int(limit)
	if hasMore {
		rows = rows[:limit]
	}

	resp := make([]RoomMessageResponse, len(rows))
	for i, msg := range rows {
		// The query fetches the latest page in descending order for cursor
		// efficiency; the chat UI renders oldest-to-newest.
		item := roomMessageToResponse(msg)
		if msg.SenderType == "agent" {
			if agent, err := h.Queries.GetAgent(r.Context(), msg.SenderID); err == nil {
				item.SenderName = agent.Name
			}
		}
		resp[len(rows)-1-i] = item
	}
	var nextCursor *string
	if hasMore && len(rows) > 0 {
		cursor := encodeRoomMessageCursor(rows[len(rows)-1])
		nextCursor = &cursor
	}
	writeJSON(w, http.StatusOK, ListRoomMessagesResponse{Messages: resp, NextCursor: nextCursor})
}

func (h *Handler) SendRoomMessage(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}
	workspaceID := h.resolveWorkspaceID(r)

	// 1. 校验 room workspace 归属 + 未归档
	room, ok := h.loadRoomForWorkspace(w, r, workspaceID)
	if !ok {
		return
	}
	if room.ArchivedAt.Valid {
		writeError(w, http.StatusBadRequest, "room is archived")
		return
	}

	var req SendRoomMessageRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.Content == "" {
		writeError(w, http.StatusBadRequest, "content is required")
		return
	}

	userUUID, ok := parseUUIDOrBadRequest(w, userID, "user id")
	if !ok {
		return
	}

	mentions := req.Mentions
	if mentions == nil {
		mentions = req.MentionAgentIDs
	}
	if mentions == nil {
		mentions = []string{}
	}

	var replyToMsgID pgtype.UUID
	if req.ReplyToMessageID != nil && *req.ReplyToMessageID != "" {
		replyToMsgID, ok = parseUUIDOrBadRequest(w, *req.ReplyToMessageID, "reply_to_message_id")
		if !ok {
			return
		}
	}

	// 2. 写入 room_message
	msg, err := h.Queries.CreateRoomMessage(r.Context(), db.CreateRoomMessageParams{
		RoomID:           room.ID,
		SenderType:       "user",
		SenderID:         userUUID,
		Content:          req.Content,
		ReplyToMessageID: replyToMsgID,
		Mentions:         mentions,
		IsAutonomous:     false,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to create room message")
		return
	}

	// 3. 推 room:message ws 事件给所有 workspace 订阅者
	h.publish(protocol.EventRoomMessage, workspaceID, "member", userID, protocol.RoomMessagePayload{
		RoomID:           uuidToString(room.ID),
		MessageID:        uuidToString(msg.ID),
		SenderType:       "user",
		SenderID:         userID,
		Content:          req.Content,
		ReplyToMessageID: uuidToPtr(msg.ReplyToMessageID),
		Mentions:         mentions,
		IsAutonomous:     false,
		CreatedAt:        timestampToString(msg.CreatedAt),
	})

	// 4. touch room last_active_at
	if err := h.Queries.TouchRoomActiveAt(r.Context(), room.ID); err != nil {
		slog.Warn("failed to touch room active_at",
			"room_id", uuidToString(room.ID), "error", err)
	}

	// 5. 触发 agent fan-out。普通消息默认让所有 active agent 接话；
	// mentions 非空时由 service 层收窄到 @all 或被 @ 的 agent。
	if err := h.TaskService.EnqueueRoomChatTasks(
		r.Context(), h.Queries, room, msg, userID, workspaceID, h,
	); err != nil {
		// fan-out 失败不阻断消息发送，降级处理
		slog.Warn("room chat task fan-out failed",
			"room_id", uuidToString(room.ID), "error", err)
	}

	writeJSON(w, http.StatusCreated, roomMessageToResponse(msg))
}

// GetRoomRelayStatus returns the in-progress relay round for a room, if any.
// The frontend polls this after sending a message to show "relaying in progress".
func (h *Handler) GetRoomRelayStatus(w http.ResponseWriter, r *http.Request) {
	_, ok := requireUserID(w, r)
	if !ok {
		return
	}
	workspaceID := h.resolveWorkspaceID(r)
	room, ok := h.loadRoomForWorkspace(w, r, workspaceID)
	if !ok {
		return
	}
	round := service.GetRoomRelayRound(uuidToString(room.ID))
	if round == nil {
		writeJSON(w, http.StatusOK, map[string]any{
			"active": false,
		})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"active":     true,
		"round_id":   round.RoundID,
		"started_at": round.StartedAt.Format(time.RFC3339),
	})
}

// ---------------------------------------------------------------------------
// Room Members
// ---------------------------------------------------------------------------

func (h *Handler) ListRoomMembers(w http.ResponseWriter, r *http.Request) {
	_, ok := requireUserID(w, r)
	if !ok {
		return
	}
	workspaceID := h.resolveWorkspaceID(r)

	room, ok := h.loadRoomForWorkspace(w, r, workspaceID)
	if !ok {
		return
	}

	rows, err := h.Queries.ListRoomMembers(r.Context(), room.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list room members")
		return
	}

	resp := make([]RoomMemberResponse, len(rows))
	for i, member := range rows {
		resp[i] = roomMemberToResponse(member)
	}
	writeJSON(w, http.StatusOK, ListRoomMembersResponse{Members: resp})
}

func (h *Handler) AddRoomMember(w http.ResponseWriter, r *http.Request) {
	_, ok := requireUserID(w, r)
	if !ok {
		return
	}
	workspaceID := h.resolveWorkspaceID(r)

	room, ok := h.loadRoomForWorkspace(w, r, workspaceID)
	if !ok {
		return
	}

	var req AddRoomMemberRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.MemberID == "" && req.AgentID != "" {
		req.MemberType = "agent"
		req.MemberID = req.AgentID
	}
	if req.MemberType != "user" && req.MemberType != "agent" {
		writeError(w, http.StatusBadRequest, "member_type must be 'user' or 'agent'")
		return
	}
	if req.MemberID == "" {
		writeError(w, http.StatusBadRequest, "member_id is required")
		return
	}
	memberUUID, ok := parseUUIDOrBadRequest(w, req.MemberID, "member_id")
	if !ok {
		return
	}
	wsUUID, ok := parseUUIDOrBadRequest(w, workspaceID, "workspace_id")
	if !ok {
		return
	}
	switch req.MemberType {
	case "agent":
		if _, err := h.Queries.GetAgentInWorkspace(r.Context(), db.GetAgentInWorkspaceParams{
			ID:          memberUUID,
			WorkspaceID: wsUUID,
		}); err != nil {
			writeError(w, http.StatusBadRequest, "member_id does not refer to an agent in this workspace")
			return
		}
	case "user":
		if _, err := h.Queries.GetMemberByUserAndWorkspace(r.Context(), db.GetMemberByUserAndWorkspaceParams{
			UserID:      memberUUID,
			WorkspaceID: wsUUID,
		}); err != nil {
			writeError(w, http.StatusBadRequest, "member_id does not refer to a user in this workspace")
			return
		}
	}

	role := req.Role
	if role == "" {
		role = "participant"
	}
	if role != "owner" && role != "participant" {
		writeError(w, http.StatusBadRequest, "role must be 'owner' or 'participant'")
		return
	}

	member, err := h.Queries.AddRoomMember(r.Context(), db.AddRoomMemberParams{
		RoomID:     room.ID,
		MemberType: req.MemberType,
		MemberID:   memberUUID,
		Role:       role,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to add room member")
		return
	}

	writeJSON(w, http.StatusCreated, roomMemberToResponse(member))
}

func (h *Handler) RemoveRoomMember(w http.ResponseWriter, r *http.Request) {
	_, ok := requireUserID(w, r)
	if !ok {
		return
	}
	workspaceID := h.resolveWorkspaceID(r)

	room, ok := h.loadRoomForWorkspace(w, r, workspaceID)
	if !ok {
		return
	}

	memberIDStr := chi.URLParam(r, "memberId")
	memberUUID, ok := parseUUIDOrBadRequest(w, memberIDStr, "member id")
	if !ok {
		return
	}

	// member_type 从 query param 取，默认 agent（客厅主要移除 agent）
	memberType := r.URL.Query().Get("type")
	if memberType == "" {
		memberType = "agent"
	}
	if memberType != "user" && memberType != "agent" {
		writeError(w, http.StatusBadRequest, "type must be 'user' or 'agent'")
		return
	}

	if err := h.Queries.RemoveRoomMember(r.Context(), db.RemoveRoomMemberParams{
		RoomID:     room.ID,
		MemberType: memberType,
		MemberID:   memberUUID,
	}); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to remove room member")
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// ---------------------------------------------------------------------------
// Room Agent Persona
// ---------------------------------------------------------------------------

func (h *Handler) GetRoomAgentPersona(w http.ResponseWriter, r *http.Request) {
	_, ok := requireUserID(w, r)
	if !ok {
		return
	}
	workspaceID := h.resolveWorkspaceID(r)

	room, ok := h.loadRoomForWorkspace(w, r, workspaceID)
	if !ok {
		return
	}

	agentIDStr := chi.URLParam(r, "agentId")
	agentUUID, ok := parseUUIDOrBadRequest(w, agentIDStr, "agent id")
	if !ok {
		return
	}

	persona, err := h.Queries.GetRoomAgentPersona(r.Context(), db.GetRoomAgentPersonaParams{
		RoomID:  room.ID,
		AgentID: agentUUID,
	})
	if err != nil {
		if isNotFound(err) {
			writeError(w, http.StatusNotFound, "persona not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to get persona")
		return
	}

	writeJSON(w, http.StatusOK, roomAgentPersonaToResponse(persona))
}

func (h *Handler) UpsertRoomAgentPersona(w http.ResponseWriter, r *http.Request) {
	_, ok := requireUserID(w, r)
	if !ok {
		return
	}
	workspaceID := h.resolveWorkspaceID(r)

	room, ok := h.loadRoomForWorkspace(w, r, workspaceID)
	if !ok {
		return
	}

	agentIDStr := chi.URLParam(r, "agentId")
	agentUUID, ok := parseUUIDOrBadRequest(w, agentIDStr, "agent id")
	if !ok {
		return
	}

	var req UpsertRoomAgentPersonaRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.PersonaOverride == nil {
		req.PersonaOverride = map[string]any{}
	}

	overrideJSON, err := json.Marshal(req.PersonaOverride)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid persona_override")
		return
	}

	persona, err := h.Queries.UpsertRoomAgentPersona(r.Context(), db.UpsertRoomAgentPersonaParams{
		RoomID:          room.ID,
		AgentID:         agentUUID,
		PersonaOverride: overrideJSON,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to upsert persona")
		return
	}

	writeJSON(w, http.StatusOK, roomAgentPersonaToResponse(persona))
}
