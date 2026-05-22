import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiClient, ApiError } from "./client";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ApiClient", () => {
  it("preserves HTTP status on failed requests", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: "workspace slug already exists" }), {
          status: 409,
          statusText: "Conflict",
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );

    const client = new ApiClient("https://api.example.test");

    try {
      await client.createWorkspace({ name: "Test", slug: "test" });
      throw new Error("expected createWorkspace to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect(error).toMatchObject({
        message: "workspace slug already exists",
        status: 409,
        statusText: "Conflict",
      });
    }
  });

  it("uses the expected HTTP contract for autopilot endpoints", async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(
      new Response(JSON.stringify({ autopilots: [], runs: [], total: 0 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ));
    vi.stubGlobal("fetch", fetchMock);

    const client = new ApiClient("https://api.example.test");

    await client.listAutopilots({ status: "active" });
    await client.getAutopilot("ap-1");
    await client.createAutopilot({
      title: "Daily triage",
      assignee_id: "agent-1",
      execution_mode: "create_issue",
    });
    await client.updateAutopilot("ap-1", { status: "paused" });
    await client.deleteAutopilot("ap-1");
    await client.triggerAutopilot("ap-1");
    await client.listAutopilotRuns("ap-1", { limit: 10, offset: 20 });
    await client.createAutopilotTrigger("ap-1", {
      kind: "schedule",
      cron_expression: "0 9 * * *",
      timezone: "UTC",
    });
    await client.updateAutopilotTrigger("ap-1", "tr-1", { enabled: false });
    await client.deleteAutopilotTrigger("ap-1", "tr-1");

    const calls = fetchMock.mock.calls.map(([url, init]) => ({
      url,
      method: init?.method ?? "GET",
      body: init?.body,
    }));

    expect(calls).toMatchObject([
      { url: "https://api.example.test/api/autopilots?status=active", method: "GET" },
      { url: "https://api.example.test/api/autopilots/ap-1", method: "GET" },
      {
        url: "https://api.example.test/api/autopilots",
        method: "POST",
        body: JSON.stringify({
          title: "Daily triage",
          assignee_id: "agent-1",
          execution_mode: "create_issue",
        }),
      },
      {
        url: "https://api.example.test/api/autopilots/ap-1",
        method: "PATCH",
        body: JSON.stringify({ status: "paused" }),
      },
      { url: "https://api.example.test/api/autopilots/ap-1", method: "DELETE" },
      { url: "https://api.example.test/api/autopilots/ap-1/trigger", method: "POST" },
      { url: "https://api.example.test/api/autopilots/ap-1/runs?limit=10&offset=20", method: "GET" },
      {
        url: "https://api.example.test/api/autopilots/ap-1/triggers",
        method: "POST",
        body: JSON.stringify({
          kind: "schedule",
          cron_expression: "0 9 * * *",
          timezone: "UTC",
        }),
      },
      {
        url: "https://api.example.test/api/autopilots/ap-1/triggers/tr-1",
        method: "PATCH",
        body: JSON.stringify({ enabled: false }),
      },
      { url: "https://api.example.test/api/autopilots/ap-1/triggers/tr-1", method: "DELETE" },
    ]);
  });

  it("emits X-Client-* headers when identity is configured", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = new ApiClient("https://api.example.test", {
      identity: { platform: "desktop", version: "1.2.3", os: "macos" },
    });
    await client.listWorkspaces();

    const headers = fetchMock.mock.calls[0]![1]!.headers as Record<string, string>;
    expect(headers["X-Client-Platform"]).toBe("desktop");
    expect(headers["X-Client-Version"]).toBe("1.2.3");
    expect(headers["X-Client-OS"]).toBe("macos");
  });

  it("omits X-Client-* headers when identity is not configured", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = new ApiClient("https://api.example.test");
    await client.listWorkspaces();

    const headers = fetchMock.mock.calls[0]![1]!.headers as Record<string, string>;
    expect(headers["X-Client-Platform"]).toBeUndefined();
    expect(headers["X-Client-Version"]).toBeUndefined();
    expect(headers["X-Client-OS"]).toBeUndefined();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Phase 1 落地的是 /api/ideas（与 mission/team 等对象同级命名空间）。
  // 下面这条 baseline 是 Codex v1.1 全量预测试，覆盖 Council / Exploration /
  // ToolBinding / UserProfile 等还没实现的对象，Phase 2-4 实现后激活并对齐
  // 端点路径（确认走 /api/origin/* 还是 /api/* 平铺）。
  // ─────────────────────────────────────────────────────────────────────────

  it("issues HTTP contract for Origin Mission endpoints", async () => {
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ missions: [], total: 0 }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = new ApiClient("https://api.example.test");

    await client.listMissions("active");
    await client.listMissions("archived");
    await client.listMissions({ status: "active", project_id: "project-1" });
    await client.createMission({
      project_id: "project-1",
      title: "项目内 Mission",
      prompt: "把项目右栏接成真实入口",
      captain_agent_id: "agent-1",
    });

    const calls = fetchMock.mock.calls.map(([url, init]) => ({
      url,
      method: init?.method ?? "GET",
      body: init?.body,
    }));

    expect(calls).toMatchObject([
      { url: "https://api.example.test/api/missions", method: "GET" },
      { url: "https://api.example.test/api/missions?status=archived", method: "GET" },
      { url: "https://api.example.test/api/missions?project_id=project-1", method: "GET" },
      {
        url: "https://api.example.test/api/missions",
        method: "POST",
        body: JSON.stringify({
          project_id: "project-1",
          title: "项目内 Mission",
          prompt: "把项目右栏接成真实入口",
          captain_agent_id: "agent-1",
        }),
      },
    ]);
  });

  it("issues HTTP contract for Origin Idea endpoints", async () => {
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ ideas: [], total: 0 }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = new ApiClient("https://api.example.test");

    await client.listIdeas("active");
    await client.listIdeas("archived");
    await client.listIdeas({ status: "active", project_id: "project-1" });
    await client.getIdea("idea-1");
    await client.createIdea({
      project_id: "project-1",
      title: "PRD 养鱼",
      description: "先收进想法池",
      nurturer_agent_id: "agent-1",
      tags: ["prd"],
    });
    await client.updateIdea("idea-1", { title: "PRD 养鱼 v2", tags: ["prd", "v2"] });
    await client.archiveIdea("idea-1");
    await client.deleteIdea("idea-1");
    await client.createIdeaNote("idea-1", { summary: "新视角", kind: "new_angle" });
    await client.deleteIdeaNote("idea-1", "note-1");
    await client.promoteIdea("idea-1", {
      title: "PRD 养鱼转 Mission",
      captain_agent_id: "agent-1",
      member_agent_ids: ["agent-2"],
    });

    const calls = fetchMock.mock.calls.map(([url, init]) => ({
      url,
      method: init?.method ?? "GET",
      body: init?.body,
    }));

    expect(calls).toMatchObject([
      { url: "https://api.example.test/api/ideas", method: "GET" },
      { url: "https://api.example.test/api/ideas?status=archived", method: "GET" },
      { url: "https://api.example.test/api/ideas?project_id=project-1", method: "GET" },
      { url: "https://api.example.test/api/ideas/idea-1", method: "GET" },
      {
        url: "https://api.example.test/api/ideas",
        method: "POST",
        body: JSON.stringify({
          project_id: "project-1",
          title: "PRD 养鱼",
          description: "先收进想法池",
          nurturer_agent_id: "agent-1",
          tags: ["prd"],
        }),
      },
      {
        url: "https://api.example.test/api/ideas/idea-1",
        method: "PATCH",
        body: JSON.stringify({ title: "PRD 养鱼 v2", tags: ["prd", "v2"] }),
      },
      { url: "https://api.example.test/api/ideas/idea-1/archive", method: "POST" },
      { url: "https://api.example.test/api/ideas/idea-1", method: "DELETE" },
      {
        url: "https://api.example.test/api/ideas/idea-1/notes",
        method: "POST",
        body: JSON.stringify({ summary: "新视角", kind: "new_angle" }),
      },
      { url: "https://api.example.test/api/ideas/idea-1/notes/note-1", method: "DELETE" },
      {
        url: "https://api.example.test/api/ideas/idea-1/promote",
        method: "POST",
        body: JSON.stringify({
          title: "PRD 养鱼转 Mission",
          captain_agent_id: "agent-1",
          member_agent_ids: ["agent-2"],
        }),
      },
    ]);
  });

  it("issues HTTP contract for Origin Council Session endpoints", async () => {
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ sessions: [], total: 0 }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = new ApiClient("https://api.example.test");

    await client.listCouncilSessions("active");
    await client.listCouncilSessions("archived");
    await client.getCouncilSession("c-1");
    await client.createCouncilSession({
      topic: "营养库 schema 三选一",
      activity_level: "concise",
      participant_agent_ids: ["agent-1", "agent-2"],
    });
    await client.updateCouncilSession("c-1", {
      summary: "已对齐方向",
      activity_level: "lively",
    });
    await client.adjournCouncilSession("c-1", { conclusion: "采用方案 B" });
    await client.archiveCouncilSession("c-1");
    await client.deleteCouncilSession("c-1");
    await client.addCouncilParticipant("c-1", { agent_id: "agent-3", role: "member" });
    await client.removeCouncilParticipant("c-1", "agent-3");

    const calls = fetchMock.mock.calls.map(([url, init]) => ({
      url,
      method: init?.method ?? "GET",
      body: init?.body,
    }));

    expect(calls).toMatchObject([
      { url: "https://api.example.test/api/council-sessions", method: "GET" },
      { url: "https://api.example.test/api/council-sessions?status=archived", method: "GET" },
      { url: "https://api.example.test/api/council-sessions/c-1", method: "GET" },
      {
        url: "https://api.example.test/api/council-sessions",
        method: "POST",
        body: JSON.stringify({
          topic: "营养库 schema 三选一",
          activity_level: "concise",
          participant_agent_ids: ["agent-1", "agent-2"],
        }),
      },
      {
        url: "https://api.example.test/api/council-sessions/c-1",
        method: "PATCH",
        body: JSON.stringify({ summary: "已对齐方向", activity_level: "lively" }),
      },
      {
        url: "https://api.example.test/api/council-sessions/c-1/adjourn",
        method: "POST",
        body: JSON.stringify({ conclusion: "采用方案 B" }),
      },
      { url: "https://api.example.test/api/council-sessions/c-1/archive", method: "POST" },
      { url: "https://api.example.test/api/council-sessions/c-1", method: "DELETE" },
      {
        url: "https://api.example.test/api/council-sessions/c-1/participants",
        method: "POST",
        body: JSON.stringify({ agent_id: "agent-3", role: "member" }),
      },
      {
        url: "https://api.example.test/api/council-sessions/c-1/participants/agent-3",
        method: "DELETE",
      },
    ]);
  });

  it("issues HTTP contract for Origin Exploration endpoints", async () => {
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ explorations: [], total: 0 }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = new ApiClient("https://api.example.test");

    await client.listExplorations("active");
    await client.listExplorations("archived");
    await client.listExplorations({ status: "active", project_id: "project-1" });
    await client.getExploration("e-1");
    await client.createExploration({
      project_id: "project-1",
      topic: "营养库 schema 单表 vs 分表",
      question: "选哪个更适合长期演化？",
    });
    await client.updateExploration("e-1", {
      status: "converging",
      decision: "倾向单表",
    });
    await client.archiveExploration("e-1");
    await client.deleteExploration("e-1");
    await client.createExplorationBranch("e-1", {
      title: "分支 A · 单表",
      core_proposal: "client_id 复合索引",
    });
    await client.updateExplorationBranch("e-1", "b-1", {
      verdict: "winning",
    });
    await client.deleteExplorationBranch("e-1", "b-1");

    const calls = fetchMock.mock.calls.map(([url, init]) => ({
      url,
      method: init?.method ?? "GET",
      body: init?.body,
    }));

    expect(calls).toMatchObject([
      { url: "https://api.example.test/api/explorations", method: "GET" },
      { url: "https://api.example.test/api/explorations?status=archived", method: "GET" },
      { url: "https://api.example.test/api/explorations?project_id=project-1", method: "GET" },
      { url: "https://api.example.test/api/explorations/e-1", method: "GET" },
      {
        url: "https://api.example.test/api/explorations",
        method: "POST",
        body: JSON.stringify({
          project_id: "project-1",
          topic: "营养库 schema 单表 vs 分表",
          question: "选哪个更适合长期演化？",
        }),
      },
      {
        url: "https://api.example.test/api/explorations/e-1",
        method: "PATCH",
        body: JSON.stringify({ status: "converging", decision: "倾向单表" }),
      },
      { url: "https://api.example.test/api/explorations/e-1/archive", method: "POST" },
      { url: "https://api.example.test/api/explorations/e-1", method: "DELETE" },
      {
        url: "https://api.example.test/api/explorations/e-1/branches",
        method: "POST",
        body: JSON.stringify({
          title: "分支 A · 单表",
          core_proposal: "client_id 复合索引",
        }),
      },
      {
        url: "https://api.example.test/api/explorations/e-1/branches/b-1",
        method: "PATCH",
        body: JSON.stringify({ verdict: "winning" }),
      },
      {
        url: "https://api.example.test/api/explorations/e-1/branches/b-1",
        method: "DELETE",
      },
    ]);
  });

  it("issues HTTP contract for Origin Tool Binding endpoints", async () => {
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ bindings: [], total: 0 }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = new ApiClient("https://api.example.test");

    await client.listToolBindings();
    await client.listToolBindings({ mission_id: "m-1" });
    await client.getToolBinding("tb-1");
    await client.createToolBinding({
      tool_type: "lark_doc",
      resource_ref: { url: "https://x.feishu.cn/docx/abc" },
      label: "PRD",
      mission_id: "m-1",
    });
    await client.updateToolBinding("tb-1", { write_enabled: true });
    await client.deleteToolBinding("tb-1");

    const calls = fetchMock.mock.calls.map(([url, init]) => ({
      url,
      method: init?.method ?? "GET",
      body: init?.body,
    }));

    expect(calls).toMatchObject([
      { url: "https://api.example.test/api/tool-bindings", method: "GET" },
      { url: "https://api.example.test/api/tool-bindings?mission_id=m-1", method: "GET" },
      { url: "https://api.example.test/api/tool-bindings/tb-1", method: "GET" },
      {
        url: "https://api.example.test/api/tool-bindings",
        method: "POST",
        body: JSON.stringify({
          tool_type: "lark_doc",
          resource_ref: { url: "https://x.feishu.cn/docx/abc" },
          label: "PRD",
          mission_id: "m-1",
        }),
      },
      {
        url: "https://api.example.test/api/tool-bindings/tb-1",
        method: "PATCH",
        body: JSON.stringify({ write_enabled: true }),
      },
      { url: "https://api.example.test/api/tool-bindings/tb-1", method: "DELETE" },
    ]);
  });

  it("issues HTTP contract for Origin Mailbox endpoints", async () => {
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ items: [], total: 0 }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = new ApiClient("https://api.example.test");

    await client.listMailboxItems();
    await client.listMailboxItems({ limit: 5, offset: 10 });
    await client.listMailboxItems({ agent_id: "a-1" });
    await client.getMailboxItem("mb-1");

    const calls = fetchMock.mock.calls.map(([url, init]) => ({
      url,
      method: init?.method ?? "GET",
    }));

    expect(calls).toMatchObject([
      { url: "https://api.example.test/api/mailbox-items", method: "GET" },
      { url: "https://api.example.test/api/mailbox-items?limit=5&offset=10", method: "GET" },
      { url: "https://api.example.test/api/mailbox-items?agent_id=a-1", method: "GET" },
      { url: "https://api.example.test/api/mailbox-items/mb-1", method: "GET" },
    ]);
  });

  it("issues DELETE requests for room, project workspace, and meeting records", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 204,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = new ApiClient("https://api.example.test");

    await client.deleteRoom("room-1");
    await client.deleteProjectV12("project-1");
    await client.deleteMeeting("meeting-1");

    const calls = fetchMock.mock.calls.map(([url, init]) => ({
      url,
      method: init?.method ?? "GET",
    }));

    expect(calls).toMatchObject([
      { url: "https://api.example.test/api/rooms/room-1", method: "DELETE" },
      { url: "https://api.example.test/api/v12/projects/project-1", method: "DELETE" },
      { url: "https://api.example.test/api/v13/meetings/meeting-1", method: "DELETE" },
    ]);
  });
});
