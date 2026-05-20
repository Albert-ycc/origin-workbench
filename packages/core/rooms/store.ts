import { create } from "zustand";

// Chunk buffer: accumulates streaming message chunks per message_id.
// Kept in Zustand (not React Query) because chunks are transient display state,
// not server cache — there's nothing to refetch once the stream is complete.
interface RoomsState {
  /** Accumulated streamed text per message_id. Cleared on message completion. */
  chunkBuffer: Map<string, string>;
  /** Whether the left member sidebar is expanded. */
  memberSidebarOpen: boolean;

  appendChunk: (messageId: string, chunk: string) => void;
  completeMessage: (messageId: string, finalContent: string) => void;
  setMemberSidebarOpen: (open: boolean) => void;
}

export const useRoomsStore = create<RoomsState>((set, get) => ({
  chunkBuffer: new Map(),
  memberSidebarOpen: true,

  appendChunk: (messageId, chunk) => {
    const next = new Map(get().chunkBuffer);
    next.set(messageId, (next.get(messageId) ?? "") + chunk);
    set({ chunkBuffer: next });
  },

  completeMessage: (messageId, _finalContent) => {
    const next = new Map(get().chunkBuffer);
    next.delete(messageId);
    set({ chunkBuffer: next });
  },

  setMemberSidebarOpen: (open) => set({ memberSidebarOpen: open }),
}));
