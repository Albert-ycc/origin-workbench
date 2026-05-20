package service

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"strings"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/multica-ai/multica/server/internal/util"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

// CouncilBroadcastContext is attached to every fan-out chat task produced when
// a user (or another participant) addresses a Council session with @全体. It
// lets the daemon prompt builder switch into "broadcast reply" mode so each
// participant answers in one short voice, instead of one captain trying to
// represent the whole roster.
type CouncilBroadcastContext struct {
	Type             string                       `json:"type"`
	CouncilSessionID string                       `json:"council_session_id"`
	CouncilTopic     string                       `json:"council_topic"`
	ChatSessionID    string                       `json:"chat_session_id"`
	BroadcasterKind  string                       `json:"broadcaster_kind"` // "user" or "agent"
	BroadcasterName  string                       `json:"broadcaster_name"`
	UserMessage      string                       `json:"user_message"`
	Participants     []CouncilBroadcastMemberInfo `json:"participants,omitempty"`
	SelfAgentID      string                       `json:"self_agent_id"`
	SelfAgentName    string                       `json:"self_agent_name"`
}

// CouncilBroadcastMemberInfo is the lightweight roster row injected into the
// daemon task so each participant can see who else is in the room without
// pulling another query.
type CouncilBroadcastMemberInfo struct {
	AgentID string `json:"agent_id"`
	Name    string `json:"name"`
	Role    string `json:"role"`
}

// CouncilBroadcastContextType marks a chat task as a Council @全体 fan-out
// member task.
const CouncilBroadcastContextType = "council_broadcast"

// CouncilBroadcastResult is what the handler returns after fan-out so the
// HTTP layer can surface a coherent "we sent it to N members" response.
type CouncilBroadcastResult struct {
	CouncilSessionID string
	Tasks            []db.AgentTaskQueue
	SkippedAgentIDs  []string
}

// CouncilBroadcastSource identifies which roster supplied the fan-out targets.
// Used to pick the right "topic" label and the right participant query.
type CouncilBroadcastSource struct {
	Kind  string // "council" or "team"
	ID    pgtype.UUID
	Topic string // council.topic or team.name
}

// EnqueueCouncilBroadcastTasks fans an incoming chat message out to every
// active participant of a Council session. The chat message itself has
// already been persisted by the caller — this method only enqueues one chat
// task per participant, each tagged with a CouncilBroadcastContext so the
// daemon prompt builder can render a broadcast-style reply prompt.
//
// Skipped silently when:
//   - the participant is archived / has no runtime
//   - the participant has left the council (left_at IS NOT NULL)
//   - the participant is the broadcaster itself (so an agent doing @全体 does
//     not enqueue a task for itself)
//
// Returns the council UUID + the tasks that were actually enqueued so the
// HTTP layer can broadcast the right "fan-out fired" telemetry to the room.
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
		Kind:  "council",
		ID:    council.ID,
		Topic: council.Topic,
	}
	rosterInfo, rosterAgents, skipped, err := s.loadCouncilRoster(ctx, council.ID)
	if err != nil {
		return CouncilBroadcastResult{CouncilSessionID: util.UUIDToString(council.ID)}, err
	}
	return s.enqueueBroadcastForRoster(
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
	)
}

// EnqueueTeamBroadcastTasks fans an incoming chat message out to every
// active member of a team chat session. Used when a user posts @全体 in a
// team group chat (the actual user-visible "Council" room in v1.0.13 maps to
// this — the explicit council_session table is reserved for ad-hoc convened
// sessions). Behavior mirrors EnqueueCouncilBroadcastTasks except the roster
// comes from team_member rather than council_session_participant.
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
		Kind:  "team",
		ID:    team.ID,
		Topic: team.Name,
	}
	rosterInfo, rosterAgents, skipped, err := s.loadTeamRoster(ctx, team.ID)
	if err != nil {
		return CouncilBroadcastResult{}, err
	}
	return s.enqueueBroadcastForRoster(
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

func (s *TaskService) enqueueBroadcastForRoster(
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
) (CouncilBroadcastResult, error) {
	result := CouncilBroadcastResult{
		CouncilSessionID: util.UUIDToString(source.ID),
		SkippedAgentIDs:  append([]string{}, skipped...),
	}

	if len(rosterInfo) == 0 {
		return result, fmt.Errorf("%s has no eligible participants for broadcast", source.Kind)
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

	for _, member := range rosterInfo {
		if broadcasterKind == "agent" && member.AgentID == broadcasterID {
			// Don't re-enqueue the broadcaster itself when an agent triggers
			// the fan-out via @全体 — they already produced this turn.
			continue
		}
		agent := rosterAgents[member.AgentID]

		payload := CouncilBroadcastContext{
			Type:             CouncilBroadcastContextType,
			CouncilSessionID: util.UUIDToString(source.ID),
			CouncilTopic:     source.Topic,
			ChatSessionID:    util.UUIDToString(chatSession.ID),
			BroadcasterKind:  broadcasterKind,
			BroadcasterName:  broadcasterName,
			UserMessage:      userMessage,
			Participants:     rosterInfo,
			SelfAgentID:      member.AgentID,
			SelfAgentName:    member.Name,
		}
		contextJSON, err := json.Marshal(payload)
		if err != nil {
			slog.Warn("broadcast: marshal context failed",
				"source_kind", source.Kind,
				"source_id", util.UUIDToString(source.ID),
				"agent_id", member.AgentID,
				"error", err)
			continue
		}

		task, err := s.EnqueueChatTaskForAgent(
			ctx,
			chatSession,
			pgtype.UUID{Bytes: agent.ID.Bytes, Valid: true},
			contextJSON,
		)
		if err != nil {
			slog.Warn("broadcast: enqueue task failed",
				"source_kind", source.Kind,
				"source_id", util.UUIDToString(source.ID),
				"agent_id", member.AgentID,
				"error", err)
			result.SkippedAgentIDs = append(result.SkippedAgentIDs, member.AgentID)
			continue
		}
		result.Tasks = append(result.Tasks, task)
	}

	slog.Info("broadcast fan-out enqueued",
		"source_kind", source.Kind,
		"source_id", util.UUIDToString(source.ID),
		"chat_session_id", util.UUIDToString(chatSession.ID),
		"task_count", len(result.Tasks),
		"skipped_count", len(result.SkippedAgentIDs),
		"broadcaster_kind", broadcasterKind,
	)
	return result, nil
}
