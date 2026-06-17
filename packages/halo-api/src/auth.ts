// OAuth2 Authorization Code + PKCE flow for HaloPSA, run entirely client-side.
//
// Why client-side: Halo Connect supports public clients (no secret) when using PKCE.
// Combined with per-app CORS allowlist on the Halo side, the SPA talks directly to Halo.
//
// The dialog-opening step is pluggable via the DialogOpener interface so this module
// stays surface-agnostic: Outlook plugs in an Office.dialog implementation, a browser
// extension plugs in chrome.identity.launchWebAuthFlow, Teams plugs in its own SDK, etc.

import { generateState, generateVerifier, challengeFromVerifier } from "./pkce.js";
import {
  getConfig,
  getTokens,
  setTokens,
  clearTokens,
  type StoredTokens,
  type TenantConfig,
} from "./config.js";

/** The structured payload a DialogOpener must return after the OAuth redirect. */
export interface DialogResultMessage {
  code?: string;
  state?: string;
  error?: string;
  errorDescription?: string;
  /** Which callback endpoint served the response, when it self-identifies
   *  ("legacy" = per-app static page, "universal" = shared /auth/callback).
   *  Used to confirm a migration round-tripped through the new endpoint. */
  callback?: string;
}

/**
 * Pluggable mechanism for opening the authorize URL and collecting the redirect's
 * query parameters. Different surfaces (Outlook dialog, browser extension popup,
 * Teams task module, etc.) implement this differently.
 */
export interface DialogOpener {
  open(url: string): Promise<DialogResultMessage>;
}

export interface SignInOptions {
  /** The full URL Halo will redirect to with ?code=... or ?error=... */
  redirectUri: string;
  /**
   * Optional pre-flight transform of the authorize URL. Outlook needs to wrap the
   * authorize URL in a same-origin start page because displayDialogAsync requires
   * the initial URL to be on the add-in's own origin. Other surfaces typically
   * don't need this — leave undefined to pass the authorize URL through as-is.
   */
  wrapAuthorizeUrl?: (authorizeUrl: string) => string;
  /**
   * Optional prefix prepended to the OAuth `state` (e.g. "outlook:") so a shared
   * multi-tool callback endpoint can route the response to the right handler.
   * The full prefixed value is what's sent and what the redirect must echo back,
   * so state validation is unaffected.
   */
  statePrefix?: string;
}

/** Trigger the OAuth dance. Resolves when tokens are obtained and stored. */
export async function signIn(
  opener: DialogOpener,
  options: SignInOptions,
): Promise<StoredTokens> {
  const cfg = getConfig();
  if (!cfg) throw new Error("HaloPSA tenant not configured. Run config first.");

  const verifier = generateVerifier();
  const challenge = await challengeFromVerifier(verifier);
  const state = `${options.statePrefix ?? ""}${generateState()}`;

  const authorizeUrl = buildAuthorizeUrl(cfg, challenge, state, options.redirectUri);
  const dialogUrl = options.wrapAuthorizeUrl
    ? options.wrapAuthorizeUrl(authorizeUrl)
    : authorizeUrl;
  const message = await opener.open(dialogUrl);

  if (message.error) {
    throw new Error(`${message.error}: ${message.errorDescription ?? ""}`.trim());
  }
  if (!message.code || message.state !== state) {
    throw new Error("Authorization response missing code or state mismatch.");
  }

  const tokens = await exchangeCodeForTokens(
    cfg,
    message.code,
    verifier,
    options.redirectUri,
  );
  await setTokens(tokens);
  return tokens;
}

/** Return a valid access token, refreshing if needed. Throws if no tokens. */
export async function getAccessToken(): Promise<string> {
  const tokens = getTokens();
  if (!tokens) throw new NotAuthenticatedError();

  // Refresh 60s before expiry to absorb clock drift.
  if (Date.now() >= tokens.expiresAt - 60_000) {
    const refreshed = await refresh(tokens.refreshToken);
    return refreshed.accessToken;
  }
  return tokens.accessToken;
}

/** Force a refresh using the stored refresh token. */
export async function refresh(refreshToken: string): Promise<StoredTokens> {
  const cfg = getConfig();
  if (!cfg) throw new Error("No tenant config.");

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: cfg.clientId,
  });

  const res = await fetch(`${cfg.haloBaseUrl}/auth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!res.ok) {
    // Refresh token likely revoked or expired — wipe and force re-auth.
    await clearTokens();
    throw new NotAuthenticatedError(`Refresh failed: ${res.status}`);
  }

  const json = await res.json();
  const tokens = tokensFromResponse(json, refreshToken);
  await setTokens(tokens);
  return tokens;
}

export async function signOut(): Promise<void> {
  await clearTokens();
}

export function isAuthenticated(): boolean {
  return !!getTokens();
}

export class NotAuthenticatedError extends Error {
  constructor(msg = "Not authenticated") {
    super(msg);
    this.name = "NotAuthenticatedError";
  }
}

// ---------- internals ----------

function buildAuthorizeUrl(
  cfg: TenantConfig,
  codeChallenge: string,
  state: string,
  redirectUri: string,
): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: cfg.clientId,
    redirect_uri: redirectUri,
    scope: cfg.scope ?? "all",
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });
  return `${cfg.haloBaseUrl}/auth/authorize?${params.toString()}`;
}

async function exchangeCodeForTokens(
  cfg: TenantConfig,
  code: string,
  verifier: string,
  redirectUri: string,
): Promise<StoredTokens> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    client_id: cfg.clientId,
    code_verifier: verifier,
  });

  const res = await fetch(`${cfg.haloBaseUrl}/auth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Token exchange failed (${res.status}): ${text}`);
  }
  return tokensFromResponse(await res.json());
}

function tokensFromResponse(
  json: {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    scope?: string;
  },
  fallbackRefresh?: string,
): StoredTokens {
  const refresh_token = json.refresh_token ?? fallbackRefresh;
  if (!refresh_token) throw new Error("Token response missing refresh_token");
  return {
    accessToken: json.access_token,
    refreshToken: refresh_token,
    expiresAt: Date.now() + json.expires_in * 1000,
    scope: json.scope,
  };
}
