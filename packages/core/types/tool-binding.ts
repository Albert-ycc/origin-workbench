export type ToolBindingType =
  | "lark_doc"
  | "lark_whiteboard"
  | "figma_file"
  | "obsidian_note"
  | "local_repo";

// resource_ref 是 tool-specific 的 JSON 载荷。所有 tool_type 都有 url，
// 同时按需扩展（doc_token / fileKey / vault / path 等）。前端展示时取
// url 作为主要显示，缺 url 时按 path / fileKey 兜底。
export interface ToolBindingResourceRef {
  url?: string;
  // Lark doc
  doc_token?: string;
  // Lark whiteboard
  whiteboard_token?: string;
  // Figma
  fileKey?: string;
  nodeId?: string;
  // Obsidian
  vault?: string;
  path?: string;
  // Local repo
  // (path 复用上面的 path 字段)
  [key: string]: unknown;
}

export interface ToolBinding {
  id: string;
  workspace_id: string;
  created_by_user_id: string;
  tool_type: ToolBindingType;
  resource_ref: ToolBindingResourceRef;
  label: string;
  write_enabled: boolean;
  mission_id: string | null;
  agent_id: string | null;
  idea_id: string | null;
  council_session_id: string | null;
  project_id: string | null;
  last_synced_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateToolBindingRequest {
  tool_type: ToolBindingType;
  resource_ref: ToolBindingResourceRef;
  label?: string;
  write_enabled?: boolean;
  mission_id?: string;
  agent_id?: string;
  idea_id?: string;
  council_session_id?: string;
  project_id?: string;
}

export interface UpdateToolBindingRequest {
  label?: string;
  resource_ref?: ToolBindingResourceRef;
  write_enabled?: boolean;
}

export interface ListToolBindingsResponse {
  bindings: ToolBinding[];
  total: number;
}

export interface ToolBindingFilter {
  mission_id?: string;
  agent_id?: string;
  idea_id?: string;
  council_session_id?: string;
  project_id?: string;
}
