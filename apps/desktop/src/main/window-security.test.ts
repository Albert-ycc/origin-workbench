import { describe, expect, it, vi } from "vitest";

import {
  DEV_WEBSOCKET_ORIGIN_BYPASS_ENV,
  getMainWindowWebPreferences,
  isLocalDevelopmentWebSocketOriginBypassEnabled,
  stripWebSocketOriginForLocalDev,
} from "./window-security";

describe("getMainWindowWebPreferences", () => {
  it("keeps renderer isolation and browser security enabled by default", () => {
    expect(getMainWindowWebPreferences("/tmp/preload.js")).toMatchObject({
      preload: "/tmp/preload.js",
      sandbox: true,
      webSecurity: true,
      contextIsolation: true,
      nodeIntegration: false,
    });
  });
});

describe("isLocalDevelopmentWebSocketOriginBypassEnabled", () => {
  it("requires an explicit local development opt-in", () => {
    expect(isLocalDevelopmentWebSocketOriginBypassEnabled({})).toBe(false);
    expect(
      isLocalDevelopmentWebSocketOriginBypassEnabled({
        [DEV_WEBSOCKET_ORIGIN_BYPASS_ENV]: "true",
      }),
    ).toBe(false);
    expect(
      isLocalDevelopmentWebSocketOriginBypassEnabled({
        [DEV_WEBSOCKET_ORIGIN_BYPASS_ENV]: "1",
      }),
    ).toBe(true);
  });
});

describe("stripWebSocketOriginForLocalDev", () => {
  it("does not strip Origin headers by default", () => {
    const callback = vi.fn();

    stripWebSocketOriginForLocalDev(
      {
        url: "ws://localhost:3001/realtime",
        requestHeaders: {
          Origin: "http://localhost:5173",
          Accept: "*/*",
        },
      },
      callback,
      {},
    );

    expect(callback).toHaveBeenCalledWith({
      requestHeaders: {
        Origin: "http://localhost:5173",
        Accept: "*/*",
      },
    });
  });

  it("strips Origin only for explicitly opted-in local dev websocket requests", () => {
    const callback = vi.fn();

    stripWebSocketOriginForLocalDev(
      {
        url: "ws://127.0.0.1:3001/realtime",
        requestHeaders: {
          Origin: "http://localhost:5173",
          Accept: "*/*",
        },
      },
      callback,
      { [DEV_WEBSOCKET_ORIGIN_BYPASS_ENV]: "1" },
    );

    expect(callback).toHaveBeenCalledWith({
      requestHeaders: {
        Accept: "*/*",
      },
    });
  });

  it("keeps Origin for remote websocket targets even when the dev bypass is enabled", () => {
    const callback = vi.fn();

    stripWebSocketOriginForLocalDev(
      {
        url: "wss://api.example.com/realtime",
        requestHeaders: {
          Origin: "http://localhost:5173",
        },
      },
      callback,
      { [DEV_WEBSOCKET_ORIGIN_BYPASS_ENV]: "1" },
    );

    expect(callback).toHaveBeenCalledWith({
      requestHeaders: {
        Origin: "http://localhost:5173",
      },
    });
  });
});
