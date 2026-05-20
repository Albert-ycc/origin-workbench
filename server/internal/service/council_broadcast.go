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
	result := CouncilBroadcastResult{
		CouncilSessionID: util.UUIDToString(council.ID),
	}

	participants, err := s.Queries.ListCouncilSessionParticipants(ctx, council.ID)
	if err != nil {
		return result, fmt.Errorf("list council participants: %w", err)
	}

	rosterInfo := make([]CouncilBroadcastMemberInfo, 0, len(participants))
	rosterAgents := make(map[string]db.Agent, len(participants))
	for _, p := range participants {
		if p.LeftAt.Valid {
			continue
		}
		agent, err := s.Queries.GetAgent(ctx, p.AgentID)
		if err != nil {
			slog.Warn("council broadcast: skip participant — agent load failed",
				"council_session_id", util.UUIDToString(council.ID),
				"agent_id", util.UUIDToString(p.AgentID),
				"error", err)
			continue
		}
		if agent.ArchivedAt.Valid || !agent.RuntimeID.Valid {
			result.SkippedAgentIDs = append(result.SkippedAgentIDs, util.UUIDToString(p.AgentID))
			continue
		}
		rosterAgents[util.UUIDToString(p.AgentID)] = agent
		rosterInfo = append(rosterInfo, CouncilBroadcastMemberInfo{
			AgentID: util.UUIDToString(p.AgentID),
			Name:    agent.Name,
			Role:    p.Role,
		})
	}

	if len(rosterInfo) == 0 {
		return result, fmt.Errorf("council has no eligible participants for broadcast")
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
			CouncilSessionID: util.UUIDToString(council.ID),
			CouncilTopic:     council.Topic,
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
			slog.Warn("council broadcast: marshal context failed",
				"council_session_id", util.UUIDToString(council.ID),
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
			slog.Warn("council broadcast: enqueue task failed",
				"council_session_id", util.UUIDToString(council.ID),
				"agent_id", member.AgentID,
				"error", err)
			result.SkippedAgentIDs = append(result.SkippedAgentIDs, member.AgentID)
			continue
		}
		result.Tasks = append(result.Tasks, task)
	}

	slog.Info("council broadcast fan-out enqueued",
		"council_session_id", util.UUIDToString(council.ID),
		"chat_session_id", util.UUIDToString(chatSession.ID),
		"task_count", len(result.Tasks),
		"skipped_count", len(result.SkippedAgentIDs),
		"broadcaster_kind", broadcasterKind,
	)
	return result, nil
}
