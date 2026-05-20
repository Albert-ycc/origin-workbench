package service

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/multica-ai/multica/server/internal/events"
	"github.com/multica-ai/multica/server/internal/util"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
	"github.com/multica-ai/multica/server/pkg/protocol"
)

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
//  2. 根据 triggerMsg.Mentions 决定 fan-out 目标
//     - 包含 "all" → 所有 active agent 响应
//     - 包含特定 agent_id → 仅被 @ 的 agent 响应
//  3. 对每个目标 agent，find-or-create ephemeral chat_session（is_room_internal=true）
//  4. 构建 CouncilBroadcastContext（复用已有 council fan-out 格式）
//  5. 调用 EnqueueChatTaskForAgent 复用现有任务通路（daemon 不知道 room 存在）
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
		slog.Debug("room has no active agents, skip fan-out",
			"room_id", util.UUIDToString(room.ID))
		return nil
	}

	// 2. 根据 mentions 决定 fan-out 目标
	// triggerMsg.Mentions 存放 agent_id 字符串或 "all"
	mentionAll := false
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
		slog.Debug("no agents matched mentions in room fan-out",
			"room_id", util.UUIDToString(room.ID),
			"mentions", triggerMsg.Mentions)
		return nil
	}

	// 构建 roster 信息（让每个 agent 的 broadcast context 知道"客厅里还有谁"）
	rosterInfo := make([]CouncilBroadcastMemberInfo, 0, len(agentMembers))
	for _, am := range agentMembers {
		agent, err := q.GetAgent(ctx, am.MemberID)
		if err != nil {
			continue
		}
		rosterInfo = append(rosterInfo, CouncilBroadcastMemberInfo{
			AgentID: util.UUIDToString(am.MemberID),
			Name:    agent.Name,
			Role:    am.Role,
		})
	}

	userUUID, err := util.ParseUUID(userID)
	if err != nil {
		return fmt.Errorf("parse user id %q: %w", userID, err)
	}

	var failCount int
	for _, am := range targetMembers {
		agent, err := q.GetAgent(ctx, am.MemberID)
		if err != nil {
			slog.Warn("room fan-out: skip agent — load failed",
				"room_id", util.UUIDToString(room.ID),
				"agent_id", util.UUIDToString(am.MemberID),
				"error", err)
			failCount++
			continue
		}
		if agent.ArchivedAt.Valid || !agent.RuntimeID.Valid {
			slog.Debug("room fan-out: skip archived/no-runtime agent",
				"agent_id", util.UUIDToString(am.MemberID))
			continue
		}

		// 3. find-or-create ephemeral room internal chat_session
		chatSession, err := s.findOrCreateRoomInternalSession(ctx, q, room, am.MemberID, userUUID)
		if err != nil {
			slog.Warn("room fan-out: skip agent — session create failed",
				"room_id", util.UUIDToString(room.ID),
				"agent_id", util.UUIDToString(am.MemberID),
				"error", err)
			failCount++
			continue
		}

		// 4. 构建 CouncilBroadcastContext，把 room 当 council 对待
		broadcastCtx := CouncilBroadcastContext{
			Type:             CouncilBroadcastContextType,
			CouncilSessionID: util.UUIDToString(room.ID), // room.ID 充当 council session id
			CouncilTopic:     room.Name,
			ChatSessionID:    util.UUIDToString(chatSession.ID),
			BroadcasterKind:  "user",
			BroadcasterName:  "用户",
			UserMessage:      triggerMsg.Content,
			Participants:     rosterInfo,
			SelfAgentID:      util.UUIDToString(am.MemberID),
			SelfAgentName:    agent.Name,
		}
		contextJSON, err := json.Marshal(broadcastCtx)
		if err != nil {
			slog.Warn("room fan-out: marshal broadcast context failed",
				"agent_id", util.UUIDToString(am.MemberID),
				"error", err)
			failCount++
			continue
		}

		// 5. 复用 EnqueueChatTaskForAgent，daemon 协议完全不变
		_, err = s.EnqueueChatTaskForAgent(ctx, chatSession, am.MemberID, contextJSON)
		if err != nil {
			slog.Warn("room fan-out: enqueue task failed",
				"room_id", util.UUIDToString(room.ID),
				"agent_id", util.UUIDToString(am.MemberID),
				"error", err)
			failCount++
			continue
		}

		slog.Info("room chat task enqueued",
			"room_id", util.UUIDToString(room.ID),
			"agent_id", util.UUIDToString(am.MemberID),
			"chat_session_id", util.UUIDToString(chatSession.ID),
		)
	}

	if failCount > 0 {
		return fmt.Errorf("room fan-out: %d/%d targets failed", failCount, len(targetMembers))
	}
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
