/**
 * TestApiClient — lightweight API helper for E2E test data setup/teardown.
 *
 * Uses raw fetch so E2E tests have zero build-time coupling to the web app.
 */

import "./env";
import pg from "pg";

// `||` (not `??`) so an empty `NEXT_PUBLIC_API_URL=` in .env still falls
// back to localhost. dotenv sets unset-vs-empty both as "" — treating them
// the same matches user intent.
const API_BASE = process.env.NEXT_PUBLIC_API_URL || `http://localhost:${process.env.PORT || "8080"}`;
const DATABASE_URL = process.env.E2E_DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error("E2E_DATABASE_URL is required; refusing to write a default local database");
}

interface TestWorkspace {
  id: string;
  name: string;
  slug: string;
}

export class TestApiClient {
  private token: string | null = null;
  private userId: string | null = null;
  private workspaceSlug: string | null = null;
  private workspaceId: string | null = null;
  private createdIssueIds: string[] = [];
  private createdProjectIds: string[] = [];
  private createdTeamIds: string[] = [];
  private createdAgentIds: string[] = [];
  private createdRuntimeIds: string[] = [];

  async login(email: string, name: string) {
    const client = new pg.Client(DATABASE_URL);
    await client.connect();
    try {
      // Keep each E2E login isolated so previous test runs do not trip the
      // per-email send-code rate limit.
      await client.query("DELETE FROM verification_code WHERE email = $1", [email]);

      // Step 1: Send verification code
      const sendRes = await fetch(`${API_BASE}/auth/send-code`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (!sendRes.ok) {
        throw new Error(`send-code failed: ${sendRes.status}`);
      }

      // Step 2: Read code from database
      const result = await client.query(
        "SELECT code FROM verification_code WHERE email = $1 AND used = FALSE AND expires_at > now() ORDER BY created_at DESC LIMIT 1",
        [email],
      );
      if (result.rows.length === 0) {
        throw new Error(`No verification code found for ${email}`);
      }

      // Step 3: Verify code to get JWT
      const verifyRes = await fetch(`${API_BASE}/auth/verify-code`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, code: result.rows[0].code }),
      });
      if (!verifyRes.ok) {
        throw new Error(`verify-code failed: ${verifyRes.status}`);
      }
      const data = await verifyRes.json();

      this.token = data.token;
      this.userId = data.user?.id ?? null;

      // Update user name if needed
      if (name && data.user?.name !== name) {
        await this.authedFetch("/api/me", {
          method: "PATCH",
          body: JSON.stringify({ name }),
        });
      }

      await client.query("DELETE FROM verification_code WHERE email = $1", [email]);

      return data;
    } finally {
      await client.end();
    }
  }

  async getWorkspaces(): Promise<TestWorkspace[]> {
    const res = await this.authedFetch("/api/workspaces");
    return res.json();
  }

  setWorkspaceId(id: string) {
    this.workspaceId = id;
  }

  setWorkspaceSlug(slug: string) {
    this.workspaceSlug = slug;
  }

  async ensureWorkspace(name = "E2E Workspace", slug = "e2e-workspace") {
    const workspaces = await this.getWorkspaces();
    const workspace = workspaces.find((item) => item.slug === slug);
    if (workspace) {
      this.workspaceId = workspace.id;
      this.workspaceSlug = workspace.slug;
      return workspace;
    }

    const res = await this.authedFetch("/api/workspaces", {
      method: "POST",
      body: JSON.stringify({ name, slug }),
    });
    if (res.ok) {
      const created = (await res.json()) as TestWorkspace;
      this.workspaceId = created.id;
      this.workspaceSlug = created.slug;
      return created;
    }

    const refreshed = await this.getWorkspaces();
    const created = refreshed.find((item) => item.slug === slug);
    if (created) {
      this.workspaceId = created.id;
      this.workspaceSlug = created.slug;
      return created;
    }

    throw new Error(`Failed to ensure workspace ${slug}: ${res.status} ${res.statusText}`);
  }

  async createIssue(title: string, opts?: Record<string, unknown>) {
    const res = await this.authedFetch("/api/issues", {
      method: "POST",
      body: JSON.stringify({ title, ...opts }),
    });
    const issue = await res.json();
    this.createdIssueIds.push(issue.id);
    return issue;
  }

  async deleteIssue(id: string) {
    await this.authedFetch(`/api/issues/${id}`, { method: "DELETE" });
  }

  /** Clean up all issues created during this test. */
  async cleanup() {
    for (const id of this.createdIssueIds) {
      try {
        await this.deleteIssue(id);
      } catch {
        /* ignore — may already be deleted */
      }
    }
    this.createdIssueIds = [];
    const client = new pg.Client(DATABASE_URL);
    await client.connect();
    try {
      for (const id of this.createdProjectIds) {
        await client.query("DELETE FROM project WHERE id = $1", [id]);
      }
      for (const id of this.createdTeamIds) {
        await client.query("DELETE FROM team WHERE id = $1", [id]);
      }
      for (const id of this.createdAgentIds) {
        await client.query("DELETE FROM agent WHERE id = $1", [id]);
      }
      for (const id of this.createdRuntimeIds) {
        await client.query("DELETE FROM agent_runtime WHERE id = $1", [id]);
      }
    } finally {
      await client.end();
      this.createdProjectIds = [];
      this.createdTeamIds = [];
      this.createdAgentIds = [];
      this.createdRuntimeIds = [];
    }
  }

  getToken() {
    return this.token;
  }

  getWorkspaceId() {
    return this.workspaceId;
  }

  async createOriginProjectFixture(label: string) {
    if (!this.workspaceId || !this.userId) {
      throw new Error("createOriginProjectFixture requires login() and ensureWorkspace()");
    }
    const client = new pg.Client(DATABASE_URL);
    await client.connect();
    try {
      const runtime = await client.query<{ id: string }>(
        `
          INSERT INTO agent_runtime (
            workspace_id, daemon_id, name, runtime_mode, provider, status,
            device_info, metadata, owner_id, last_seen_at
          )
          VALUES ($1, NULL, $2, 'cloud', 'origin_e2e', 'online', $3, '{}'::jsonb, $4, now())
          RETURNING id
        `,
        [this.workspaceId, `${label} Runtime`, "origin e2e runtime", this.userId],
      );
      const runtimeId = runtime.rows[0].id;
      this.createdRuntimeIds.push(runtimeId);
      const captain = await this.insertAgent(client, `${label} Captain`, runtimeId);
      const member = await this.insertAgent(client, `${label} Builder`, runtimeId);

      const projectRes = await this.authedFetch("/api/v12/projects", {
        method: "POST",
        body: JSON.stringify({
          title: `${label} Project`,
          description: "Origin smoke project",
          local_dir: `/tmp/${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
          agent_ids: [captain.id, member.id],
          captain_agent_id: captain.id,
        }),
      });
      if (!projectRes.ok) {
        throw new Error(`create project failed: ${projectRes.status} ${await projectRes.text()}`);
      }
      const project = await projectRes.json();
      this.createdProjectIds.push(project.id);
      if (project.team_id) this.createdTeamIds.push(project.team_id);
      const mainChatRes = await this.authedFetch(`/api/v12/projects/${project.id}/main-chat`);
      if (!mainChatRes.ok) {
        throw new Error(`load project main chat failed: ${mainChatRes.status}`);
      }
      const mainChat = await mainChatRes.json();

      const sourceMessage = await client.query<{ id: string }>(
        `
          INSERT INTO chat_message (chat_session_id, role, content, sender_agent_id)
          VALUES ($1, 'assistant', $2, $3)
          RETURNING id
        `,
        [
          mainChat.chat_session_id,
          `@${member.name} 请完成 Origin smoke 派活验证。`,
          captain.id,
        ],
      );
      const issueNumber = await client.query<{ next_number: number }>(
        `SELECT COALESCE(MAX(number), 0) + 1 AS next_number FROM issue WHERE workspace_id = $1`,
        [this.workspaceId],
      );
      const issue = await client.query<{ id: string; number: number }>(
        `
          INSERT INTO issue (
            workspace_id, title, status, priority,
            assignee_type, assignee_id, creator_type, creator_id,
            number, position, project_id, source_team_message_id, source_team_session_id
          )
          VALUES ($1, $2, 'in_review', 'medium', 'agent', $3, 'member', $4, $5, 0, $6, $7, $8)
          RETURNING id, number
        `,
        [
          this.workspaceId,
          `${label} delegated task`,
          member.id,
          this.userId,
          issueNumber.rows[0].next_number,
          project.id,
          sourceMessage.rows[0].id,
          mainChat.chat_session_id,
        ],
      );
      this.createdIssueIds.push(issue.rows[0].id);
      await client.query(
        `
          INSERT INTO comment (issue_id, workspace_id, author_type, author_id, content, type)
          VALUES ($1, $2, 'agent', $3, $4, 'comment')
        `,
        [
          issue.rows[0].id,
          this.workspaceId,
          member.id,
          "Initial Origin smoke result preview",
        ],
      );

      return {
        project,
        teamId: project.team_id as string,
        captain,
        member,
        sourceMessageId: sourceMessage.rows[0].id,
        issueId: issue.rows[0].id,
        issueTitle: `${label} delegated task`,
        issueNumber: issue.rows[0].number,
      };
    } finally {
      await client.end();
    }
  }

  private async insertAgent(client: pg.Client, name: string, runtimeId: string) {
    if (!this.workspaceId || !this.userId) {
      throw new Error("insertAgent requires workspace and user context");
    }
    const result = await client.query<{ id: string; name: string }>(
      `
        INSERT INTO agent (
          workspace_id, name, description, runtime_mode, runtime_config,
          runtime_id, visibility, max_concurrent_tasks, owner_id
        )
        VALUES ($1, $2, '', 'cloud', '{}'::jsonb, $3, 'workspace', 1, $4)
        RETURNING id, name
      `,
      [this.workspaceId, name, runtimeId, this.userId],
    );
    this.createdAgentIds.push(result.rows[0].id);
    return result.rows[0];
  }

  private async authedFetch(path: string, init?: RequestInit) {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...((init?.headers as Record<string, string>) ?? {}),
    };
    if (this.token) headers["Authorization"] = `Bearer ${this.token}`;
    if (this.workspaceSlug) headers["X-Workspace-Slug"] = this.workspaceSlug;
    else if (this.workspaceId) headers["X-Workspace-ID"] = this.workspaceId;
    return fetch(`${API_BASE}${path}`, { ...init, headers });
  }
}
