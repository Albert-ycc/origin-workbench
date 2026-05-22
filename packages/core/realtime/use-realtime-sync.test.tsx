// @vitest-environment jsdom

import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WSClient } from "../api/ws-client";
import type { AuthState } from "../auth/store";
import { issueKeys } from "../issues/queries";
import { setCurrentWorkspace } from "../platform/workspace-storage";
import { projectKeys } from "../projects/queries";
import { projectV12Keys } from "../projects-v12/queries";
import { roomKeys } from "../rooms/queries";
import { teamKeys } from "../teams/queries";
import type { ListRoomMessagesResponse } from "../types";
import type { StoreApi, UseBoundStore } from "zustand";
import { useRealtimeSync } from "./use-realtime-sync";

vi.mock("../paths", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../paths")>();
  return {
    ...actual,
    useHasOnboarded: () => true,
  };
});

const wsId = "ws-1";

class FakeWS {
  handlers = new Map<string, Set<(payload: unknown) => void>>();
  anyHandlers = new Set<(msg: { type: string; payload: unknown }) => void>();
  reconnectHandlers = new Set<() => unknown>();

  on(type: string, handler: (payload: unknown) => void) {
    if (!this.handlers.has(type)) {
      this.handlers.set(type, new Set());
    }
    this.handlers.get(type)!.add(handler);
    return () => this.handlers.get(type)?.delete(handler);
  }

  onAny(handler: (msg: { type: string; payload: unknown }) => void) {
    this.anyHandlers.add(handler);
    return () => this.anyHandlers.delete(handler);
  }

  onReconnect(handler: () => unknown) {
    this.reconnectHandlers.add(handler);
    return () => this.reconnectHandlers.delete(handler);
  }

  emit(type: string, payload: unknown) {
    for (const handler of this.handlers.get(type) ?? []) {
      handler(payload);
    }
  }

  emitAny(type: string, payload: unknown = {}) {
    for (const handler of this.anyHandlers) {
      handler({ type, payload });
    }
  }

  async reconnect() {
    for (const handler of this.reconnectHandlers) {
      await handler();
    }
  }
}

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

function renderRealtimeSync(qc: QueryClient, ws: FakeWS) {
  const authStore = {
    getState: () => ({ user: { id: "user-1" } }),
  } as unknown as UseBoundStore<StoreApi<AuthState>>;
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return renderHook(
    () =>
      useRealtimeSync(ws as unknown as WSClient, {
        authStore,
      }),
    { wrapper },
  );
}

function invalidatedKeys(spy: ReturnType<typeof vi.spyOn>) {
  type InvalidateCall = [{ queryKey?: unknown }?, ...unknown[]];
  return (spy.mock.calls as InvalidateCall[]).map(([filters]) => filters?.queryKey);
}

async function flushEffects() {
  await act(async () => {
    await Promise.resolve();
  });
}

describe("useRealtimeSync", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setCurrentWorkspace("workspace", wsId);
  });

  afterEach(() => {
    setCurrentWorkspace(null, null);
    vi.useRealTimers();
  });

  it("invalidates legacy and v1.2 project caches for project events", async () => {
    const qc = createQueryClient();
    const ws = new FakeWS();
    const spy = vi.spyOn(qc, "invalidateQueries");

    renderRealtimeSync(qc, ws);
    await flushEffects();
    expect(ws.anyHandlers.size).toBe(1);

    act(() => {
      ws.emitAny("project:memory_doc_updated");
      vi.advanceTimersByTime(110);
    });

    expect(invalidatedKeys(spy)).toContainEqual(projectKeys.all(wsId));
    expect(invalidatedKeys(spy)).toContainEqual(projectV12Keys.all(wsId));
  });

  it("invalidates v1.2 project caches on reconnect", async () => {
    const qc = createQueryClient();
    const ws = new FakeWS();
    const spy = vi.spyOn(qc, "invalidateQueries");

    renderRealtimeSync(qc, ws);
    await flushEffects();
    expect(ws.reconnectHandlers.size).toBe(1);

    await act(async () => {
      await ws.reconnect();
    });

    expect(invalidatedKeys(spy)).toContainEqual(projectKeys.all(wsId));
    expect(invalidatedKeys(spy)).toContainEqual(projectV12Keys.all(wsId));
  });

  it("uses source_team_message_id from comment payloads to refresh delegation cards precisely", async () => {
    const qc = createQueryClient();
    const ws = new FakeWS();
    const spy = vi.spyOn(qc, "invalidateQueries");

    renderRealtimeSync(qc, ws);
    await flushEffects();
    expect(ws.handlers.has("comment:created")).toBe(true);

    act(() => {
      ws.emit("comment:created", {
        comment: { id: "comment-1", issue_id: "issue-1" },
        source_team_message_id: "source-message-1",
        source_team_session_id: "source-session-1",
      });
    });

    expect(invalidatedKeys(spy)).toContainEqual(issueKeys.timeline("issue-1"));
    expect(invalidatedKeys(spy)).toContainEqual(
      teamKeys.delegationCards(wsId, "source-message-1"),
    );
  });

  it("writes room message events into the room cache immediately", async () => {
    const qc = createQueryClient();
    const ws = new FakeWS();
    const spy = vi.spyOn(qc, "invalidateQueries");
    qc.setQueryData<ListRoomMessagesResponse>(roomKeys.messages("room-1"), {
      messages: [
        {
          id: "message-1",
          room_id: "room-1",
          sender_type: "user",
          sender_id: "user-1",
          sender_name: null,
          content: "有人吗",
          is_autonomous: false,
          created_at: "2026-05-21T00:00:01Z",
        },
      ],
    });

    renderRealtimeSync(qc, ws);
    await flushEffects();

    act(() => {
      ws.emit("room:message", {
        room_id: "room-1",
        message_id: "message-2",
        sender_type: "agent",
        sender_id: "agent-1",
        sender_name: "产品经理",
        content: "在，我先接一下。",
        is_autonomous: false,
        created_at: "2026-05-21T00:00:02Z",
      });
      ws.emit("room:message", {
        room_id: "room-1",
        message_id: "message-2",
        sender_type: "agent",
        sender_id: "agent-1",
        sender_name: "产品经理",
        content: "在，我先接一下。",
        is_autonomous: false,
        created_at: "2026-05-21T00:00:02Z",
      });
    });

    const data = qc.getQueryData<ListRoomMessagesResponse>(roomKeys.messages("room-1"));
    expect(data?.messages).toHaveLength(2);
    expect(data?.messages[1]).toMatchObject({
      id: "message-2",
      sender_type: "agent",
      sender_name: "产品经理",
      content: "在，我先接一下。",
    });
    expect(invalidatedKeys(spy)).toContainEqual(roomKeys.messages("room-1"));
  });
});
