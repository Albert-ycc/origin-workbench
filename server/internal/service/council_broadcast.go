package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/multica-ai/multica/server/internal/events"
	"github.com/multica-ai/multica/server/internal/util"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
	"github.com/multica-ai/multica/server/pkg/protocol"
)

// CouncilBroadcastContext is attached to chat tasks produced by the @全体
// relay. It carries everything the daemon prompt builder needs to render
// either the LEAD opening or a FOLLOWER pickup, plus enough roster context
// for the agent to reference teammates by name.
//
// The relay used to be a parallel fan-out (every member got a task at once
// and answered in their own voice). 2026-05-21 we switched to a serial
// chairperson model — see buildCouncilBroadcastPrompt and
// handleCouncilBroadcastRelay for the full shape.
type CouncilBroadcastContext struct {
	Type             string                       `json:"type"`
	CouncilSessionID string                       `json:"council_session_id"` // council UUID or team UUID (depends on SourceKind)
	CouncilTopic     string                       `json:"council_topic"`
	ChatSessionID    string                       `json:"chat_session_id"`
	BroadcasterKind  string                       `json:"broadcaster_kind"` // "user" or "agent"
	BroadcasterName  string                       `json:"broadcaster_name"`
	UserMessage      string                       `json:"user_message"`
	Participants     []CouncilBroadcastMemberInfo `json:"participants,omitempty"`
	SelfAgentID      string                       `json:"self_agent_id"`
	SelfAgentName    string                       `json:"self_agent_name"`
	Role             string                       `json:"role"`                  // "lead" / "follower" / "salon_speaker"
	SourceKind       string                       `json:"source_kind,omitempty"` // "council" or "team" — drives the chain handler
	PriorSpeakerName string                       `json:"prior_speaker_name,omitempty"`
	// RelayGeneration 是链代数，由 RegisterCouncilSession 分配。daemon 端忽略；
	// handleCouncilBroadcastRelay 用它比对当前句柄，旧链（被重复 @全体 取代）
	// 在下一轮推进前据此停止。
	RelayGeneration int64 `json:"relay_generation,omitempty"`
	// Salon 模式专用：当前是第几轮发言（1-based）+ 总轮数上限。
	// 调度器无状态，靠 payload 流转保留循环计数。
	TurnIndex int `json:"turn_index,omitempty"`
	MaxTurns  int `json:"max_turns,omitempty"`
	// Salon transcript：把前几轮的发言原文打包到任务 payload，让发言 agent
	// 知道队友说过什么。daemon 子进程跑 claude 时是新 session，看不到表里
	// 别人写的 chat_message，必须通过 prompt 注入。
	Transcript []CouncilSalonTurn `json:"transcript,omitempty"`
	// PersonaOverride is the room's per-agent persona customization
	// (room_agent_persona.persona_override JSONB), carried through the daemon
	// and injected as the highest-priority persona layer. Populated by the
	// room relay path only; council / team broadcasts leave it nil.
	PersonaOverride map[string]any `json:"persona_override,omitempty"`
}

// CouncilSalonTurn 是 salon 模式 transcript 的一条发言，按 timeline 顺序流转。
type CouncilSalonTurn struct {
	Speaker string `json:"speaker"`
	Content string `json:"content"`
}

// CouncilBroadcastMemberInfo is the lightweight roster row injected into the
// daemon task so each participant can see who else is in the room without
// pulling another query.
type CouncilBroadcastMemberInfo struct {
	AgentID string `json:"agent_id"`
	Name    string `json:"name"`
	Role    string `json:"role"`
}

// CouncilBroadcastContextType marks a chat task as part of a Council @全体
// relay (either the lead opening or a follower pickup).
const CouncilBroadcastContextType = "council_broadcast"

// CouncilBroadcastRoleLead / CouncilBroadcastRoleFollower are the two phases
// of the relay. Defined as constants so the chain handler in task.go can
// branch on them without typos.
const (
	CouncilBroadcastRoleLead     = "lead"
	CouncilBroadcastRoleFollower = "follower"
	// Salon 模式下每一轮发言者统一 Role，循环到 MaxTurns 截止。
	CouncilBroadcastRoleSalon = "salon_speaker"
)

// CouncilSessionModeSalon 是 council_session.mode 的 salon 取值（与 migration 086 对齐）。
const (
	CouncilSessionModeRelay = "relay"
	CouncilSessionModeSalon = "salon"
)

// CouncilBroadcastSourceCouncil / CouncilBroadcastSourceTeam tell the chain
// handler which roster query to use when enqueuing the follower.
const (
	CouncilBroadcastSourceCouncil = "council"
	CouncilBroadcastSourceTeam    = "team"
)

// CouncilBroadcastResult is what the handler returns after the lead enqueue
// so the HTTP layer can surface a coherent "we kicked off the room" response.
// Tasks length is 1 in the new relay shape (only the lead is enqueued
// synchronously; the follower is enqueued from the lead's completion hook).
type CouncilBroadcastResult struct {
	CouncilSessionID string
	Tasks            []db.AgentTaskQueue
	SkippedAgentIDs  []string
}

// CouncilBroadcastSource identifies which roster supplied the relay targets.
type CouncilBroadcastSource struct {
	Kind  string // "council" or "team"
	ID    pgtype.UUID
	Topic string // council.topic or team.name
}

// broadcastRelayKey 构造 relay 链在 councilCancels 里的唯一 key。
// SourceKind + sessionID 组合保证 council 与 team 会话（都是 UUID）不撞 key。
func broadcastRelayKey(sourceKind, sessionID string) string {
	return sourceKind + ":" + sessionID
}

// broadcastRelayEvent 发布 council relay 生命周期事件（relay_started /
// relay_turn_completed / relay_finished）。workspace 从 task 解析，payload
// 带当轮发言人信息；前端按 council_session_id 路由渲染接力状态。
func (s *TaskService) broadcastRelayEvent(ctx context.Context, eventType string, task db.AgentTaskQueue, bc CouncilBroadcastContext) {
	workspaceID := s.ResolveTaskWorkspaceID(ctx, task)
	if workspaceID == "" {
		return
	}
	s.Bus.Publish(events.Event{
		Type:          eventType,
		WorkspaceID:   workspaceID,
		ActorType:     "agent",
		ActorID:       bc.SelfAgentID,
		ChatSessionID: bc.ChatSessionID,
		Payload: protocol.CouncilRelayPayload{
			CouncilSessionID: bc.CouncilSessionID,
			ChatSessionID:    bc.ChatSessionID,
			Role:             bc.Role,
			SpeakerAgentID:   bc.SelfAgentID,
			SpeakerName:      bc.SelfAgentName,
			TurnIndex:        bc.TurnIndex,
			MaxTurns:         bc.MaxTurns,
			PriorSpeakerName: bc.PriorSpeakerName,
		},
	})
}

// finishCouncilRelay 链自然结束：移除句柄并推送 relay_finished。链结束的
// 四种形态——follower 收尾、salon 到 MaxTurns、无下一棒可接、enqueue 出错。
func (s *TaskService) finishCouncilRelay(ctx context.Context, task db.AgentTaskQueue, bc CouncilBroadcastContext) {
	s.deregisterCouncilSession(broadcastRelayKey(bc.SourceKind, bc.CouncilSessionID))
	s.broadcastRelayEvent(ctx, protocol.EventCouncilRelayFinished, task, bc)
}

// EnqueueCouncilBroadcastTasks kicks off a Council relay: it loads the
// council roster, picks the lead (convener if any, else first participant),
// and enqueues exactly ONE chat task for the lead. The follower is NOT
// enqueued here — it lands later from handleCouncilBroadcastRelay when the
// lead's assistant message is recorded.
func (s *TaskService) EnqueueCouncilBroadcastTasks(
	ctx context.Context,
	chatSession db.ChatSession,
	council db.CouncilSession,
	userMessage string,
	broadcasterKind string,
	broadcasterID string,
	broadcasterName string,
) (CouncilBroadcastResult, error) {
	source := CouncilBroadcastSource{
		Kind:  CouncilBroadcastSourceCouncil,
		ID:    council.ID,
		Topic: council.Topic,
	}
	// 注册 relay 链句柄并拿带取消的 ctx：同一 council 在 relay 进行中再次
	// @全体 时新链会覆盖旧句柄（RegisterCouncilSession 语义），旧链靠链代数
	// 感知被取代而停止，后续链由 handleCouncilBroadcastRelay 检查句柄状态
	// 决定是否推进。
	sessionID := util.UUIDToString(council.ID)
	ctx = s.RegisterCouncilSession(
		CouncilBroadcastSourceCouncil,
		sessionID,
		util.UUIDToString(chatSession.ID),
		util.UUIDToString(chatSession.WorkspaceID),
	)

	rosterInfo, rosterAgents, skipped, err := s.loadCouncilRoster(ctx, council.ID)
	if err != nil {
		return CouncilBroadcastResult{CouncilSessionID: sessionID}, err
	}
	// Salon 模式（圆桌客厅）：开场任意一人发言，由 handleCouncilBroadcastRelay
	// 串行轮转直到 MaxTurns；区别于 relay 的 lead/follower 二段固定结构。
	if council.Mode == CouncilSessionModeSalon {
		maxTurns := int(council.MaxTurns)
		if maxTurns <= 0 {
			maxTurns = 8
		}
		return s.enqueueSalonOpening(
			ctx,
			chatSession,
			source,
			rosterInfo,
			rosterAgents,
			skipped,
			userMessage,
			broadcasterKind,
			broadcasterID,
			broadcasterName,
			maxTurns,
		)
	}
	return s.enqueueBroadcastLead(
		ctx,
		chatSession,
		source,
		rosterInfo,
		rosterAgents,
		skipped,
		userMessage,
		broadcasterKind,
		broadcasterID,
		broadcasterName,
		council.ConvenerAgentID,
	)
}

// EnqueueTeamBroadcastTasks does the same for the team chat path. Lead is
// the team captain.
func (s *TaskService) EnqueueTeamBroadcastTasks(
	ctx context.Context,
	chatSession db.ChatSession,
	team db.Team,
	userMessage string,
	broadcasterKind string,
	broadcasterID string,
	broadcasterName string,
) (CouncilBroadcastResult, error) {
	source := CouncilBroadcastSource{
		Kind:  CouncilBroadcastSourceTeam,
		ID:    team.ID,
		Topic: team.Name,
	}
	// 与 council 同一条 relay 链机制：注册句柄并拿带取消的 ctx，保证
	// team 会话的链也能被 Adjourn / 单任务取消穿透。
	sessionID := util.UUIDToString(team.ID)
	ctx = s.RegisterCouncilSession(
		CouncilBroadcastSourceTeam,
		sessionID,
		util.UUIDToString(chatSession.ID),
		util.UUIDToString(chatSession.WorkspaceID),
	)

	rosterInfo, rosterAgents, skipped, err := s.loadTeamRoster(ctx, team.ID)
	if err != nil {
		return CouncilBroadcastResult{CouncilSessionID: sessionID}, err
	}
	return s.enqueueBroadcastLead(
		ctx,
		chatSession,
		source,
		rosterInfo,
		rosterAgents,
		skipped,
		userMessage,
		broadcasterKind,
		broadcasterID,
		broadcasterName,
		team.CaptainAgentID,
	)
}

func (s *TaskService) loadCouncilRoster(ctx context.Context, councilID pgtype.UUID) ([]CouncilBroadcastMemberInfo, map[string]db.Agent, []string, error) {
	participants, err := s.Queries.ListCouncilSessionParticipants(ctx, councilID)
	if err != nil {
		return nil, nil, nil, fmt.Errorf("list council participants: %w", err)
	}
	rosterInfo := make([]CouncilBroadcastMemberInfo, 0, len(participants))
	rosterAgents := make(map[string]db.Agent, len(participants))
	skipped := []string{}
	for _, p := range participants {
		if p.LeftAt.Valid {
			continue
		}
		agent, err := s.Queries.GetAgent(ctx, p.AgentID)
		if err != nil {
			slog.Warn("broadcast: skip participant — agent load failed",
				"council_session_id", util.UUIDToString(councilID),
				"agent_id", util.UUIDToString(p.AgentID),
				"error", err)
			continue
		}
		if agent.ArchivedAt.Valid || !agent.RuntimeID.Valid {
			skipped = append(skipped, util.UUIDToString(p.AgentID))
			continue
		}
		rosterAgents[util.UUIDToString(p.AgentID)] = agent
		rosterInfo = append(rosterInfo, CouncilBroadcastMemberInfo{
			AgentID: util.UUIDToString(p.AgentID),
			Name:    agent.Name,
			Role:    p.Role,
		})
	}
	return rosterInfo, rosterAgents, skipped, nil
}

func (s *TaskService) loadTeamRoster(ctx context.Context, teamID pgtype.UUID) ([]CouncilBroadcastMemberInfo, map[string]db.Agent, []string, error) {
	members, err := s.Queries.ListTeamMembers(ctx, teamID)
	if err != nil {
		return nil, nil, nil, fmt.Errorf("list team members: %w", err)
	}
	rosterInfo := make([]CouncilBroadcastMemberInfo, 0, len(members))
	rosterAgents := make(map[string]db.Agent, len(members))
	skipped := []string{}
	for _, m := range members {
		agent, err := s.Queries.GetAgent(ctx, m.AgentID)
		if err != nil {
			slog.Warn("broadcast: skip team member — agent load failed",
				"team_id", util.UUIDToString(teamID),
				"agent_id", util.UUIDToString(m.AgentID),
				"error", err)
			continue
		}
		if agent.ArchivedAt.Valid || !agent.RuntimeID.Valid {
			skipped = append(skipped, util.UUIDToString(m.AgentID))
			continue
		}
		role := m.Role
		if role == "" {
			role = "member"
		}
		rosterAgents[util.UUIDToString(m.AgentID)] = agent
		rosterInfo = append(rosterInfo, CouncilBroadcastMemberInfo{
			AgentID: util.UUIDToString(m.AgentID),
			Name:    agent.Name,
			Role:    role,
		})
	}
	return rosterInfo, rosterAgents, skipped, nil
}

// pickLeadInfo returns the roster entry that should open the room. Preference
// order: preferredLeadID (convener/captain) if in roster → first convener or
// captain by role → first roster entry.
func pickLeadInfo(roster []CouncilBroadcastMemberInfo, preferredLeadID pgtype.UUID) (CouncilBroadcastMemberInfo, bool) {
	if len(roster) == 0 {
		return CouncilBroadcastMemberInfo{}, false
	}
	if preferredLeadID.Valid {
		want := util.UUIDToString(preferredLeadID)
		for _, m := range roster {
			if m.AgentID == want {
				return m, true
			}
		}
	}
	for _, m := range roster {
		if m.Role == "convener" || m.Role == "captain" {
			return m, true
		}
	}
	return roster[0], true
}

// pickFollower returns the first roster entry that is not the lead and not
// the broadcaster (when the broadcaster is an agent).
func pickFollower(roster []CouncilBroadcastMemberInfo, leadAgentID, broadcasterAgentID string) (CouncilBroadcastMemberInfo, bool) {
	for _, m := range roster {
		if m.AgentID == leadAgentID {
			continue
		}
		if broadcasterAgentID != "" && m.AgentID == broadcasterAgentID {
			continue
		}
		return m, true
	}
	return CouncilBroadcastMemberInfo{}, false
}

func (s *TaskService) enqueueBroadcastLead(
	ctx context.Context,
	chatSession db.ChatSession,
	source CouncilBroadcastSource,
	rosterInfo []CouncilBroadcastMemberInfo,
	rosterAgents map[string]db.Agent,
	skipped []string,
	userMessage string,
	broadcasterKind string,
	broadcasterID string,
	broadcasterName string,
	preferredLeadID pgtype.UUID,
) (CouncilBroadcastResult, error) {
	result := CouncilBroadcastResult{
		CouncilSessionID: util.UUIDToString(source.ID),
		SkippedAgentIDs:  append([]string{}, skipped...),
	}
	if len(rosterInfo) == 0 {
		return result, fmt.Errorf("%s has no eligible participants for broadcast", source.Kind)
	}

	lead, ok := pickLeadInfo(rosterInfo, preferredLeadID)
	if !ok {
		return result, fmt.Errorf("%s has no eligible lead for broadcast", source.Kind)
	}

	broadcasterName = strings.TrimSpace(broadcasterName)
	if broadcasterName == "" {
		if broadcasterKind == "agent" {
			if a, ok := rosterAgents[broadcasterID]; ok {
				broadcasterName = a.Name
			}
		}
		if broadcasterName == "" {
			broadcasterName = "用户"
		}
	}

	leadAgent := rosterAgents[lead.AgentID]
	payload := CouncilBroadcastContext{
		Type:             CouncilBroadcastContextType,
		CouncilSessionID: util.UUIDToString(source.ID),
		CouncilTopic:     source.Topic,
		ChatSessionID:    util.UUIDToString(chatSession.ID),
		BroadcasterKind:  broadcasterKind,
		BroadcasterName:  broadcasterName,
		UserMessage:      userMessage,
		Participants:     rosterInfo,
		SelfAgentID:      lead.AgentID,
		SelfAgentName:    lead.Name,
		Role:             CouncilBroadcastRoleLead,
		SourceKind:       source.Kind,
	}
	if h := relayHandleFromCtx(ctx); h != nil {
		payload.RelayGeneration = h.generation
	}
	contextJSON, err := json.Marshal(payload)
	if err != nil {
		return result, fmt.Errorf("marshal lead broadcast context: %w", err)
	}

	task, err := s.EnqueueChatTaskForAgent(
		ctx,
		chatSession,
		pgtype.UUID{Bytes: leadAgent.ID.Bytes, Valid: true},
		contextJSON,
	)
	if err != nil {
		return result, fmt.Errorf("enqueue lead broadcast task: %w", err)
	}
	result.Tasks = append(result.Tasks, task)
	s.broadcastRelayEvent(ctx, protocol.EventCouncilRelayStarted, task, payload)

	slog.Info("broadcast relay: lead enqueued",
		"source_kind", source.Kind,
		"source_id", util.UUIDToString(source.ID),
		"chat_session_id", util.UUIDToString(chatSession.ID),
		"lead_agent_id", lead.AgentID,
		"lead_agent_name", lead.Name,
		"roster_size", len(rosterInfo),
		"broadcaster_kind", broadcasterKind,
	)
	return result, nil
}

// enqueueBroadcastFollower is called from the chat-task-complete hook after
// the LEAD finishes speaking. It enqueues exactly ONE chat task for the next
// speaker tagged with Role=follower and PriorSpeakerName set to the lead.
func (s *TaskService) enqueueBroadcastFollower(
	ctx context.Context,
	chatSession db.ChatSession,
	leadContext CouncilBroadcastContext,
) (db.AgentTaskQueue, bool, error) {
	follower, ok := pickFollower(leadContext.Participants, leadContext.SelfAgentID, "")
	if !ok {
		slog.Info("broadcast relay: no follower available, stopping after lead",
			"source_kind", leadContext.SourceKind,
			"chat_session_id", leadContext.ChatSessionID,
			"lead_agent_id", leadContext.SelfAgentID,
		)
		return db.AgentTaskQueue{}, false, nil
	}

	followerAgentUUID, err := util.ParseUUID(follower.AgentID)
	if err != nil || !followerAgentUUID.Valid {
		return db.AgentTaskQueue{}, false, fmt.Errorf("invalid follower agent id %q: %v", follower.AgentID, err)
	}

	payload := CouncilBroadcastContext{
		Type:             CouncilBroadcastContextType,
		CouncilSessionID: leadContext.CouncilSessionID,
		CouncilTopic:     leadContext.CouncilTopic,
		ChatSessionID:    leadContext.ChatSessionID,
		BroadcasterKind:  leadContext.BroadcasterKind,
		BroadcasterName:  leadContext.BroadcasterName,
		UserMessage:      leadContext.UserMessage,
		Participants:     leadContext.Participants,
		SelfAgentID:      follower.AgentID,
		SelfAgentName:    follower.Name,
		Role:             CouncilBroadcastRoleFollower,
		SourceKind:       leadContext.SourceKind,
		PriorSpeakerName: leadContext.SelfAgentName,
		RelayGeneration:  leadContext.RelayGeneration,
	}
	contextJSON, err := json.Marshal(payload)
	if err != nil {
		return db.AgentTaskQueue{}, false, fmt.Errorf("marshal follower broadcast context: %w", err)
	}

	task, err := s.EnqueueChatTaskForAgent(ctx, chatSession, followerAgentUUID, contextJSON)
	if err != nil {
		return db.AgentTaskQueue{}, false, fmt.Errorf("enqueue follower broadcast task: %w", err)
	}

	slog.Info("broadcast relay: follower enqueued",
		"source_kind", leadContext.SourceKind,
		"source_id", leadContext.CouncilSessionID,
		"chat_session_id", leadContext.ChatSessionID,
		"prior_speaker", leadContext.SelfAgentName,
		"follower_agent_id", follower.AgentID,
		"follower_agent_name", follower.Name,
	)
	return task, true, nil
}

// handleCouncilBroadcastRelay is called from the chat-task-complete path
// (right after the assistant message lands). When the just-finished task was
// a lead broadcast, it kicks off the follower. When the just-finished task
// was a follower broadcast, the relay stops. Salon turns continue round-robin
// until TurnIndex reaches MaxTurns. Any other task type → no-op.
func (s *TaskService) handleCouncilBroadcastRelay(ctx context.Context, task db.AgentTaskQueue) {
	if len(task.Context) == 0 || !task.ChatSessionID.Valid {
		return
	}
	var bc CouncilBroadcastContext
	if err := json.Unmarshal(task.Context, &bc); err != nil {
		return
	}
	if bc.Type != CouncilBroadcastContextType {
		return
	}

	// 每轮发言落库后推送 turn_completed（含末轮），前端据此渲染接力进度。
	s.broadcastRelayEvent(ctx, protocol.EventCouncilRelayTurnCompleted, task, bc)

	sessionKey := broadcastRelayKey(bc.SourceKind, bc.CouncilSessionID)
	// 链已被中止（用户取消任务 / council 休会 / 被重复 @全体 取代）：
	// 不再 enqueue 下一轮，cancelled 事件由取消路径推送过，这里直接停。
	if s.councilRelayCanceled(sessionKey, bc.RelayGeneration) {
		return
	}

	chatSession, err := s.Queries.GetChatSession(ctx, task.ChatSessionID)
	if err != nil {
		slog.Warn("broadcast relay: load chat session failed",
			"chat_session_id", util.UUIDToString(task.ChatSessionID),
			"error", err)
		return
	}
	switch bc.Role {
	case CouncilBroadcastRoleLead:
		if _, ok, err := s.enqueueBroadcastFollower(ctx, chatSession, bc); err != nil {
			slog.Warn("broadcast relay: follower enqueue failed",
				"chat_session_id", util.UUIDToString(task.ChatSessionID),
				"lead_agent_id", bc.SelfAgentID,
				"error", err)
			s.finishCouncilRelay(ctx, task, bc)
			return
		} else if !ok {
			// 无 follower 可接，lead 独白即链结束
			s.finishCouncilRelay(ctx, task, bc)
			return
		}
	case CouncilBroadcastRoleFollower:
		// follower 收尾即链自然结束
		s.finishCouncilRelay(ctx, task, bc)
	case CouncilBroadcastRoleSalon:
		if bc.TurnIndex >= bc.MaxTurns {
			slog.Info("salon relay: reached max_turns, room idle",
				"chat_session_id", util.UUIDToString(task.ChatSessionID),
				"turn_index", bc.TurnIndex,
				"max_turns", bc.MaxTurns,
			)
			s.finishCouncilRelay(ctx, task, bc)
			return
		}
		if _, ok, err := s.enqueueSalonNextTurn(ctx, chatSession, bc); err != nil {
			slog.Warn("salon relay: next turn enqueue failed",
				"chat_session_id", util.UUIDToString(task.ChatSessionID),
				"prior_speaker_id", bc.SelfAgentID,
				"turn_index", bc.TurnIndex,
				"error", err)
			s.finishCouncilRelay(ctx, task, bc)
			return
		} else if !ok {
			s.finishCouncilRelay(ctx, task, bc)
			return
		}
	}
}

// buildSalonTranscript 拉 chat_session 全部消息按时间顺序映射成 salon transcript。
// 用 roster 把 sender_agent_id 反查回 agent 名字；user 角色统一标 "用户"。
// 控制最多 transcript 长度，避免 payload 膨胀（保留最近 N 条）。
func (s *TaskService) buildSalonTranscript(
	ctx context.Context,
	chatSessionID pgtype.UUID,
	roster []CouncilBroadcastMemberInfo,
	broadcasterName string,
) []CouncilSalonTurn {
	const maxTranscriptTurns = 24
	messages, err := s.Queries.ListChatMessages(ctx, chatSessionID)
	if err != nil {
		slog.Warn("salon: list chat_message failed",
			"chat_session_id", util.UUIDToString(chatSessionID),
			"error", err)
		return nil
	}
	nameByID := make(map[string]string, len(roster))
	for _, m := range roster {
		nameByID[m.AgentID] = m.Name
	}
	turns := make([]CouncilSalonTurn, 0, len(messages))
	for _, msg := range messages {
		if msg.Role == "system" {
			continue
		}
		var speaker string
		switch msg.Role {
		case "user":
			speaker = broadcasterName
			if speaker == "" {
				speaker = "用户"
			}
		default:
			if msg.SenderAgentID.Valid {
				if name, ok := nameByID[util.UUIDToString(msg.SenderAgentID)]; ok && name != "" {
					speaker = name
				}
			}
			if speaker == "" {
				speaker = "成员"
			}
		}
		turns = append(turns, CouncilSalonTurn{
			Speaker: speaker,
			Content: msg.Content,
		})
	}
	if len(turns) > maxTranscriptTurns {
		turns = turns[len(turns)-maxTranscriptTurns:]
	}
	return turns
}

// pickSalonSpeaker 在 salon 模式下挑选当前发言者：避开上一位，按 roster 顺序
// round-robin。priorAgentID 为空时（开场轮）退化为「随便选第一个 eligible」。
func pickSalonSpeaker(roster []CouncilBroadcastMemberInfo, priorAgentID string) (CouncilBroadcastMemberInfo, bool) {
	if len(roster) == 0 {
		return CouncilBroadcastMemberInfo{}, false
	}
	if priorAgentID == "" {
		return roster[0], true
	}
	priorIdx := -1
	for i, m := range roster {
		if m.AgentID == priorAgentID {
			priorIdx = i
			break
		}
	}
	if priorIdx == -1 {
		return roster[0], true
	}
	// 下一位（wrap 回开头）。
	next := roster[(priorIdx+1)%len(roster)]
	return next, true
}

// roomAgentPersonaQuerier 是 roomPersonaOverride 依赖的最小查询面，
// *db.Queries 天然满足；测试用 fake 注入预设数据。
type roomAgentPersonaQuerier interface {
	GetRoomAgentPersona(ctx context.Context, arg db.GetRoomAgentPersonaParams) (db.RoomAgentPersona, error)
}

// roomPersonaOverride 按 (room_id, agent_id) 查 room_agent_persona 的
// persona_override，返回 map 形式注入 CouncilBroadcastContext.PersonaOverride。
// sessionID 传 CouncilSessionID：room 场景它即 room.ID，能查到该 agent 的
// override；council/team 场景它是 council/team UUID，查不到行，返回 nil。
// 查询/解析失败只记日志，不阻塞 relay 链。
func roomPersonaOverride(ctx context.Context, q roomAgentPersonaQuerier, sessionID, agentID string) map[string]any {
	if sessionID == "" || agentID == "" {
		return nil
	}
	roomUUID, err := util.ParseUUID(sessionID)
	if err != nil || !roomUUID.Valid {
		return nil
	}
	agentUUID, err := util.ParseUUID(agentID)
	if err != nil || !agentUUID.Valid {
		return nil
	}
	row, err := q.GetRoomAgentPersona(ctx, db.GetRoomAgentPersonaParams{
		RoomID:  roomUUID,
		AgentID: agentUUID,
	})
	if err != nil {
		if !errors.Is(err, pgx.ErrNoRows) {
			slog.Warn("room persona override lookup failed",
				"room_id", sessionID,
				"agent_id", agentID,
				"error", err)
		}
		return nil
	}
	if len(row.PersonaOverride) == 0 {
		return nil
	}
	var override map[string]any
	if err := json.Unmarshal(row.PersonaOverride, &override); err != nil {
		slog.Warn("room persona override unmarshal failed",
			"room_id", sessionID,
			"agent_id", agentID,
			"error", err)
		return nil
	}
	// 空 map 同样视为无覆盖，与 daemon 侧 len()==0 判据保持一致。
	if len(override) == 0 {
		return nil
	}
	return override
}

// enqueueSalonOpening 是 salon 模式的开场轮：选第一位发言者（优先 convener，
// 否则 roster[0]），TurnIndex=1。
func (s *TaskService) enqueueSalonOpening(
	ctx context.Context,
	chatSession db.ChatSession,
	source CouncilBroadcastSource,
	rosterInfo []CouncilBroadcastMemberInfo,
	rosterAgents map[string]db.Agent,
	skipped []string,
	userMessage string,
	broadcasterKind string,
	broadcasterID string,
	broadcasterName string,
	maxTurns int,
) (CouncilBroadcastResult, error) {
	result := CouncilBroadcastResult{
		CouncilSessionID: util.UUIDToString(source.ID),
		SkippedAgentIDs:  append([]string{}, skipped...),
	}
	if len(rosterInfo) == 0 {
		return result, fmt.Errorf("%s salon has no eligible participants", source.Kind)
	}
	if maxTurns < 2 {
		maxTurns = 2
	}
	if maxTurns > 24 {
		maxTurns = 24
	}

	opener, _ := pickSalonSpeaker(rosterInfo, "")
	broadcasterName = strings.TrimSpace(broadcasterName)
	if broadcasterName == "" {
		if broadcasterKind == "agent" {
			if a, ok := rosterAgents[broadcasterID]; ok {
				broadcasterName = a.Name
			}
		}
		if broadcasterName == "" {
			broadcasterName = "用户"
		}
	}

	openerAgent := rosterAgents[opener.AgentID]
	payload := CouncilBroadcastContext{
		Type:             CouncilBroadcastContextType,
		CouncilSessionID: util.UUIDToString(source.ID),
		CouncilTopic:     source.Topic,
		ChatSessionID:    util.UUIDToString(chatSession.ID),
		BroadcasterKind:  broadcasterKind,
		BroadcasterName:  broadcasterName,
		UserMessage:      userMessage,
		Participants:     rosterInfo,
		SelfAgentID:      opener.AgentID,
		SelfAgentName:    opener.Name,
		Role:             CouncilBroadcastRoleSalon,
		SourceKind:       source.Kind,
		TurnIndex:        1,
		MaxTurns:         maxTurns,
	}
	if h := relayHandleFromCtx(ctx); h != nil {
		payload.RelayGeneration = h.generation
	}
	contextJSON, err := json.Marshal(payload)
	if err != nil {
		return result, fmt.Errorf("marshal salon opening context: %w", err)
	}
	task, err := s.EnqueueFreshChatTaskForAgent(
		ctx,
		chatSession,
		pgtype.UUID{Bytes: openerAgent.ID.Bytes, Valid: true},
		contextJSON,
	)
	if err != nil {
		return result, fmt.Errorf("enqueue salon opening task: %w", err)
	}
	result.Tasks = append(result.Tasks, task)
	s.broadcastRelayEvent(ctx, protocol.EventCouncilRelayStarted, task, payload)

	slog.Info("salon relay: opening enqueued",
		"source_kind", source.Kind,
		"source_id", util.UUIDToString(source.ID),
		"chat_session_id", util.UUIDToString(chatSession.ID),
		"opener_agent_id", opener.AgentID,
		"opener_agent_name", opener.Name,
		"roster_size", len(rosterInfo),
		"max_turns", maxTurns,
	)
	return result, nil
}

// enqueueSalonNextTurn 由 handleCouncilBroadcastRelay 在 salon 上一轮完成时
// 触发：按 round-robin 选下一位，TurnIndex+1。
func (s *TaskService) enqueueSalonNextTurn(
	ctx context.Context,
	chatSession db.ChatSession,
	prior CouncilBroadcastContext,
) (db.AgentTaskQueue, bool, error) {
	next, ok := pickSalonSpeaker(prior.Participants, prior.SelfAgentID)
	if !ok {
		return db.AgentTaskQueue{}, false, nil
	}
	nextAgentUUID, err := util.ParseUUID(next.AgentID)
	if err != nil || !nextAgentUUID.Valid {
		return db.AgentTaskQueue{}, false, fmt.Errorf("invalid salon next agent id %q: %v", next.AgentID, err)
	}
	transcript := s.buildSalonTranscript(ctx, chatSession.ID, prior.Participants, prior.BroadcasterName)

	payload := CouncilBroadcastContext{
		Type:             CouncilBroadcastContextType,
		CouncilSessionID: prior.CouncilSessionID,
		CouncilTopic:     prior.CouncilTopic,
		ChatSessionID:    prior.ChatSessionID,
		BroadcasterKind:  prior.BroadcasterKind,
		BroadcasterName:  prior.BroadcasterName,
		UserMessage:      prior.UserMessage,
		Participants:     prior.Participants,
		SelfAgentID:      next.AgentID,
		SelfAgentName:    next.Name,
		Role:             CouncilBroadcastRoleSalon,
		SourceKind:       prior.SourceKind,
		PriorSpeakerName: prior.SelfAgentName,
		TurnIndex:        prior.TurnIndex + 1,
		MaxTurns:         prior.MaxTurns,
		RelayGeneration:  prior.RelayGeneration,
		Transcript:       transcript,
		PersonaOverride:  roomPersonaOverride(ctx, s.Queries, prior.CouncilSessionID, next.AgentID),
	}
	contextJSON, err := json.Marshal(payload)
	if err != nil {
		return db.AgentTaskQueue{}, false, fmt.Errorf("marshal salon next-turn context: %w", err)
	}
	task, err := s.EnqueueFreshChatTaskForAgent(ctx, chatSession, nextAgentUUID, contextJSON)
	if err != nil {
		return db.AgentTaskQueue{}, false, fmt.Errorf("enqueue salon next-turn task: %w", err)
	}

	slog.Info("salon relay: next turn enqueued",
		"source_kind", prior.SourceKind,
		"source_id", prior.CouncilSessionID,
		"chat_session_id", prior.ChatSessionID,
		"prior_speaker", prior.SelfAgentName,
		"next_agent_id", next.AgentID,
		"next_agent_name", next.Name,
		"turn_index", payload.TurnIndex,
		"max_turns", payload.MaxTurns,
	)
	return task, true, nil
}
