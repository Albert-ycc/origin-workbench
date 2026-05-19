export const DEV_WEBSOCKET_ORIGIN_BYPASS_ENV =
  "ORIGIN_ENABLE_DEV_WEBSOCKET_ORIGIN_BYPASS";

type Environment = Record<string, string | undefined>;
type RequestHeaders = Record<string, string>;

export interface WebRequestHeaderDetails {
  url: string;
  requestHeaders: RequestHeaders;
}

export type BeforeSendHeadersCallback = (response: {
  requestHeaders: RequestHeaders;
}) => void;

export function getMainWindowWebPreferences(preload: string): {
  preload: string;
  sandbox: true;
  webSecurity: true;
  contextIsolation: true;
  nodeIntegration: false;
  allowRunningInsecureContent: false;
} {
  return {
    preload,
    sandbox: true,
    webSecurity: true,
    contextIsolation: true,
    nodeIntegration: false,
    allowRunningInsecureContent: false,
  };
}

export function isLocalDevelopmentWebSocketOriginBypassEnabled(
  env: Environment = process.env,
): boolean {
  return env[DEV_WEBSOCKET_ORIGIN_BYPASS_ENV] === "1";
}

export function stripWebSocketOriginForLocalDev(
  details: WebRequestHeaderDetails,
  callback: BeforeSendHeadersCallback,
  env: Environment = process.env,
): void {
  const requestHeaders = { ...details.requestHeaders };
  if (shouldStripWebSocketOrigin(details, env)) {
    deleteHeader(requestHeaders, "origin");
  }
  callback({ requestHeaders });
}

function shouldStripWebSocketOrigin(
  details: WebRequestHeaderDetails,
  env: Environment,
): boolean {
  if (!isLocalDevelopmentWebSocketOriginBypassEnabled(env)) return false;

  const requestUrl = parseUrl(details.url);
  if (requestUrl === null) return false;
  if (requestUrl.protocol !== "ws:" && requestUrl.protocol !== "wss:") {
    return false;
  }
  if (!isLoopbackHost(requestUrl.hostname)) return false;

  const origin = getHeader(details.requestHeaders, "origin");
  if (!origin) return false;

  const originUrl = parseUrl(origin);
  if (originUrl === null) return false;
  if (originUrl.protocol !== "http:" && originUrl.protocol !== "https:") {
    return false;
  }
  return isLoopbackHost(originUrl.hostname);
}

function parseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function isLoopbackHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[/, "").replace(/\]$/, "");
  return (
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "::1"
  );
}

function getHeader(
  headers: RequestHeaders,
  headerName: string,
): string | undefined {
  const normalizedName = headerName.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === normalizedName) return value;
  }
  return undefined;
}

function deleteHeader(headers: RequestHeaders, headerName: string): void {
  const normalizedName = headerName.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === normalizedName) {
      delete headers[key];
    }
  }
}
