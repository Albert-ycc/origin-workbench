// PRD §17 — v1.2 项目工作区. Named Project to clearly distinguish from the
// legacy v1.0 issue-classification "Project" (kept on the wire for backwards
// compat at /api/projects, but no longer surfaced in the product UI).

export type ProjectStatus = "active" | "paused" | "completed" | "archived";

export interface Project {
  id: string;
  workspace_id: string;
  team_id: string | null;
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

export interface ListProjectsResponse {
  projects: Project[];
  total: number;
}

export interface CreateProjectRequest {
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
