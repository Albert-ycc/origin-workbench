const API_URL_STORAGE_KEY = "origin_mobile_api_base_url";
const DEFAULT_BACKEND_PORT = "8080";

function normalizeUrl(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

function browserDerivedDefault(): string {
  const envUrl = import.meta.env.VITE_API_URL;
  if (envUrl) return normalizeUrl(envUrl);

  if (typeof window === "undefined") {
    return `http://localhost:${DEFAULT_BACKEND_PORT}`;
  }

  const { protocol, hostname } = window.location;
  if (!hostname || hostname === "localhost" || hostname === "127.0.0.1") {
    return `http://localhost:${DEFAULT_BACKEND_PORT}`;
  }

  return `${protocol}//${hostname}:${DEFAULT_BACKEND_PORT}`;
}

export function getDefaultApiBaseUrl(): string {
  return browserDerivedDefault();
}

export function getStoredApiBaseUrl(): string {
  if (typeof window === "undefined") return getDefaultApiBaseUrl();
  const stored = window.localStorage.getItem(API_URL_STORAGE_KEY);
  return stored ? normalizeUrl(stored) : getDefaultApiBaseUrl();
}

export function setStoredApiBaseUrl(value: string): string {
  const normalized = normalizeUrl(value);
  window.localStorage.setItem(API_URL_STORAGE_KEY, normalized);
  return normalized;
}

export function resetStoredApiBaseUrl(): string {
  window.localStorage.removeItem(API_URL_STORAGE_KEY);
  return getDefaultApiBaseUrl();
}
