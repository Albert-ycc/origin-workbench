export type MailboxItemStatus = "processing" | "done" | "blocked" | "timeout";

// Wire shape that backs PRD §15.2 block 6 ("信箱回报") and the agent detail
// mailbox tab. Created and mutated only by the chat dispatch path on the
// backend — frontends consume these read-only.
export interface MailboxItem {
  id: string;
  workspace_id: string;
  agent_id: string;
  chat_session_id: string;
  task_id: string | null;
  raw_user_message: string;
  status: MailboxItemStatus;
  result: string;
  blocked_description: string;
  submitted_at: string;
  processing_started_at: string | null;
  processing_finished_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ListMailboxItemsResponse {
  items: MailboxItem[];
  total: number;
}

export interface MailboxItemFilter {
  agent_id?: string;
  limit?: number;
  offset?: number;
}
