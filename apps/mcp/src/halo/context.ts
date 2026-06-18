// Per-request auth context for the MCP server.
//
// The shared @iusehalo/halo-api package is built for browser apps with a
// persistent storage adapter (roamingSettings / localStorage). The MCP server
// instead receives a Halo access token on every JSON-RPC request and serves
// many tenants from one process, so we install an AsyncLocalStorage-backed
// adapter: each request runs inside its own scope with its own (baseUrl, token)
// pair, and api.ts reads them via the normal getConfig()/getTokens() paths.
//
// No refresh token is stored. halo-api's 401-retry skips the refresh path when
// the stored refresh token is empty (see api.ts call()), so a real 401 from
// Halo bubbles up to the MCP client (Claude/Cursor/etc.) which holds the
// refresh token and re-mints a fresh access token on its end.

import { AsyncLocalStorage } from "node:async_hooks";
import {
  setStorage,
  type Storage,
  type TenantConfig,
  type StoredTokens,
} from "@iusehalo/halo-api";

const TENANT_KEY = "halo.tenantConfig.v1";
const TOKENS_KEY = "halo.tokens.v1";

/** Halo connection details we receive per request. */
export interface RequestAuth {
  baseUrl: string;
  accessToken: string;
  /** Halo Connect Client ID — only present when known (HTTP transport stamps it
   *  via the bearer token format); unused server-side except for ticketDeepLink. */
  clientId?: string;
}

const requestStorage = new AsyncLocalStorage<Map<string, unknown>>();

const alsAdapter: Storage = {
  get<T>(key: string): T | undefined {
    return requestStorage.getStore()?.get(key) as T | undefined;
  },
  async set<T>(key: string, value: T): Promise<void> {
    requestStorage.getStore()?.set(key, value);
  },
  async remove(key: string): Promise<void> {
    requestStorage.getStore()?.delete(key);
  },
};

/** Install the per-request storage adapter. Call once at process startup. */
export function installRequestStorage(): void {
  setStorage(alsAdapter);
}

/** Run `fn` inside a per-request scope so halo-api's getConfig()/getTokens()
 *  resolve to the provided tenant + token. The access token's stored expiry is
 *  pushed far enough out that halo-api's pre-emptive refresh never triggers;
 *  real 401s bubble up untouched because the stored refresh token is empty. */
export function withRequestAuth<T>(
  auth: RequestAuth,
  fn: () => Promise<T>,
): Promise<T> {
  const store = new Map<string, unknown>();
  const config: TenantConfig = {
    haloBaseUrl: auth.baseUrl.replace(/\/+$/, ""),
    clientId: auth.clientId ?? "",
  };
  const tokens: StoredTokens = {
    accessToken: auth.accessToken,
    refreshToken: "",
    expiresAt: Date.now() + 60 * 60 * 1000,
  };
  store.set(TENANT_KEY, config);
  store.set(TOKENS_KEY, tokens);
  return requestStorage.run(store, fn);
}

/**
 * Parse the bearer token format used by the hosted HTTP transport.
 *
 * Format:
 *   halo:<base-url>:<access-token>
 *
 * Example:
 *   halo:https://acme.halopsa.com:eyJhbGciOi...
 *
 * The base URL contains `:` (https://), so we walk past the scheme and stop at
 * the next `:` to find the boundary between URL and token.
 */
export function parseBearerToken(token: string): RequestAuth {
  if (!token.startsWith("halo:")) {
    throw new Error(
      "Unsupported bearer token format. Expected halo:<base-url>:<access-token>.",
    );
  }
  const rest = token.slice("halo:".length);
  const sep = findUrlTokenBoundary(rest);
  if (sep < 0) {
    throw new Error(
      "Malformed bearer token: expected halo:<base-url>:<access-token>",
    );
  }
  return {
    baseUrl: rest.slice(0, sep),
    accessToken: rest.slice(sep + 1),
  };
}

function findUrlTokenBoundary(s: string): number {
  const schemeEnd = s.indexOf("://");
  if (schemeEnd < 0) return s.indexOf(":");
  let i = schemeEnd + 3;
  while (i < s.length) {
    if (s[i] === ":") return i;
    i++;
  }
  return -1;
}

/**
 * Best-effort check whether a JWT access token is at/past its `exp`. Halo issues
 * JWT access tokens, so we can decide expiry locally without a Halo round-trip.
 * Returns false for opaque/non-JWT tokens or unparseable payloads — we never
 * block a token we can't read; those still fail (if at all) inside the call.
 */
export function isAccessTokenExpired(token: string, skewSeconds = 30): boolean {
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  try {
    const json = Buffer.from(
      parts[1].replace(/-/g, "+").replace(/_/g, "/"),
      "base64",
    ).toString("utf8");
    const payload = JSON.parse(json) as { exp?: unknown };
    if (typeof payload.exp !== "number") return false;
    return Date.now() / 1000 >= payload.exp - skewSeconds;
  } catch {
    return false;
  }
}

/** Load auth from process env (stdio mode). Returns undefined if not configured. */
export function loadEnvAuth(): RequestAuth | undefined {
  const baseUrl = process.env.HALO_BASE_URL;
  const accessToken = process.env.HALO_ACCESS_TOKEN;
  if (!baseUrl || !accessToken) return undefined;
  return { baseUrl, accessToken };
}
