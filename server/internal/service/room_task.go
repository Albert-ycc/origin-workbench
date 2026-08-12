package service

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/multica-ai/multica/server/internal/events"
	"github.com/multica-ai/multica/server/internal/util"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
	"github.com/multica-ai/multica/server/pkg/protocol"
)

// ---------------------------------------------------------------------------
// Room relay round state — in-memory tracking so the frontend can show
// "relaying in progress" without a DB migration. Rounds are auto-cleared
// when the last agent message is written (via maybeWriteRoomMessage).
// ---------------------------------------------------------------------------

// RelayRound tracks a single room-to-agent relay round.
type RelayRound struct {
	RoundID   string    `json:"round_id"`
	RoomID    string    `json:"room_id"`
	StartedAt time.Time `json:"started_at"`
	Status    string    `json:"status"` // "active" | "completed"
}

var (
	relayMu     sync.Mutex
	relayRounds = map[string]*RelayRound{} // key = room_id
)

// UpsertRoomRelayRound creates or replaces the active relay round for a room.
// Called from EnqueueRoomChatTasks when a user message triggers agent fan-out.
func UpsertRoomRelayRound(roomID string) *RelayRound {
	r := &RelayRound{
		RoundID:   uuid.NewString(),
		RoomID:    roomID,
		StartedAt: time.Now(),
		Status:    "active",
	}
	relayMu.Lock()
	relayRounds[roomID] = r
	relayMu.Unlock()
	return r
}

// GetRoomRelayRound returns the active relay round for a room, or nil.
func GetRoomRelayRound(roomID string) *RelayRound {
	relayMu.Lock()
	defer relayMu.Unlock()
	r, ok := relayRounds[roomID]
	if !ok {
		return nil
	}
	return r
}

// ClearRoomRelayRound removes the relay round for a room.
func ClearRoomRelayRound(roomID string) {
	relayMu.Lock()
	delete(relayRounds, roomID)
	relayMu.Unlock()
}

// RoomEventPublisher 让 EnqueueRoomChatTasks 在 task 完成后推送 room:message 事件。
// handler.Handler 实现此接口，service 层不依赖 handler 包。
type RoomEventPublisher interface {
	PublishRoomMessage(workspaceID string, agentID string, payload protocol.RoomMessagePayload)
}

// RoomChatEnqueuer 是 TaskService 在客厅场景的对外接口。
type RoomChatEnqueuer interface {
	EnqueueRoomChatTasks(
		ctx context.Context,
		q *db.Queries,
		room db.Room,
		triggerMsg db.RoomMessage,
		userID string,
		workspaceID string,
		pub RoomEventPublisher,
	) error
}

// EnqueueRoomChatTasks 处理客厅消息发言触发 agent 回复的入口。
//
// 用户拍板决策 A：单 @某个 agent 也走 council broadcast context（强制短回复 + 角色视角）。
//
// 内部流程：
//  1. 查 room_member 得到 active agent 列表
//  2. 根据 triggerMsg.Mentions 决定接力目标
//     - 无 mentions → 所有 active agent 参与接力
//     - 包含 "all" → 所有 active agent 参与接力
//     - 包含特定 agent_id → 仅被 @ 的 agent 参与接力
//  3. 只为第一位目标 agent 创建开场任务，后续由 salon relay 串行接力
//  4. 构建 CouncilBroadcastContext（复用已有 council salon 格式）
//  5. 调用 EnqueueFreshChatTaskForAgent 复用现有任务通路（daemon 不知道 room 存在）
func (s *TaskService) EnqueueRoomChatTasks(
	ctx context.Context,
	q *db.Queries,
	room db.Room,
	triggerMsg db.RoomMessage,
	userID string,
	workspaceID string,
	pub RoomEventPublisher,
) error {
	// 1. 查出所有 active agent 成员
	agentMembers, err := q.ListActiveRoomAgents(ctx, room.ID)
	if err != nil {
		return fmt.Errorf("list active room agents: %w", err)
	}
	if len(agentMembers) == 0 {
		// Write a system message so the user isn't left wondering why no one
		// replied. Before this fix the function returned nil silently.
		writeSystemRoomMessage(ctx, q, room, "茶水间还没有 Agent 成员，邀请几位加入后再聊天吧。")
		slog.Debug("room has no active agents, wrote system hint",
			"room_id", util.UUIDToString(room.ID))
		return nil
	}

	// 2. 根据 mentions 决定 fan-out 目标
	// triggerMsg.Mentions 存放 agent_id 字符串或 "all"
	mentionAll := len(triggerMsg.Mentions) == 0
	mentionSet := make(map[string]bool, len(triggerMsg.Mentions))
	for _, m := range triggerMsg.Mentions {
		if m == "all" {
			mentionAll = true
			break
		}
		mentionSet[m] = true
	}

	// 过滤出需要响应的 agent 成员
	var targetMembers []db.RoomMember
	for _, am := range agentMembers {
		agentIDStr := util.UUIDToString(am.MemberID)
		if mentionAll || mentionSet[agentIDStr] {
			targetMembers = append(targetMembers, am)
		}
	}
	if len(targetMembers) == 0 {
		writeSystemRoomMessage(ctx, q, room, "没有匹配到可接话的 Agent。试试 @ 一个具体的成员吧。")
		slog.Debug("no agents matched mentions in room fan-out",
			"room_id", util.UUIDToString(room.ID),
			"mentions", triggerMsg.Mentions)
		return nil
	}

	// 构建接力 roster。这里必须使用 targetMembers，而不是全 room 成员；
	// 否则单 @某个 agent 也会在后续 relay 中扩散到未被 @ 的成员。
	rosterInfo := make([]CouncilBroadcastMemberInfo, 0, len(targetMembers))
	agentByID := make(map[string]db.Agent, len(targetMembers))
	for _, am := range targetMembers {
		agent, err := q.GetAgent(ctx, am.MemberID)
		if err != nil {
			continue
		}
		if agent.ArchivedAt.Valid || !agent.RuntimeID.Valid {
			slog.Debug("room relay: skip archived/no-runtime agent",
				"agent_id", util.UUIDToString(am.MemberID))
			continue
		}
		rosterInfo = append(rosterInfo, CouncilBroadcastMemberInfo{
			AgentID: util.UUIDToString(am.MemberID),
			Name:    agent.Name,
			Role:    am.Role,
		})
		agentByID[util.UUIDToString(am.MemberID)] = agent
	}
	if len(rosterInfo) == 0 {
		writeSystemRoomMessage(ctx, q, room, "茶水间成员的 Agent 均已离线或归档，暂时无法接话。")
		slog.Debug("room relay: no target agents could be loaded",
			"room_id", util.UUIDToString(room.ID))
		return nil
	}

	userUUID, err := util.ParseUUID(userID)
	if err != nil {
		return fmt.Errorf("parse user id %q: %w", userID, err)
	}

	openerID := rosterInfo[0].AgentID
	agent, ok := agentByID[openerID]
	if !ok {
		return fmt.Errorf("room relay: opener agent %s was not loaded", openerID)
	}
	var opener db.RoomMember
	for _, am := range targetMembers {
		if util.UUIDToString(am.MemberID) == openerID {
			opener = am
			break
		}
	}

	// 3. create relay round so the frontend can show "relaying in progress".
	_ = UpsertRoomRelayRound(util.UUIDToString(room.ID))

	// 4. find-or-create ephemeral room internal chat_session for the opener.
	chatSession, err := s.findOrCreateRoomInternalSession(ctx, q, room, opener.MemberID, userUUID)
	if err != nil {
		ClearRoomRelayRound(util.UUIDToString(room.ID))
		return fmt.Errorf("room relay: opener session create failed: %w", err)
	}

	// 5. Ensure the trigger message reaches the model even when the internal
	// chat_session has no prior messages. Without this the daemon would
	// reject the prompt with "chat history has no user message".
	if _, err := q.CreateChatMessage(ctx, db.CreateChatMessageParams{
		ChatSessionID: chatSession.ID,
		Role:          "user",
		Content:       triggerMsg.Content,
	}); err != nil {
		slog.Warn("room relay: failed to write trigger message to chat_session",
			"chat_session_id", util.UUIDToString(chatSession.ID),
			"error", err)
		// Non-fatal: the context JSON still carries UserMessage; the daemon
		// may still be able to build a prompt without the chat_message row.
	}

	// 6. 构建 CouncilBroadcastContext，把 room 当 salon 对待。
	broadcastCtx := CouncilBroadcastContext{
		Type:             CouncilBroadcastContextType,
		CouncilSessionID: util.UUIDToString(room.ID), // room.ID 充当 council session id
		CouncilTopic:     room.Name,
		ChatSessionID:    util.UUIDToString(chatSession.ID),
		BroadcasterKind:  "user",
		BroadcasterName:  "用户",
		UserMessage:      triggerMsg.Content,
		Participants:     rosterInfo,
		SelfAgentID:      openerID,
		SelfAgentName:    agent.Name,
		Role:             CouncilBroadcastRoleSalon,
		TurnIndex:        1,
		MaxTurns:         len(rosterInfo),
		PersonaOverride:  roomPersonaOverride(ctx, q, util.UUIDToString(room.ID), openerID),
	}
	contextJSON, err := json.Marshal(broadcastCtx)
	if err != nil {
		return fmt.Errorf("room relay: marshal broadcast context: %w", err)
	}

	// 5. Room/salon prompt must not inherit old daemon sessions that may
	// contain council or CLI workflow instructions from earlier task shapes.
	if _, err = s.EnqueueFreshChatTaskForAgent(ctx, chatSession, opener.MemberID, contextJSON); err != nil {
		return fmt.Errorf("room relay: enqueue opening task: %w", err)
	}

	slog.Info("room chat opening task enqueued",
		"room_id", util.UUIDToString(room.ID),
		"agent_id", util.UUIDToString(opener.MemberID),
		"chat_session_id", util.UUIDToString(chatSession.ID),
		"target_count", len(rosterInfo),
	)
	return nil
}

// findOrCreateRoomInternalSession 查找或创建 room 内部 ephemeral chat_session。
// 每个 (room, agent) 维持一个 active session，避免重复创建。
func (s *TaskService) findOrCreateRoomInternalSession(
	ctx context.Context,
	q *db.Queries,
	room db.Room,
	agentID pgtype.UUID,
	creatorID pgtype.UUID,
) (db.ChatSession, error) {
	// 先查已存在的 session
	existing, err := q.GetRoomInternalChatSession(ctx, db.GetRoomInternalChatSessionParams{
		RoomID:  room.ID,
		AgentID: agentID,
	})
	if err == nil {
		return existing, nil
	}
	if err != pgx.ErrNoRows {
		return db.ChatSession{}, fmt.Errorf("get room internal session: %w", err)
	}

	// 不存在则创建
	session, err := q.CreateRoomInternalChatSession(ctx, db.CreateRoomInternalChatSessionParams{
		WorkspaceID: room.WorkspaceID,
		AgentID:     agentID,
		CreatorID:   creatorID,
		Title:       "客厅会话：" + room.Name,
		RoomID:      room.ID,
	})
	if err != nil {
		return db.ChatSession{}, fmt.Errorf("create room internal session: %w", err)
	}
	return session, nil
}

// maybeWriteRoomMessage 在 CompleteTask 路径中被调用：
// 如果 task 关联的 chat_session 是 is_room_internal=TRUE，则将 agent 回复
// 同步写入 room_message 表，并推送 room:message ws 事件给 workspace 订阅者。
// 失败只打日志，不影响 CompleteTask 主路径。
func (s *TaskService) maybeWriteRoomMessage(ctx context.Context, task db.AgentTaskQueue, chatMsg db.ChatMessage) {
	if !task.ChatSessionID.Valid {
		return
	}
	session, err := s.Queries.GetChatSession(ctx, task.ChatSessionID)
	if err != nil || !session.IsRoomInternal || !session.RoomID.Valid {
		return
	}

	// 写 room_message 行
	roomMsg, err := s.Queries.CreateRoomMessage(ctx, db.CreateRoomMessageParams{
		RoomID:       session.RoomID,
		SenderType:   "agent",
		SenderID:     task.AgentID,
		Content:      chatMsg.Content,
		Mentions:     []string{},
		IsAutonomous: false,
	})
	if err != nil {
		slog.Warn("maybeWriteRoomMessage: failed to write room_message",
			"chat_session_id", util.UUIDToString(task.ChatSessionID),
			"room_id", util.UUIDToString(session.RoomID),
			"error", err)
		return
	}

	// touch room last_active_at
	if err := s.Queries.TouchRoomActiveAt(ctx, session.RoomID); err != nil {
		slog.Warn("maybeWriteRoomMessage: failed to touch room active_at",
			"room_id", util.UUIDToString(session.RoomID), "error", err)
	}

	// Clear the relay round — the agent has replied, so the room is no
	// longer in an active relay state. Future salon rounds triggered by the
	// same relay chain will re-create the round via UpsertRoomRelayRound.
	ClearRoomRelayRound(util.UUIDToString(session.RoomID))

	// 推 room:message ws 事件
	workspaceID := s.ResolveTaskWorkspaceID(ctx, task)
	agentIDStr := util.UUIDToString(task.AgentID)

	// 尝试加载 agent 名称供前端显示
	agentName := ""
	if agent, err := s.Queries.GetAgent(ctx, task.AgentID); err == nil {
		agentName = agent.Name
	}

	s.Bus.Publish(events.Event{
		Type:        protocol.EventRoomMessage,
		WorkspaceID: workspaceID,
		ActorType:   "agent",
		ActorID:     agentIDStr,
		Payload: protocol.RoomMessagePayload{
			RoomID:       util.UUIDToString(session.RoomID),
			MessageID:    util.UUIDToString(roomMsg.ID),
			SenderType:   "agent",
			SenderID:     agentIDStr,
			SenderName:   agentName,
			Content:      chatMsg.Content,
			IsAutonomous: false,
			CreatedAt:    util.TimestampToString(roomMsg.CreatedAt),
		},
	})

	slog.Info("room message written after agent task complete",
		"room_id", util.UUIDToString(session.RoomID),
		"agent_id", agentIDStr,
		"room_message_id", util.UUIDToString(roomMsg.ID),
	)
}

// writeSystemRoomMessage writes a system-prefixed room_message so the user
// sees corrective guidance (e.g. "no agents available") instead of silence.
func writeSystemRoomMessage(ctx context.Context, q *db.Queries, room db.Room, content string) {
	senderID := room.WorkspaceID // system messages borrow workspace ID as sender
	if _, err := q.CreateRoomMessage(ctx, db.CreateRoomMessageParams{
		RoomID:       room.ID,
		SenderType:   "system",
		SenderID:     senderID,
		Content:      content,
		Mentions:     []string{},
		IsAutonomous: true,
	}); err != nil {
		slog.Warn("writeSystemRoomMessage: failed",
			"room_id", util.UUIDToString(room.ID), "error", err)
	}
	// Touch room so the frontend picks up the new message on next poll.
	if err := q.TouchRoomActiveAt(ctx, room.ID); err != nil {
		slog.Warn("writeSystemRoomMessage: touch failed",
			"room_id", util.UUIDToString(room.ID), "error", err)
	}
}
