package daemon

import (
	"fmt"
	"strings"

	"github.com/multica-ai/multica/server/internal/daemon/execenv"
)

// BuildPrompt constructs the task prompt for an agent CLI.
// Keep this minimal — detailed instructions live in CLAUDE.md / AGENTS.md
// injected by execenv.InjectRuntimeConfig.
//
// Origin §14.10: when task.OperatorPreferences is set, its content is
// prepended as the closest layer of the system prompt — agents must read it
// before doing anything else so user-written preferences override defaults.
func BuildPrompt(task Task) string {
	body := buildPromptBody(task)
	return prependOperatorPreferences(task.OperatorPreferences, body)
}

func buildPromptBody(task Task) string {
	if task.ProjectCompaction != nil {
		return buildProjectCompactionPrompt(task)
	}
	if task.ChatSessionID != "" {
		return buildChatPrompt(task)
	}
	if task.TriggerCommentID != "" {
		return buildCommentPrompt(task)
	}
	if task.AutopilotRunID != "" {
		return buildAutopilotPrompt(task)
	}
	if task.QuickCreatePrompt != "" {
		return buildQuickCreatePrompt(task)
	}
	var b strings.Builder
	b.WriteString("You are running as a local agent on the user's Origin workbench. (The CLI is named `multica` for upstream compatibility — see CLAUDE.md / AGENTS.md for the full framing.)\n\n")
	fmt.Fprintf(&b, "Your assigned task ID is: %s\n\n", task.IssueID)
	fmt.Fprintf(&b, "Start by running `multica issue get %s --output json` to fetch the task details (the underlying CLI command is named `issue` for historical reasons), then complete the work.\n", task.IssueID)
	return b.String()
}

func buildProjectCompactionPrompt(task Task) string {
	pc := task.ProjectCompaction
	var b strings.Builder
	b.WriteString("You are the captain agent preparing a `/sync` compaction preview for an Origin project main chat.\n\n")
	if pc.ProjectTitle != "" {
		fmt.Fprintf(&b, "Project: %s\n", pc.ProjectTitle)
	}
	fmt.Fprintf(&b, "Project ID: %s\n", pc.ProjectID)
	fmt.Fprintf(&b, "Chat session ID: %s\n", pc.ChatSessionID)
	fmt.Fprintf(&b, "Messages in scope: %d", pc.MessageCount)
	if pc.OldestAt != "" || pc.NewestAt != "" {
		fmt.Fprintf(&b, " (%s → %s)", pc.OldestAt, pc.NewestAt)
	}
	b.WriteString("\n\n")
	if strings.TrimSpace(pc.MemoryDoc) != "" {
		b.WriteString("Current project memory doc:\n\n```markdown\n")
		b.WriteString(pc.MemoryDoc)
		if !strings.HasSuffix(pc.MemoryDoc, "\n") {
			b.WriteString("\n")
		}
		b.WriteString("```\n\n")
	}

	b.WriteString("Task:\n")
	b.WriteString("- Extract durable decisions, deliverables, current project status, and carry-forward follow-ups from the transcript.\n")
	b.WriteString("- Prefer specific facts over generic process notes.\n")
	b.WriteString("- Include only message ids that appear in the transcript when recommending pinned quotes.\n")
	b.WriteString("- Output strict JSON only. No markdown fence, no prose before or after.\n\n")
	b.WriteString("JSON schema:\n")
	b.WriteString(`{"key_decisions":["..."],"deliverables":["..."],"current_status":"...","carry_forward":["..."],"pinned_message_ids":["<message_id>"]}`)
	b.WriteString("\n\nTranscript:\n")
	for _, m := range pc.Messages {
		speaker := strings.TrimSpace(m.Speaker)
		if speaker == "" {
			speaker = m.Role
		}
		fmt.Fprintf(&b, "\n[%s] %s · %s · id=%s\n%s\n", m.CreatedAt, speaker, m.Role, m.ID, m.Content)
	}
	return b.String()
}

// prependOperatorPreferences puts the user's identity card and communication
// style at the very top of the prompt so it dominates default behavior. When
// the profile is empty (user never filled the settings tab), the body is
// returned unchanged — no marker, no orphan header.
func prependOperatorPreferences(prefs *OperatorPreferences, body string) string {
	if prefs == nil {
		return body
	}
	role := strings.TrimSpace(prefs.RoleCard)
	style := strings.TrimSpace(prefs.CommunicationStyle)
	if role == "" && style == "" {
		return body
	}
	var b strings.Builder
	b.WriteString("[Operator preferences — read first, override defaults]\n")
	if role != "" {
		b.WriteString("Operator: ")
		b.WriteString(role)
		b.WriteString("\n")
	}
	if style != "" {
		b.WriteString("Communication style:\n")
		b.WriteString(style)
		b.WriteString("\n")
	}
	b.WriteString("[End operator preferences]\n\n")
	b.WriteString(body)
	return b.String()
}

// buildQuickCreatePrompt constructs a prompt for quick-create tasks. The
// user typed a single natural-language sentence in the create-issue modal;
// the agent's job is to translate it into one `multica issue create` CLI
// invocation, using its judgment to decide whether fetching referenced URLs
// would produce a better issue. No issue exists yet, so the agent must NOT
// call `multica issue get` or attempt to comment — there's nothing to read
// or reply to.
func buildQuickCreatePrompt(task Task) string {
	var b strings.Builder
	b.WriteString("You are running as a quick-create assistant on the user's Origin workbench.\n\n")
	b.WriteString("The user pressed the quick-create shortcut and typed a one-line description. Your job is to create a well-formed task record from that input with a single `multica issue create` invocation. (The underlying CLI verb is `issue create` for historical reasons; the user-facing surface in Origin is the task / Mission concept.)\n\n")
	fmt.Fprintf(&b, "User input:\n> %s\n\n", task.QuickCreatePrompt)
	b.WriteString("Field rules:\n")
	b.WriteString("- title: required. A concise but semantically rich summary that lets a reader understand what the issue is about at a glance. If the user input references external resources (PRs, issues, URLs, etc.), use your judgment to decide whether fetching the resource would produce a meaningfully better title — if so, fetch it and incorporate the relevant context. For example, \"review PR #123\" is much less useful than \"Review PR #123: Refactor auth module to OAuth2\". Strip filler words but preserve key semantic information.\n")
	b.WriteString("- description: stay faithful to the user's original input — do NOT invent requirements, design decisions, implementation plans, or constraints that the user did not express. The description should enrich the user's input with factual context only: if the input contains URLs or references (PRs, issues, docs), fetch them and summarize the relevant parts. Restate the user's intent clearly so the executing agent understands the task, but do not expand scope or add made-up details. Keep it concise. Never echo the title here.\n")
	b.WriteString("- priority: one of `urgent`, `high`, `medium`, `low`, or omit. Map P0/P1 → urgent/high; \"asap\" → urgent. If unspecified, omit.\n")
	b.WriteString("- assignee:\n")
	b.WriteString("    - When the user names someone (\"assign to X\" / \"@X\"), call `multica workspace members --output json` and find the matching member by display name (case-insensitive substring match is fine). On a clean match, pass `--assignee <name>`. On no match or ambiguous match, do NOT pass `--assignee` — instead append a final line to the description: `Unrecognized assignee: X`.\n")
	agentName := ""
	if task.Agent != nil {
		agentName = task.Agent.Name
	}
	if agentName != "" {
		fmt.Fprintf(&b, "    - When the user did NOT name an assignee, default to YOURSELF: pass `--assignee %q`. The picker agent is the expected owner because the user opened quick-create with you selected — never leave the issue unassigned.\n", agentName)
	} else {
		b.WriteString("    - When the user did NOT name an assignee, default to YOURSELF (the picker agent): pass `--assignee <your agent name>`. Never leave the issue unassigned.\n")
	}
	b.WriteString("- project: omit. The platform will route the issue to the workspace default.\n")
	b.WriteString("- status: omit (defaults to `todo`).\n")
	b.WriteString("- attachments: do NOT pass `--attachment`. The flag only accepts LOCAL file paths, and any image URL embedded in the user input is already part of the description as markdown — keep it inline in `--description` instead of trying to re-attach it. (Trying to pass `https://…` to `--attachment` will fail and look like a create error to you, but the issue may already exist; never retry `issue create` on that signal.)\n\n")
	b.WriteString("Output format:\n")
	b.WriteString("- Run exactly one `multica issue create` invocation. Do not retry it for any reason — even on a non-zero exit. The issue may already exist; another attempt would create a duplicate.\n")
	b.WriteString("- After it succeeds, print exactly one line: `Created MUL-<n>: <title>` and exit. No commentary, no follow-up tool calls.\n")
	b.WriteString("- Do NOT call `multica issue get` or `multica issue comment add` for this task — there is no issue to query or comment on prior to creation.\n")
	b.WriteString("- If the CLI returns an error, exit with that error as the only output. The platform writes a failure notification automatically; do not retry.\n")
	return b.String()
}

// buildCommentPrompt constructs a prompt for comment-triggered tasks.
// The triggering comment content is embedded directly so the agent cannot
// miss it, even when stale output files exist in a reused workdir.
// The reply instructions (including the current TriggerCommentID as --parent)
// are re-emitted on every turn so resumed sessions cannot carry forward a
// previous turn's --parent UUID.
func buildCommentPrompt(task Task) string {
	var b strings.Builder
	b.WriteString("You are running as a local agent on the user's Origin workbench.\n\n")
	fmt.Fprintf(&b, "Your assigned task ID is: %s\n\n", task.IssueID)
	if task.TriggerCommentContent != "" {
		authorLabel := "A user"
		if task.TriggerAuthorType == "agent" {
			name := task.TriggerAuthorName
			if name == "" {
				name = "another agent"
			}
			authorLabel = fmt.Sprintf("Another agent (%s)", name)
		}
		fmt.Fprintf(&b, "[NEW COMMENT] %s just left a new comment. Focus on THIS comment — do not confuse it with previous ones:\n\n", authorLabel)
		fmt.Fprintf(&b, "> %s\n\n", task.TriggerCommentContent)
		if task.TriggerAuthorType == "agent" {
			b.WriteString("⚠️ The triggering comment was posted by another agent. Decide whether a reply is warranted. If you produced actual work this turn (investigated, fixed something, answered a real question), post the result as a normal reply — that is NOT a noise comment, and the standard rule that final results must be delivered via comment still applies. If the triggering comment was a pure acknowledgment, thanks, or sign-off AND you produced no work this turn, do NOT reply — and do NOT post a comment saying 'No reply needed' or similar. Simply exit with no output. Silence is the preferred way to end agent-to-agent threads. If you do reply, do not @mention the other agent as a sign-off (that re-triggers them and starts a loop).\n\n")
		}
	}
	fmt.Fprintf(&b, "Start by running `multica issue get %s --output json` to understand your task, then decide how to proceed.\n\n", task.IssueID)
	b.WriteString(execenv.BuildCommentReplyInstructions(task.IssueID, task.TriggerCommentID))
	return b.String()
}

// buildChatPrompt constructs a prompt for interactive chat tasks.
func buildChatPrompt(task Task) string {
	var b strings.Builder
	// Council @全体 relay (replaces the older parallel fan-out — 2026-05-21).
	// Two prompt shapes, switched by bc.Role:
	//   - lead: chairperson opening. Names everyone "standing by", invites
	//     the user to clarify, and does NOT answer the substantive question.
	//   - follower: the next member picks up after the lead, self-introduces,
	//     lists scope, references teammates.
	if task.CouncilBroadcast != nil {
		bc := task.CouncilBroadcast
		b.WriteString("You are participating in an Origin Council Session as one member of a multi-role group chat. This is a serial relay (NOT a parallel fan-out): exactly one agent speaks per turn, and you are this turn.\n\n")
		if bc.CouncilTopic != "" {
			fmt.Fprintf(&b, "Council topic: %s\n", bc.CouncilTopic)
		}
		selfName := bc.SelfAgentName
		if selfName == "" && task.Agent != nil {
			selfName = task.Agent.Name
		}
		if selfName != "" {
			fmt.Fprintf(&b, "You are: %s\n", selfName)
		}
		if len(bc.Participants) > 0 {
			b.WriteString("\nRoom roster (everyone in this room, in seat order):\n")
			for _, m := range bc.Participants {
				name := m.Name
				if name == "" {
					name = m.AgentID
				}
				role := m.Role
				if role == "" {
					role = "member"
				}
				marker := ""
				if m.AgentID == bc.SelfAgentID {
					marker = "  ← you"
				}
				fmt.Fprintf(&b, "- %s (%s)%s\n", name, role, marker)
			}
		}
		broadcaster := bc.BroadcasterName
		if broadcaster == "" {
			broadcaster = "the user"
		}
		fmt.Fprintf(&b, "\n%s addressed the whole room with @全体.\nUser said: %q\n\n", broadcaster, bc.UserMessage)

		switch bc.Role {
		case "lead":
			b.WriteString("You are the team LEAD. Your job this turn is to OPEN THE ROOM as chairperson — NOT to answer the substantive question. Follow this shape strictly:\n\n")
			b.WriteString("1. Warm acknowledgement of the user, one short sentence.\n")
			b.WriteString("2. Name every teammate that is standing by (use roster names exactly), and one short phrase describing each one's scope. Be specific to each member's role identity, not generic.\n")
			b.WriteString("3. Invite the user to clarify what they want first — what topic, what depth, who they want to hear from.\n")
			b.WriteString("4. End on a question to the user. The next speaker will pick up from there.\n\n")
			b.WriteString("STRICT bans:\n")
			b.WriteString("- Do NOT answer the user's actual question (model? roadmap? data?) — leave substance to the followers.\n")
			b.WriteString("- Do NOT narrate any reasoning, exploration steps, or self-talk in the message body. Phrases like \"我先确认…\", \"我再看一下…\", \"已经从本地快照里找到…\", \"下一步我直接…\" are FORBIDDEN. If you need to call a tool, call it silently.\n")
			b.WriteString("- Do NOT preface with role boilerplate like \"作为产品经理…\". Just speak.\n")
			b.WriteString("- Do NOT @-mention any teammate in a way that creates a delegation task — this turn is an opening, not a hand-off.\n")
			b.WriteString("- Total length 4–7 sentences. This is a chairperson's opening, not an essay.\n\n")
		case "follower":
			prior := bc.PriorSpeakerName
			if prior == "" {
				prior = "the team lead"
			}
			fmt.Fprintf(&b, "%s just opened the room. Your job this turn is to PICK UP THE RELAY — introduce yourself and declare your scope. Follow this shape strictly:\n\n", prior)
			b.WriteString("1. One short acknowledgement of the user (varied phrasing, don't echo the lead's open).\n")
			b.WriteString("2. State your own role identity in one sentence — what you focus on in this team.\n")
			b.WriteString("3. Reference the OTHER teammates' scope so the user sees clean division of labor. Use the pattern: \"While [colleague A] handles X and [colleague B] handles Y, I'm here for Z.\" Use roster names exactly.\n")
			b.WriteString("4. List 3–5 bullet points of concrete things YOU can do on this topic. Each bullet should be a verb-first capability, not a job-title slogan.\n")
			b.WriteString("5. End with one open question inviting the user to share specifics before you go deeper.\n\n")
			b.WriteString("STRICT bans:\n")
			b.WriteString("- Do NOT narrate your reasoning or exploration steps in the message body. Tool calls happen silently.\n")
			b.WriteString("- Do NOT repeat the lead's opening — assume the user already read it.\n")
			b.WriteString("- Do NOT @-mention or delegate to other teammates.\n")
			b.WriteString("- Do NOT speak \"on behalf of the whole team\". Stay in your own role identity.\n")
			b.WriteString("- Total length 5–8 sentences plus the bullet list. Keep it scannable.\n\n")
		default:
			// Defensive fallback for an unset/unknown Role — behave like a
			// follower so we never silently drop back to "answer it yourself".
			b.WriteString("Self-introduce briefly, declare your scope, list 3–5 concrete things you can do on this topic, and invite the user to share specifics. Do NOT narrate your reasoning. 5–8 sentences plus the bullet list.\n\n")
		}
		writeRequestedSkills(&b, task.RequestedSkills)
		return b.String()
	}
	if task.TeamID != "" {
		b.WriteString("You are running inside an Origin Council Session (a multi-agent group chat for cross-role decisions).\n\n")
		if task.TeamName != "" {
			fmt.Fprintf(&b, "Team: %s\n", task.TeamName)
		}
		if task.Agent != nil && task.Agent.Name != "" {
			fmt.Fprintf(&b, "You are currently acting as: %s\n", task.Agent.Name)
		}
		if task.TeamCaptainAgentID != "" {
			fmt.Fprintf(&b, "Team captain agent ID: %s\n", task.TeamCaptainAgentID)
		}
		if len(task.TeamMembers) > 0 {
			b.WriteString("\nTeam roster:\n")
			for _, member := range task.TeamMembers {
				name := member.Name
				if name == "" {
					name = member.AgentID
				}
				role := member.Role
				if role == "" {
					role = "member"
				}
				fmt.Fprintf(&b, "- %s (%s, agent_id=%s)\n", name, role, member.AgentID)
			}
		}
		b.WriteString("\nCollaboration rules:\n")
		b.WriteString("- Treat this as a group chat. Answer visibly in the room, but think like the team captain when you are the captain.\n")
		b.WriteString("- **Delegation = `@成员名 具体指令`**. When you (as captain) need other members to do work, you MUST mention them with `@` followed by their exact roster name, then write the concrete instruction for that person. Origin will auto-spawn a task card per @-mention and trigger that member to execute. Markdown lists like `1. 某成员` or `- 某成员` do NOT create tasks — they're just text. The user can SEE which @-mentions you used, so being lazy with `@` is visible.\n")
		b.WriteString("- Format your delegation reply with one mention per line:\n")
		b.WriteString("    @张三 你来做 X，重点关注 ABC。\n")
		b.WriteString("    @李四 你接着张三的产出做 Y，对接到 DEF。\n")
		b.WriteString("    Each mention from a new line gets its own task card; everything from `@` to the next `@` (or paragraph end) becomes that member's instruction.\n")
		b.WriteString("- If the user writes `@全体`, that means the same task fans out to every member — captain should usually @-mention members individually with their specific scope rather than rely on `@全体`, but `@全体` is supported if everyone really shares the same scope.\n")
		b.WriteString("- If the user writes `@成员名` directly, that's a delegation request to that member from the user — surface the plan and `@` that member from your reply with the concrete instruction.\n")
		b.WriteString("- Do not invent members. Use the roster names above for assignee matching. Mention matching is case/whitespace insensitive but won't fix typos.\n")
		b.WriteString("- The legacy `multica issue create --assignee` command is NOT needed in team chats — the @-mention path supersedes it. Stick to `@成员名 + 指令`.\n\n")
		if task.TeamDelegation != nil && strings.TrimSpace(task.TeamDelegation.Instruction) != "" {
			source := task.TeamDelegation.SourceAgentName
			if source == "" {
				source = "the team captain"
			}
			fmt.Fprintf(&b, "Delegation from %s:\n%s\n\n", source, task.TeamDelegation.Instruction)
			b.WriteString("You are the delegated member for this turn. Do the work requested of you, then reply back to the group chat with your findings, decisions, blockers, or handoff notes.\n\n")
		}
		writeRequestedSkills(&b, task.RequestedSkills)
		fmt.Fprintf(&b, "User message:\n%s\n", task.ChatMessage)
		return b.String()
	}
	b.WriteString("You are running as the user's Origin Direct Chat partner — Origin's primary product surface.\n")
	b.WriteString("Stay in your role (see Agent Identity / operator preferences above). Do NOT introduce yourself as a \"Multica platform agent\" or describe your capabilities in terms of `multica issue` / `multica autopilot` / workspace management — those are local CLI plumbing and the user does not see them. Talk in Origin terms (Mission / Idea Pool / Council Session / Branching Exploration / Tool Binding) when describing what you can do.\n\n")
	writeRequestedSkills(&b, task.RequestedSkills)
	fmt.Fprintf(&b, "User message:\n%s\n", task.ChatMessage)
	return b.String()
}

func writeRequestedSkills(b *strings.Builder, skills []string) {
	if len(skills) == 0 {
		return
	}
	b.WriteString("Requested skills for this turn:\n")
	for _, skill := range skills {
		name := strings.TrimSpace(skill)
		if name == "" {
			continue
		}
		fmt.Fprintf(b, "- %s\n", name)
	}
	b.WriteString("Use the selected skill instructions for this turn before answering.\n\n")
}

// buildAutopilotPrompt constructs a prompt for run_only autopilot tasks.
func buildAutopilotPrompt(task Task) string {
	var b strings.Builder
	b.WriteString("You are running as a local agent on the user's Origin workbench.\n\n")
	b.WriteString("This task was triggered by an Autopilot in run-only mode. There is no assigned task record for this run.\n\n")
	fmt.Fprintf(&b, "Autopilot run ID: %s\n", task.AutopilotRunID)
	if task.AutopilotID != "" {
		fmt.Fprintf(&b, "Autopilot ID: %s\n", task.AutopilotID)
	}
	if task.AutopilotTitle != "" {
		fmt.Fprintf(&b, "Autopilot title: %s\n", task.AutopilotTitle)
	}
	if task.AutopilotSource != "" {
		fmt.Fprintf(&b, "Trigger source: %s\n", task.AutopilotSource)
	}
	if strings.TrimSpace(string(task.AutopilotTriggerPayload)) != "" {
		fmt.Fprintf(&b, "Trigger payload:\n%s\n", strings.TrimSpace(string(task.AutopilotTriggerPayload)))
	}
	b.WriteString("\nAutopilot instructions:\n")
	if strings.TrimSpace(task.AutopilotDescription) != "" {
		b.WriteString(task.AutopilotDescription)
		b.WriteString("\n\n")
	} else if task.AutopilotTitle != "" {
		fmt.Fprintf(&b, "%s\n\n", task.AutopilotTitle)
	} else {
		b.WriteString("No additional autopilot instructions were provided. Inspect the autopilot configuration before proceeding.\n\n")
	}
	if task.AutopilotID != "" {
		fmt.Fprintf(&b, "Start by running `multica autopilot get %s --output json` if you need the full autopilot configuration, then complete the instructions above.\n", task.AutopilotID)
	} else {
		b.WriteString("Complete the instructions above.\n")
	}
	b.WriteString("Do not run `multica issue get`; this run does not have an issue ID.\n")
	return b.String()
}
