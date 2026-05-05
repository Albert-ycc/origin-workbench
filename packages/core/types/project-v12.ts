// PRD §17 — v1.2 项目工作区. Named Project to clearly distinguish from the
// legacy v1.0 issue-classification "Project" (kept on the wire for backwards
// compat at /api/projects, but no longer surfaced in the product UI).

export type ProjectStatus = "active" | "paused" | "completed" | "archived";

export interface Project {
  id: string;
  workspace_id: string;
  team_id: string | null;
  // v1.2 — 项目主聊（chat_session）锚点。CreateProjectV12 时即写入；
  // 压缩（§17.4.5）会在归档旧主聊时把这个指针指向新建的空主聊。
  main_chat_session_id: string | null;
  title: string;
  description: string;
  local_dir: string;
  memory_doc: string;
  memory_doc_updated_at: string | null;
  compaction_count: number;
  status: ProjectStatus;
  created_at: string;
  updated_at: string;
}

export interface ProjectMainChat {
  chat_session_id: string;
  project_id: string;
  team_id: string;
  title: string;
  status: string;
}

export interface ListProjectsResponse {
  projects: Project[];
  total: number;
}

export interface CreateProjectRequest {
  // v1.2 第二轮简化：用户视角只剩"建项目"，团队从 agent 子集自动 find-or-create
  agent_ids?: string[];
  captain_agent_id?: string;
  // 兼容旧 desktop 客户端：直接传 team_id 也支持
  team_id?: string;
  title: string;
  description?: string;
  local_dir: string;
  memory_doc?: string;
}

export interface UpdateProjectRequest {
  title?: string;
  description?: string;
  status?: ProjectStatus;
  memory_doc?: string;
}

export interface AppendMemoryDocRequest {
  section?: string;
  body: string;
}

export interface AgentProjectMemory {
  id: string;
  agent_id: string;
  project_id: string;
  content: string;
  last_auto_compaction_at: string | null;
  created_at: string;
  updated_at: string;
}
