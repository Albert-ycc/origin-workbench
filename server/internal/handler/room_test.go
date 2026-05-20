package handler

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
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

	// 发送消息（无 mentions，不触发 fan-out）
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

	var msgs []RoomMessageResponse
	if err := json.Unmarshal(w2.Body.Bytes(), &msgs); err != nil {
		t.Fatalf("decode ListRoomMessages: %v", err)
	}
	if len(msgs) == 0 {
		t.Fatal("ListRoomMessages: expected at least 1 message")
	}
}

// TestRoomMessage_DeleteRoomRequiresArchived 测试未归档 room 不可删除。
func TestRoomMessage_DeleteRoomRequiresArchived(t *testing.T) {
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
	if w.Code != http.StatusBadRequest {
		t.Fatalf("DeleteRoom (not archived): want 400, got %d — body: %s", w.Code, w.Body.String())
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
		`INSERT INTO agent (workspace_id, runtime_id, name, description, work_mode)
		 VALUES ($1, $2, $3, $4, $5)
		 RETURNING id`,
		testWorkspaceID, testRuntimeID, fmt.Sprintf("TestRoomAgent-%d", time.Now().UnixNano()), "test agent for room", "live",
	).Scan(&agentID)
	if err != nil {
		t.Fatalf("create test agent: %v", err)
	}
	return agentID
}

// withWorkspaceCtx 把 workspace_id 注入 request（通过 X-Workspace-ID header，
// resolveWorkspaceID 解析顺序：ctx → X-Workspace-Slug → X-Workspace-ID → query）
func withWorkspaceCtx(r *http.Request, workspaceID string) *http.Request {
	r.Header.Set("X-Workspace-ID", workspaceID)
	return r
}
