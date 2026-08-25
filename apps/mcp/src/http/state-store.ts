// In-memory TTL store for OAuth flow state.
//
// Two state machines live here:
//
//   1. Pending Halo round-trips, keyed by the `state` we send to Halo. Holds
//      everything we need to (a) complete the Halo /token exchange in the
//      callback and (b) construct Claude's redirect back. 5-minute TTL.
//
//   2. One-time Claude authorization codes, keyed by an opaque code we mint
//      in the callback and hand back to Claude. Holds the Halo tokens we
//      already obtained, awaiting Claude's PKCE-verified /token call.
//      5-minute TTL, single-use.
//
// In-memory is fine for a single-process MCP server. If we ever scale
// horizontally, swap to Redis or signed JWTs — the API surface here is small.

import { randomBytes } from "node:crypto";

const PENDING_TTL_MS = 5 * 60 * 1000;
const CODE_TTL_MS = 5 * 60 * 1000;

export interface PendingHaloFlow {
  /** base64url tenant blob — used to round-trip through the callback. */
  configBlob: string;
  /** Halo base URL (no trailing slash). */
  haloBaseUrl: string;
  /** Halo Connect Client ID. */
  haloClientId: string;
  /** Where Claude wants the eventual authorization code delivered. */
  claudeRedirectUri: string;
  /** Claude's `state` value — we echo it on the redirect back. */
  claudeState: string;
  /** Claude's code_challenge — we verify it later when Claude POSTs /token.
   *  Undefined for PKCE-less clients (classic confidential-client OAuth 2.0,
   *  e.g. Copilot Studio's Manual/Dynamic modes) — see oauth.ts. */
  claudeCodeChallenge: string | undefined;
  claudeCodeChallengeMethod: string | undefined;
  /** Our verifier for the Halo leg — we send it on the Halo /token exchange. */
  haloVerifier: string;
  /** redirect_uri we sent Halo (must match on token exchange too). */
  haloRedirectUri: string;
  expiresAt: number;
}

export interface ClaudeAuthCode {
  configBlob: string;
  haloBaseUrl: string;
  haloClientId: string;
  haloTokens: HaloTokenResponse;
  claudeRedirectUri: string;
  claudeCodeChallenge: string | undefined;
  claudeCodeChallengeMethod: string | undefined;
  expiresAt: number;
}

export interface HaloTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type?: string;
  scope?: string;
}

const pending = new Map<string, PendingHaloFlow>();
const codes = new Map<string, ClaudeAuthCode>();

function sweep<T extends { expiresAt: number }>(map: Map<string, T>): void {
  const now = Date.now();
  for (const [k, v] of map) if (v.expiresAt <= now) map.delete(k);
}

export function newStateId(): string {
  return randomBytes(16).toString("hex");
}

export function putPending(stateId: string, entry: Omit<PendingHaloFlow, "expiresAt">): void {
  sweep(pending);
  pending.set(stateId, { ...entry, expiresAt: Date.now() + PENDING_TTL_MS });
}

export function takePending(stateId: string): PendingHaloFlow | undefined {
  sweep(pending);
  const v = pending.get(stateId);
  if (!v) return undefined;
  pending.delete(stateId);
  return v;
}

export function newCode(): string {
  return randomBytes(24).toString("hex");
}

export function putCode(code: string, entry: Omit<ClaudeAuthCode, "expiresAt">): void {
  sweep(codes);
  codes.set(code, { ...entry, expiresAt: Date.now() + CODE_TTL_MS });
}

export function takeCode(code: string): ClaudeAuthCode | undefined {
  sweep(codes);
  const v = codes.get(code);
  if (!v) return undefined;
  codes.delete(code);
  return v;
}
