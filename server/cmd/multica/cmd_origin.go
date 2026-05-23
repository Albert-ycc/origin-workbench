package main

// Origin product-surface CLI commands (PRD §14.5 / §14.6 / §14.7 / §14.9).
// Agents see these as their first-class tool surface; the legacy
// `multica issue` / `multica autopilot` commands still exist for compatibility
// but are not the recommended verbs in agent-facing prompts.
//
// These entities are read-only here on purpose: writes (promote idea,
// adjourn council, mark exploration verdict, …)
// are user-driven actions that flow through the desktop UI / dispatch path.
// Adding agent-driven write CLIs is a follow-up — see runtime_config.go
// for the current scope contract.

import (
	"context"
	"fmt"
	"net/url"
	"os"
	"time"

	"github.com/spf13/cobra"

	"github.com/multica-ai/multica/server/internal/cli"
)

// ────────────────────────────────────────────────────────────────────────
// Mission (PRD §3 / §14.5 — the work object an agent gets delegated to)
// ────────────────────────────────────────────────────────────────────────

var missionCmd = &cobra.Command{
	Use:   "mission",
	Short: "Read Mission state (Origin's primary work objects)",
	Long: "Mission is the Origin product-level work object — what users delegate to an agent.\n" +
		"Use `mission list` to see active Missions, `mission get <id>` to read the full plan.",
}

var missionListCmd = &cobra.Command{
	Use:   "list",
	Short: "List Missions in the workspace",
	RunE:  runMissionList,
}

var missionGetCmd = &cobra.Command{
	Use:   "get <id>",
	Short: "Get Mission details (plan, assignments, captain, status)",
	Args:  exactArgs(1),
	RunE:  runMissionGet,
}

func runMissionList(cmd *cobra.Command, _ []string) error {
	client, err := newAPIClient(cmd)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	if client.WorkspaceID == "" {
		if _, err := requireWorkspaceID(cmd); err != nil {
			return err
		}
	}
	params := url.Values{}
	params.Set("workspace_id", client.WorkspaceID)
	if v, _ := cmd.Flags().GetString("status"); v != "" {
		params.Set("status", v)
	}
	if v, _ := cmd.Flags().GetInt("limit"); v > 0 {
		params.Set("limit", fmt.Sprintf("%d", v))
	}
	var result map[string]any
	if err := client.GetJSON(ctx, "/api/missions?"+params.Encode(), &result); err != nil {
		return fmt.Errorf("list missions: %w", err)
	}
	return cli.PrintJSON(os.Stdout, result)
}

func runMissionGet(cmd *cobra.Command, args []string) error {
	client, err := newAPIClient(cmd)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	var mission map[string]any
	if err := client.GetJSON(ctx, "/api/missions/"+args[0], &mission); err != nil {
		return fmt.Errorf("get mission: %w", err)
	}
	return cli.PrintJSON(os.Stdout, mission)
}

// ────────────────────────────────────────────────────────────────────────
// Idea (PRD §14.6 — pre-Mission incubation pool)
// ────────────────────────────────────────────────────────────────────────

var ideaCmd = &cobra.Command{
	Use:   "idea",
	Short: "Read Idea Pool entries (lightweight pre-Mission incubation)",
	Long: "The Idea Pool is where the user parks half-formed thoughts that aren't yet\n" +
		"shaped enough to become a Mission. Use `idea list` to scan recent / nurturing\n" +
		"entries, `idea get <id>` to read the full nurturing trail.",
}

var ideaListCmd = &cobra.Command{
	Use:   "list",
	Short: "List Ideas in the pool",
	RunE:  runIdeaList,
}

var ideaGetCmd = &cobra.Command{
	Use:   "get <id>",
	Short: "Get Idea details (raw description, nurture notes, related references)",
	Args:  exactArgs(1),
	RunE:  runIdeaGet,
}

func runIdeaList(cmd *cobra.Command, _ []string) error {
	client, err := newAPIClient(cmd)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	if client.WorkspaceID == "" {
		if _, err := requireWorkspaceID(cmd); err != nil {
			return err
		}
	}
	params := url.Values{}
	params.Set("workspace_id", client.WorkspaceID)
	if v, _ := cmd.Flags().GetString("status"); v != "" {
		params.Set("status", v)
	}
	if v, _ := cmd.Flags().GetInt("limit"); v > 0 {
		params.Set("limit", fmt.Sprintf("%d", v))
	}
	var result map[string]any
	if err := client.GetJSON(ctx, "/api/ideas?"+params.Encode(), &result); err != nil {
		return fmt.Errorf("list ideas: %w", err)
	}
	return cli.PrintJSON(os.Stdout, result)
}

func runIdeaGet(cmd *cobra.Command, args []string) error {
	client, err := newAPIClient(cmd)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	var idea map[string]any
	if err := client.GetJSON(ctx, "/api/ideas/"+args[0], &idea); err != nil {
		return fmt.Errorf("get idea: %w", err)
	}
	return cli.PrintJSON(os.Stdout, idea)
}

// ────────────────────────────────────────────────────────────────────────
// Council Session (PRD §14.5 — on-demand multi-agent decision rooms)
// ────────────────────────────────────────────────────────────────────────

var councilCmd = &cobra.Command{
	Use:   "council",
	Short: "Read Council Sessions (multi-agent decision rooms)",
	Long: "A Council Session is a temporary multi-agent room called when a question needs\n" +
		"cross-role discussion. Use `council list` to see active rooms, `council get <id>`\n" +
		"to read the participants, message stream, and conclusion.",
}

var councilListCmd = &cobra.Command{
	Use:   "list",
	Short: "List Council Sessions",
	RunE:  runCouncilList,
}

var councilGetCmd = &cobra.Command{
	Use:   "get <id>",
	Short: "Get Council Session details (participants, messages, conclusion)",
	Args:  exactArgs(1),
	RunE:  runCouncilGet,
}

func runCouncilList(cmd *cobra.Command, _ []string) error {
	client, err := newAPIClient(cmd)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	if client.WorkspaceID == "" {
		if _, err := requireWorkspaceID(cmd); err != nil {
			return err
		}
	}
	params := url.Values{}
	params.Set("workspace_id", client.WorkspaceID)
	if v, _ := cmd.Flags().GetString("status"); v != "" {
		params.Set("status", v)
	}
	if v, _ := cmd.Flags().GetInt("limit"); v > 0 {
		params.Set("limit", fmt.Sprintf("%d", v))
	}
	var result map[string]any
	if err := client.GetJSON(ctx, "/api/council-sessions?"+params.Encode(), &result); err != nil {
		return fmt.Errorf("list council sessions: %w", err)
	}
	return cli.PrintJSON(os.Stdout, result)
}

func runCouncilGet(cmd *cobra.Command, args []string) error {
	client, err := newAPIClient(cmd)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	var session map[string]any
	if err := client.GetJSON(ctx, "/api/council-sessions/"+args[0], &session); err != nil {
		return fmt.Errorf("get council session: %w", err)
	}
	return cli.PrintJSON(os.Stdout, session)
}

// ────────────────────────────────────────────────────────────────────────
// Branching Exploration (PRD §14.7 — parallel proposals with 7-field compare)
// ────────────────────────────────────────────────────────────────────────

var explorationCmd = &cobra.Command{
	Use:   "exploration",
	Short: "Read Branching Explorations (parallel proposal compares)",
	Long: "A Branching Exploration parks 2-4 proposals side-by-side under one question,\n" +
		"each with the same 7 fields (core / logic / decisions / cost / risk / fits /\n" +
		"does-not-fit) so the user can pick a winner. Use `exploration list` and\n" +
		"`exploration get <id>` to inspect.",
}

var explorationListCmd = &cobra.Command{
	Use:   "list",
	Short: "List Explorations",
	RunE:  runExplorationList,
}

var explorationGetCmd = &cobra.Command{
	Use:   "get <id>",
	Short: "Get Exploration details (branches with their 7 fields and verdicts)",
	Args:  exactArgs(1),
	RunE:  runExplorationGet,
}

func runExplorationList(cmd *cobra.Command, _ []string) error {
	client, err := newAPIClient(cmd)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	if client.WorkspaceID == "" {
		if _, err := requireWorkspaceID(cmd); err != nil {
			return err
		}
	}
	params := url.Values{}
	params.Set("workspace_id", client.WorkspaceID)
	if v, _ := cmd.Flags().GetString("status"); v != "" {
		params.Set("status", v)
	}
	var result map[string]any
	if err := client.GetJSON(ctx, "/api/explorations?"+params.Encode(), &result); err != nil {
		return fmt.Errorf("list explorations: %w", err)
	}
	return cli.PrintJSON(os.Stdout, result)
}

func runExplorationGet(cmd *cobra.Command, args []string) error {
	client, err := newAPIClient(cmd)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	var exploration map[string]any
	if err := client.GetJSON(ctx, "/api/explorations/"+args[0], &exploration); err != nil {
		return fmt.Errorf("get exploration: %w", err)
	}
	return cli.PrintJSON(os.Stdout, exploration)
}

// ────────────────────────────────────────────────────────────────────────
// Tool Binding (PRD §14.9 — bind external work artifacts to a Mission)
// ────────────────────────────────────────────────────────────────────────

var toolBindingCmd = &cobra.Command{
	Use:   "tool-binding",
	Short: "Read Tool Bindings (external artifacts attached to a Mission/Agent/Idea/Council)",
	Long: "A Tool Binding attaches a real work artifact (Lark doc, Lark whiteboard, Figma\n" +
		"file, Obsidian note, local repo) to a Mission/Agent/Idea/Council so an agent\n" +
		"can read it (and write to it when write_enabled is set). Use `tool-binding list`\n" +
		"with `--mission <id>` / `--agent <id>` to scope.",
}

var toolBindingListCmd = &cobra.Command{
	Use:   "list",
	Short: "List Tool Bindings (filter by mission/agent/idea/council)",
	RunE:  runToolBindingList,
}

var toolBindingGetCmd = &cobra.Command{
	Use:   "get <id>",
	Short: "Get a Tool Binding's details",
	Args:  exactArgs(1),
	RunE:  runToolBindingGet,
}

func runToolBindingList(cmd *cobra.Command, _ []string) error {
	client, err := newAPIClient(cmd)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	if client.WorkspaceID == "" {
		if _, err := requireWorkspaceID(cmd); err != nil {
			return err
		}
	}
	params := url.Values{}
	params.Set("workspace_id", client.WorkspaceID)
	if v, _ := cmd.Flags().GetString("mission"); v != "" {
		params.Set("mission_id", v)
	}
	if v, _ := cmd.Flags().GetString("agent"); v != "" {
		params.Set("agent_id", v)
	}
	if v, _ := cmd.Flags().GetString("idea"); v != "" {
		params.Set("idea_id", v)
	}
	if v, _ := cmd.Flags().GetString("council"); v != "" {
		params.Set("council_session_id", v)
	}
	var result map[string]any
	if err := client.GetJSON(ctx, "/api/tool-bindings?"+params.Encode(), &result); err != nil {
		return fmt.Errorf("list tool bindings: %w", err)
	}
	return cli.PrintJSON(os.Stdout, result)
}

func runToolBindingGet(cmd *cobra.Command, args []string) error {
	client, err := newAPIClient(cmd)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	var binding map[string]any
	if err := client.GetJSON(ctx, "/api/tool-bindings/"+args[0], &binding); err != nil {
		return fmt.Errorf("get tool binding: %w", err)
	}
	return cli.PrintJSON(os.Stdout, binding)
}

// ────────────────────────────────────────────────────────────────────────
// Project history (PRD §17.5.2 — onboarding surface)
//
// `multica project history <project_id>` extends the legacy v1.0 project
// CLI (cmd_project.go) with a v1.2-shaped read endpoint. The legacy
// list/get/create verbs still work for issue-classification projects;
// `history` is the v1.2 project main chat reader.
// ────────────────────────────────────────────────────────────────────────

var projectHistoryCmd = &cobra.Command{
	Use:   "history <project_id>",
	Short: "Fetch the v1.2 project main chat history (chronological)",
	Args:  exactArgs(1),
	RunE:  runProjectHistory,
}

func runProjectHistory(cmd *cobra.Command, args []string) error {
	client, err := newAPIClient(cmd)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	params := url.Values{}
	if v, _ := cmd.Flags().GetString("since"); v != "" {
		params.Set("since", v)
	}
	if v, _ := cmd.Flags().GetInt("limit"); v > 0 {
		params.Set("limit", fmt.Sprintf("%d", v))
	}
	path := "/api/v12/projects/" + args[0] + "/history"
	if encoded := params.Encode(); encoded != "" {
		path += "?" + encoded
	}
	var result map[string]any
	if err := client.GetJSON(ctx, path, &result); err != nil {
		return fmt.Errorf("get project history: %w", err)
	}
	return cli.PrintJSON(os.Stdout, result)
}

// ────────────────────────────────────────────────────────────────────────
// Wiring
// ────────────────────────────────────────────────────────────────────────

func init() {
	// Mission flags
	missionListCmd.Flags().String("status", "", "Filter by status (proposed/active/blocked/completed/archived)")
	missionListCmd.Flags().Int("limit", 0, "Max number of Missions to return")

	// Idea flags
	ideaListCmd.Flags().String("status", "", "Filter by status (draft/nurturing/promoted/archived)")
	ideaListCmd.Flags().Int("limit", 0, "Max number of Ideas to return")

	// Council flags
	councilListCmd.Flags().String("status", "", "Filter by status (active/adjourned/archived)")
	councilListCmd.Flags().Int("limit", 0, "Max number of Council Sessions to return")

	// Exploration flags
	explorationListCmd.Flags().String("status", "", "Filter by status (active/archived)")

	// Tool binding flags
	toolBindingListCmd.Flags().String("mission", "", "Scope to a Mission ID")
	toolBindingListCmd.Flags().String("agent", "", "Scope to an Agent ID")
	toolBindingListCmd.Flags().String("idea", "", "Scope to an Idea ID")
	toolBindingListCmd.Flags().String("council", "", "Scope to a Council Session ID")

	// Project flags
	projectHistoryCmd.Flags().String("since", "", "Only return messages after this RFC3339 timestamp")
	projectHistoryCmd.Flags().Int("limit", 0, "Max number of messages to return (default 100, max 500)")

	// Subcommand wiring
	missionCmd.AddCommand(missionListCmd, missionGetCmd)
	ideaCmd.AddCommand(ideaListCmd, ideaGetCmd)
	councilCmd.AddCommand(councilListCmd, councilGetCmd)
	explorationCmd.AddCommand(explorationListCmd, explorationGetCmd)
	toolBindingCmd.AddCommand(toolBindingListCmd, toolBindingGetCmd)
	// v1.2 onboarding history surface attaches to the existing project verb
	// declared in cmd_project.go (legacy v1.0 issue-classification CLI).
	projectCmd.AddCommand(projectHistoryCmd)
}
