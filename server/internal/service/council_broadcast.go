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
	Role             string                       `json:"role"`                  // "lead" or "follower"
	SourceKind       string                       `json:"source_kind,omitempty"` // "council" or "team" — drives the chain handler
	PriorSpeakerName string                       `json:"prior_speaker_name,omitempty"`
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
	rosterInfo, rosterAgents, skipped, err := s.loadCouncilRoster(ctx, council.ID)
	if err != nil {
		return CouncilBroadcastResult{CouncilSessionID: util.UUIDToString(council.ID)}, err
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
	rosterInfo, rosterAgents, skipped, err := s.loadTeamRoster(ctx, team.ID)
	if err != nil {
		return CouncilBroadcastResult{}, err
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
// was a follower broadcast, the relay stops. Any other task type → no-op.
func (s *TaskService) handleCouncilBroadcastRelay(ctx context.Context, task db.AgentTaskQueue) {
	if len(task.Context) == 0 || !task.ChatSessionID.Valid {
		return
	}
	var bc CouncilBroadcastContext
	if err := json.Unmarshal(task.Context, &bc); err != nil {
		return
	}
	if bc.Type != CouncilBroadcastContextType || bc.Role != CouncilBroadcastRoleLead {
		return
	}
	chatSession, err := s.Queries.GetChatSession(ctx, task.ChatSessionID)
	if err != nil {
		slog.Warn("broadcast relay: load chat session failed",
			"chat_session_id", util.UUIDToString(task.ChatSessionID),
			"error", err)
		return
	}
	if _, _, err := s.enqueueBroadcastFollower(ctx, chatSession, bc); err != nil {
		slog.Warn("broadcast relay: follower enqueue failed",
			"chat_session_id", util.UUIDToString(task.ChatSessionID),
			"lead_agent_id", bc.SelfAgentID,
			"error", err)
	}
}
