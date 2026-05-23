package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

// setupTestRoom 创建一个测试用 room，返回 room response。
func setupTestRoom(t *testing.T) RoomResponse {
	t.Helper()
	if testHandler == nil {
		t.Skip("no database connection")
	}

	body, _ := json.Marshal(CreateRoomRequest{
		Name:        "测试客厅",
		Description: "integration test room",
		Theme:       "default",
	})
	req := httptest.NewRequest(http.MethodPost, "/api/rooms", bytes.NewReader(body))
	req.Header.Set("X-User-ID", testUserID)
	req = withWorkspaceCtx(req, testWorkspaceID)
	w := httptest.NewRecorder()

	testHandler.CreateRoom(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("CreateRoom: want 201, got %d — body: %s", w.Code, w.Body.String())
	}

	var room RoomResponse
	if err := json.Unmarshal(w.Body.Bytes(), &room); err != nil {
		t.Fatalf("decode CreateRoom response: %v", err)
	}
	return room
}

// TestRoom_CreateAndGet 测试 room CRUD 基本流程。
func TestRoom_CreateAndGet(t *testing.T) {
	if testHandler == nil {
		t.Skip("no database connection")
	}

	room := setupTestRoom(t)

	if room.ID == "" {
		t.Fatal("room.ID is empty")
	}
	if room.Name != "测试客厅" {
		t.Fatalf("room.Name = %q, want 测试客厅", room.Name)
	}
	if room.WorkspaceID != testWorkspaceID {
		t.Fatalf("room.WorkspaceID = %q, want %q", room.WorkspaceID, testWorkspaceID)
	}
	if room.Theme != "default" {
		t.Fatalf("room.Theme = %q, want default", room.Theme)
	}

	// GetRoom
	r := chi.NewRouter()
	r.With(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			req = withWorkspaceCtx(req, testWorkspaceID)
			req.Header.Set("X-User-ID", testUserID)
			next.ServeHTTP(w, req)
		})
	}).Get("/api/rooms/{id}", testHandler.GetRoom)

	req := httptest.NewRequest(http.MethodGet, "/api/rooms/"+room.ID, nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("GetRoom: want 200, got %d — body: %s", w.Code, w.Body.String())
	}

	var got RoomResponse
	if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode GetRoom response: %v", err)
	}
	if got.ID != room.ID {
		t.Fatalf("GetRoom.ID = %q, want %q", got.ID, room.ID)
	}
}

func TestRoom_ListRoomsReturnsEnvelope(t *testing.T) {
	if testHandler == nil {
		t.Skip("no database connection")
	}

	room := setupTestRoom(t)

	req := httptest.NewRequest(http.MethodGet, "/api/rooms", nil)
	req.Header.Set("X-User-ID", testUserID)
	req = withWorkspaceCtx(req, testWorkspaceID)
	w := httptest.NewRecorder()

	testHandler.ListRooms(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("ListRooms: want 200, got %d — body: %s", w.Code, w.Body.String())
	}

	var resp ListRoomsResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode ListRooms response: %v", err)
	}
	if resp.Total == 0 || len(resp.Rooms) == 0 {
		t.Fatalf("ListRooms: expected non-empty envelope, got total=%d rooms=%d", resp.Total, len(resp.Rooms))
	}
	found := false
	for _, listed := range resp.Rooms {
		if listed.ID == room.ID {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("ListRooms: created room %s not found in response", room.ID)
	}
}

func TestRoom_CreateAddsSelectedAgents(t *testing.T) {
	if testHandler == nil {
		t.Skip("no database connection")
	}

	agentID := createTestAgentForRoom(t)
	body, _ := json.Marshal(CreateRoomRequest{
		Name:        "测试邀请客厅",
		Description: "create with selected agents",
		AgentIDs:    []string{agentID},
	})
	req := httptest.NewRequest(http.MethodPost, "/api/rooms", bytes.NewReader(body))
	req.Header.Set("X-User-ID", testUserID)
	req = withWorkspaceCtx(req, testWorkspaceID)
	w := httptest.NewRecorder()

	testHandler.CreateRoom(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("CreateRoom: want 201, got %d — body: %s", w.Code, w.Body.String())
	}

	var room RoomResponse
	if err := json.Unmarshal(w.Body.Bytes(), &room); err != nil {
		t.Fatalf("decode CreateRoom response: %v", err)
	}

	var count int
	if err := testPool.QueryRow(t.Context(), `
		SELECT COUNT(*) FROM room_member
		WHERE room_id = $1 AND member_type = 'agent' AND member_id = $2 AND left_at IS NULL
	`, room.ID, agentID).Scan(&count); err != nil {
		t.Fatalf("count room members: %v", err)
	}
	if count != 1 {
		t.Fatalf("expected selected agent to be room member, got count=%d", count)
	}
}

// TestRoom_UpdateRoom 测试更新 room 名称。
func TestRoom_UpdateRoom(t *testing.T) {
	if testHandler == nil {
		t.Skip("no database connection")
	}

	room := setupTestRoom(t)

	newName := "更名客厅"
	body, _ := json.Marshal(UpdateRoomRequest{Name: &newName})

	r := chi.NewRouter()
	r.With(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			req = withWorkspaceCtx(req, testWorkspaceID)
			req.Header.Set("X-User-ID", testUserID)
			next.ServeHTTP(w, req)
		})
	}).Patch("/api/rooms/{id}", testHandler.UpdateRoom)

	req := httptest.NewRequest(http.MethodPatch, "/api/rooms/"+room.ID, bytes.NewReader(body))
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("UpdateRoom: want 200, got %d — body: %s", w.Code, w.Body.String())
	}

	var updated RoomResponse
	if err := json.Unmarshal(w.Body.Bytes(), &updated); err != nil {
		t.Fatalf("decode UpdateRoom response: %v", err)
	}
	if updated.Name != newName {
		t.Fatalf("UpdateRoom.Name = %q, want %q", updated.Name, newName)
	}
}

// TestRoomMember_AddAndRemove 测试添加 agent 成员、唯一约束 + soft-delete。
func TestRoomMember_AddAndRemove(t *testing.T) {
	if testHandler == nil {
		t.Skip("no database connection")
	}

	room := setupTestRoom(t)

	// 先建一个 agent
	agentID := createTestAgentForRoom(t)

	// AddRoomMember
	addBody, _ := json.Marshal(AddRoomMemberRequest{
		MemberType: "agent",
		MemberID:   agentID,
		Role:       "participant",
	})
	r := chi.NewRouter()
	r.With(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			req = withWorkspaceCtx(req, testWorkspaceID)
			req.Header.Set("X-User-ID", testUserID)
			next.ServeHTTP(w, req)
		})
	}).Post("/api/rooms/{id}/members", testHandler.AddRoomMember)
	r.With(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			req = withWorkspaceCtx(req, testWorkspaceID)
			req.Header.Set("X-User-ID", testUserID)
			next.ServeHTTP(w, req)
		})
	}).Delete("/api/rooms/{id}/members/{memberId}", testHandler.RemoveRoomMember)

	req := httptest.NewRequest(http.MethodPost, "/api/rooms/"+room.ID+"/members", bytes.NewReader(addBody))
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("AddRoomMember: want 201, got %d — body: %s", w.Code, w.Body.String())
	}

	// 重复 add 应该 upsert 成功（不报 409）
	req2 := httptest.NewRequest(http.MethodPost, "/api/rooms/"+room.ID+"/members", bytes.NewReader(addBody))
	w2 := httptest.NewRecorder()
	r.ServeHTTP(w2, req2)
	if w2.Code != http.StatusCreated {
		t.Fatalf("AddRoomMember (dup): want 201, got %d — body: %s", w2.Code, w2.Body.String())
	}

	// RemoveRoomMember (soft delete)
	req3 := httptest.NewRequest(http.MethodDelete, "/api/rooms/"+room.ID+"/members/"+agentID+"?type=agent", nil)
	w3 := httptest.NewRecorder()
	r.ServeHTTP(w3, req3)
	if w3.Code != http.StatusNoContent {
		t.Fatalf("RemoveRoomMember: want 204, got %d — body: %s", w3.Code, w3.Body.String())
	}
}

func TestRoomMember_AddRejectsAgentFromOtherWorkspace(t *testing.T) {
	if testHandler == nil {
		t.Skip("no database connection")
	}

	room := setupTestRoom(t)
	otherAgentID := createTestAgentInNewWorkspace(t)

	r := chi.NewRouter()
	r.With(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			req = withWorkspaceCtx(req, testWorkspaceID)
			req.Header.Set("X-User-ID", testUserID)
			next.ServeHTTP(w, req)
		})
	}).Post("/api/rooms/{id}/members", testHandler.AddRoomMember)

	addBody, _ := json.Marshal(AddRoomMemberRequest{AgentID: otherAgentID})
	req := httptest.NewRequest(http.MethodPost, "/api/rooms/"+room.ID+"/members", bytes.NewReader(addBody))
	w := httptest.NewRecorder()

	r.ServeHTTP(w, req)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("AddRoomMember: want 400 for cross-workspace agent, got %d — body: %s", w.Code, w.Body.String())
	}
}

func TestRoomMember_ListReturnsEnvelope(t *testing.T) {
	if testHandler == nil {
		t.Skip("no database connection")
	}

	room := setupTestRoom(t)
	agentID := createTestAgentForRoom(t)
	_, err := testHandler.Queries.AddRoomMember(t.Context(), db.AddRoomMemberParams{
		RoomID:     parseUUID(room.ID),
		MemberType: "agent",
		MemberID:   parseUUID(agentID),
		Role:       "participant",
	})
	if err != nil {
		t.Fatalf("seed room member: %v", err)
	}

	r := chi.NewRouter()
	r.With(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			req = withWorkspaceCtx(req, testWorkspaceID)
			req.Header.Set("X-User-ID", testUserID)
			next.ServeHTTP(w, req)
		})
	}).Get("/api/rooms/{id}/members", testHandler.ListRoomMembers)

	req := httptest.NewRequest(http.MethodGet, "/api/rooms/"+room.ID+"/members", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("ListRoomMembers: want 200, got %d — body: %s", w.Code, w.Body.String())
	}

	var resp ListRoomMembersResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode ListRoomMembers: %v", err)
	}
	if len(resp.Members) != 1 {
		t.Fatalf("ListRoomMembers: expected 1 member, got %d", len(resp.Members))
	}
	if resp.Members[0].AgentID != agentID {
		t.Fatalf("ListRoomMembers: AgentID = %q, want %q", resp.Members[0].AgentID, agentID)
	}
}

// TestRoomMessage_InsertAndList 测试发送消息 + 分页查询。
func TestRoomMessage_InsertAndList(t *testing.T) {
	if testHandler == nil {
		t.Skip("no database connection")
	}

	room := setupTestRoom(t)

	r := chi.NewRouter()
	r.With(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			req = withWorkspaceCtx(req, testWorkspaceID)
			req.Header.Set("X-User-ID", testUserID)
			next.ServeHTTP(w, req)
		})
	}).Post("/api/rooms/{id}/messages", testHandler.SendRoomMessage)
	r.With(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			req = withWorkspaceCtx(req, testWorkspaceID)
			req.Header.Set("X-User-ID", testUserID)
			next.ServeHTTP(w, req)
		})
	}).Get("/api/rooms/{id}/messages", testHandler.ListRoomMessages)

	// 发送消息（当前 room 无 agent 成员，因此不会产生 fan-out）
	msgBody, _ := json.Marshal(SendRoomMessageRequest{
		Content:  "大家好，这是第一条消息",
		Mentions: []string{},
	})
	req := httptest.NewRequest(http.MethodPost, "/api/rooms/"+room.ID+"/messages", bytes.NewReader(msgBody))
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("SendRoomMessage: want 201, got %d — body: %s", w.Code, w.Body.String())
	}

	var created RoomMessageResponse
	if err := json.Unmarshal(w.Body.Bytes(), &created); err != nil {
		t.Fatalf("decode SendRoomMessage: %v", err)
	}
	if created.Content != "大家好，这是第一条消息" {
		t.Fatalf("message.Content = %q", created.Content)
	}
	if created.SenderType != "user" {
		t.Fatalf("message.SenderType = %q, want user", created.SenderType)
	}

	// 查询消息列表
	req2 := httptest.NewRequest(http.MethodGet, "/api/rooms/"+room.ID+"/messages", nil)
	w2 := httptest.NewRecorder()
	r.ServeHTTP(w2, req2)
	if w2.Code != http.StatusOK {
		t.Fatalf("ListRoomMessages: want 200, got %d — body: %s", w2.Code, w2.Body.String())
	}

	var msgResp ListRoomMessagesResponse
	if err := json.Unmarshal(w2.Body.Bytes(), &msgResp); err != nil {
		t.Fatalf("decode ListRoomMessages: %v", err)
	}
	if len(msgResp.Messages) == 0 {
		t.Fatal("ListRoomMessages: expected at least 1 message")
	}
	if msgResp.Messages[0].ID != created.ID {
		t.Fatalf("ListRoomMessages: first ID = %q, want %q", msgResp.Messages[0].ID, created.ID)
	}
}

func TestRoomMessage_PlainMessageStartsSalonRelayForActiveAgents(t *testing.T) {
	if testHandler == nil || testPool == nil {
		t.Skip("no database connection")
	}

	room := setupTestRoom(t)
	agentIDs := []string{createTestAgentForRoom(t), createTestAgentForRoom(t)}
	for _, agentID := range agentIDs {
		if _, err := testHandler.Queries.AddRoomMember(t.Context(), db.AddRoomMemberParams{
			RoomID:     parseUUID(room.ID),
			MemberType: "agent",
			MemberID:   parseUUID(agentID),
			Role:       "participant",
		}); err != nil {
			t.Fatalf("add room member %s: %v", agentID, err)
		}
	}

	r := chi.NewRouter()
	r.With(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			req = withWorkspaceCtx(req, testWorkspaceID)
			req.Header.Set("X-User-ID", testUserID)
			next.ServeHTTP(w, req)
		})
	}).Post("/api/rooms/{id}/messages", testHandler.SendRoomMessage)

	msgBody, _ := json.Marshal(SendRoomMessageRequest{
		Content: "不用 @ 也应该有人接话",
	})
	req := httptest.NewRequest(http.MethodPost, "/api/rooms/"+room.ID+"/messages", bytes.NewReader(msgBody))
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("SendRoomMessage: want 201, got %d — body: %s", w.Code, w.Body.String())
	}

	var sessionCount int
	if err := testPool.QueryRow(t.Context(), `
		SELECT COUNT(DISTINCT agent_id)
		FROM chat_session
		WHERE room_id = $1
		  AND is_room_internal = TRUE
		  AND agent_id IN ($2, $3)
	`, room.ID, agentIDs[0], agentIDs[1]).Scan(&sessionCount); err != nil {
		t.Fatalf("count room internal sessions: %v", err)
	}
	if sessionCount != 1 {
		t.Fatalf("room internal sessions = %d, want 1 opening session", sessionCount)
	}

	var taskCount int
	if err := testPool.QueryRow(t.Context(), `
		SELECT COUNT(*)
		FROM agent_task_queue t
		JOIN chat_session cs ON cs.id = t.chat_session_id
		WHERE cs.room_id = $1
		  AND cs.is_room_internal = TRUE
		  AND t.agent_id IN ($2, $3)
		  AND t.status = 'queued'
	`, room.ID, agentIDs[0], agentIDs[1]).Scan(&taskCount); err != nil {
		t.Fatalf("count room chat tasks: %v", err)
	}
	if taskCount != 1 {
		t.Fatalf("room opening chat tasks = %d, want 1", taskCount)
	}

	var raw []byte
	var forceFresh bool
	if err := testPool.QueryRow(t.Context(), `
		SELECT t.context, t.force_fresh_session
		FROM agent_task_queue t
		JOIN chat_session cs ON cs.id = t.chat_session_id
		WHERE cs.room_id = $1
		  AND cs.is_room_internal = TRUE
		  AND t.agent_id IN ($2, $3)
	`, room.ID, agentIDs[0], agentIDs[1]).Scan(&raw, &forceFresh); err != nil {
		t.Fatalf("query room opening chat task context: %v", err)
	}
	if !forceFresh {
		t.Fatal("room opening chat task force_fresh_session = false, want true")
	}
	var payload struct {
		Type      string `json:"type"`
		Role      string `json:"role"`
		TurnIndex int    `json:"turn_index"`
		MaxTurns  int    `json:"max_turns"`
	}
	if err := json.Unmarshal(raw, &payload); err != nil {
		t.Fatalf("decode room chat task context: %v", err)
	}
	if payload.Type != "council_broadcast" {
		t.Fatalf("room chat task context type = %q, want council_broadcast", payload.Type)
	}
	if payload.Role != "salon_speaker" {
		t.Fatalf("room chat task role = %q, want salon_speaker", payload.Role)
	}
	if payload.TurnIndex != 1 {
		t.Fatalf("room opening turn_index = %d, want 1", payload.TurnIndex)
	}
	if payload.MaxTurns != len(agentIDs) {
		t.Fatalf("room opening max_turns = %d, want %d", payload.MaxTurns, len(agentIDs))
	}
}

func TestRoomMessage_ListUsesCursorPagination(t *testing.T) {
	if testHandler == nil {
		t.Skip("no database connection")
	}

	room := setupTestRoom(t)
	roomID := parseUUID(room.ID)
	userID := parseUUID(testUserID)
	base := time.Now().UTC().Add(-time.Hour)

	type insertedMessage struct {
		id      string
		content string
	}
	inserted := make([]insertedMessage, 0, 3)
	for i := 1; i <= 3; i++ {
		var id string
		content := fmt.Sprintf("cursor message %d", i)
		if err := testPool.QueryRow(t.Context(), `
			INSERT INTO room_message (room_id, sender_type, sender_id, content, mentions, is_autonomous, created_at)
			VALUES ($1, 'user', $2, $3, ARRAY[]::text[], false, $4)
			RETURNING id::text
		`, roomID, userID, content, base.Add(time.Duration(i)*time.Minute)).Scan(&id); err != nil {
			t.Fatalf("insert room message %d: %v", i, err)
		}
		inserted = append(inserted, insertedMessage{id: id, content: content})
	}

	r := chi.NewRouter()
	r.With(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			req = withWorkspaceCtx(req, testWorkspaceID)
			req.Header.Set("X-User-ID", testUserID)
			next.ServeHTTP(w, req)
		})
	}).Get("/api/rooms/{id}/messages", testHandler.ListRoomMessages)

	req := httptest.NewRequest(http.MethodGet, "/api/rooms/"+room.ID+"/messages?limit=2", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("ListRoomMessages page 1: want 200, got %d — body: %s", w.Code, w.Body.String())
	}

	var page1 ListRoomMessagesResponse
	if err := json.Unmarshal(w.Body.Bytes(), &page1); err != nil {
		t.Fatalf("decode page 1: %v", err)
	}
	if len(page1.Messages) != 2 {
		t.Fatalf("page 1 len = %d, want 2: %+v", len(page1.Messages), page1.Messages)
	}
	if page1.Messages[0].ID != inserted[1].id || page1.Messages[1].ID != inserted[2].id {
		t.Fatalf("page 1 ids = [%s %s], want [%s %s]", page1.Messages[0].ID, page1.Messages[1].ID, inserted[1].id, inserted[2].id)
	}
	if page1.NextCursor == nil || *page1.NextCursor == "" {
		t.Fatalf("page 1 next_cursor = %v, want non-empty", page1.NextCursor)
	}

	req = httptest.NewRequest(http.MethodGet, "/api/rooms/"+room.ID+"/messages?limit=2&cursor="+*page1.NextCursor, nil)
	w = httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("ListRoomMessages page 2: want 200, got %d — body: %s", w.Code, w.Body.String())
	}

	var page2 ListRoomMessagesResponse
	if err := json.Unmarshal(w.Body.Bytes(), &page2); err != nil {
		t.Fatalf("decode page 2: %v", err)
	}
	if len(page2.Messages) != 1 {
		t.Fatalf("page 2 len = %d, want 1: %+v", len(page2.Messages), page2.Messages)
	}
	if page2.Messages[0].ID != inserted[0].id {
		t.Fatalf("page 2 first id = %s, want %s", page2.Messages[0].ID, inserted[0].id)
	}
	if page2.NextCursor != nil {
		t.Fatalf("page 2 next_cursor = %q, want nil", *page2.NextCursor)
	}
}

// TestRoomMessage_DeleteRoomAllowsActiveRoom 测试未归档 room 也可直接删除。
func TestRoomMessage_DeleteRoomAllowsActiveRoom(t *testing.T) {
	if testHandler == nil {
		t.Skip("no database connection")
	}

	room := setupTestRoom(t)

	r := chi.NewRouter()
	r.With(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			req = withWorkspaceCtx(req, testWorkspaceID)
			req.Header.Set("X-User-ID", testUserID)
			next.ServeHTTP(w, req)
		})
	}).Delete("/api/rooms/{id}", testHandler.DeleteRoom)

	req := httptest.NewRequest(http.MethodDelete, "/api/rooms/"+room.ID, nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusNoContent {
		t.Fatalf("DeleteRoom: want 204, got %d — body: %s", w.Code, w.Body.String())
	}

	var count int
	if err := testPool.QueryRow(t.Context(), `SELECT COUNT(*) FROM room WHERE id = $1`, room.ID).Scan(&count); err != nil {
		t.Fatalf("count room after delete: %v", err)
	}
	if count != 0 {
		t.Fatalf("room was not deleted, count=%d", count)
	}
}

// TestChatSession_ListExcludesRoomInternal 测试 is_room_internal=TRUE 的 session
// 不出现在 ListChatSessionsByCreator 结果中。
func TestChatSession_ListExcludesRoomInternal(t *testing.T) {
	if testHandler == nil {
		t.Skip("no database connection")
	}
	if testPool == nil {
		t.Skip("no database connection")
	}

	room := setupTestRoom(t)
	agentID := createTestAgentForRoom(t)

	// 直接往 DB 插一条 is_room_internal=TRUE 的 chat_session
	_, err := testPool.Exec(t.Context(),
		`INSERT INTO chat_session (workspace_id, agent_id, creator_id, title, room_id, is_room_internal)
		 VALUES ($1, $2, $3, $4, $5, TRUE)`,
		testWorkspaceID, agentID, testUserID, "internal session", room.ID,
	)
	if err != nil {
		t.Fatalf("insert room internal session: %v", err)
	}

	// ListChatSessions 不应该返回这条 session
	req := httptest.NewRequest(http.MethodGet, "/api/chat-sessions", nil)
	req.Header.Set("X-User-ID", testUserID)
	req = withWorkspaceCtx(req, testWorkspaceID)
	w := httptest.NewRecorder()
	testHandler.ListChatSessions(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("ListChatSessions: want 200, got %d", w.Code)
	}

	var sessions []ChatSessionResponse
	if err := json.Unmarshal(w.Body.Bytes(), &sessions); err != nil {
		t.Fatalf("decode ListChatSessions: %v", err)
	}

	for _, s := range sessions {
		if s.Title == "internal session" {
			t.Fatal("ListChatSessions: should not include is_room_internal=TRUE sessions")
		}
	}
}

// createTestAgentForRoom 创建一个测试用 agent 并返回其 ID。
func createTestAgentForRoom(t *testing.T) string {
	t.Helper()
	var agentID string
	err := testPool.QueryRow(t.Context(),
		`INSERT INTO agent (
			workspace_id, runtime_id, name, description, runtime_mode,
			runtime_config, visibility, max_concurrent_tasks, owner_id
		)
		 VALUES ($1, $2, $3, $4, 'cloud', '{}'::jsonb, 'workspace', 1, $5)
		 RETURNING id`,
		testWorkspaceID, testRuntimeID, fmt.Sprintf("TestRoomAgent-%d", time.Now().UnixNano()), "test agent for room", testUserID,
	).Scan(&agentID)
	if err != nil {
		t.Fatalf("create test agent: %v", err)
	}
	return agentID
}

func createTestAgentInNewWorkspace(t *testing.T) string {
	t.Helper()

	slug := fmt.Sprintf("room-other-%d", time.Now().UnixNano())
	var workspaceID string
	if err := testPool.QueryRow(t.Context(), `
		INSERT INTO workspace (name, slug, description)
		VALUES ($1, $2, $3)
		RETURNING id
	`, "Room Other Workspace", slug, "test room cross-workspace guard").Scan(&workspaceID); err != nil {
		t.Fatalf("create other workspace: %v", err)
	}
	t.Cleanup(func() {
		testPool.Exec(context.Background(), `DELETE FROM workspace WHERE id = $1`, workspaceID)
	})

	var runtimeID string
	if err := testPool.QueryRow(t.Context(), `
		INSERT INTO agent_runtime (
			workspace_id, daemon_id, name, runtime_mode, provider, status, device_info, metadata, last_seen_at
		)
		VALUES ($1, NULL, $2, 'cloud', $3, 'online', $4, '{}'::jsonb, now())
		RETURNING id
	`, workspaceID, "Room Other Runtime", "room_other_runtime", "room other runtime").Scan(&runtimeID); err != nil {
		t.Fatalf("create other runtime: %v", err)
	}

	var agentID string
	if err := testPool.QueryRow(t.Context(), `
		INSERT INTO agent (
			workspace_id, runtime_id, name, description, runtime_mode,
			runtime_config, visibility, max_concurrent_tasks, owner_id
		)
		VALUES ($1, $2, $3, '', 'cloud', '{}'::jsonb, 'workspace', 1, $4)
		RETURNING id
	`, workspaceID, runtimeID, fmt.Sprintf("OtherRoomAgent-%d", time.Now().UnixNano()), testUserID).Scan(&agentID); err != nil {
		t.Fatalf("create other agent: %v", err)
	}
	return agentID
}

// withWorkspaceCtx 把 workspace_id 注入 request（通过 X-Workspace-ID header，
// resolveWorkspaceID 解析顺序：ctx → X-Workspace-Slug → X-Workspace-ID → query）
func withWorkspaceCtx(r *http.Request, workspaceID string) *http.Request {
	r.Header.Set("X-Workspace-ID", workspaceID)
	return r
}
