// MCP authorization endpoints. The role of this server is to thinly bridge
// Claude (MCP client) to Halo (real OAuth IDP):
//
//   /authorize  → 302 to halo.<tenant>/auth/authorize (user sees real Halo login)
//   /token      → POST to halo.<tenant>/auth/token, return Halo's tokens to Claude
//
// PKCE is enforced on both legs:
//   - Claude verifies us (its leg) via the standard /authorize code_challenge
//     + /token code_verifier. We hold the challenge in pendingState and check
//     verifier when Claude redeems the auth code we minted.
//   - We verify Halo (our leg) the same way: we mint our own verifier+challenge,
//     send the challenge with the authorize request, and send the verifier with
//     the token exchange. Stored in pendingState.

import type { IncomingMessage, ServerResponse } from "node:http";
import { getCallbackUrl } from "./origin.js";
import {
  newCode,
  newStateId,
  putCode,
  putPending,
  takeCode,
  type HaloTokenResponse,
  type PendingHaloFlow,
} from "./state-store.js";
import { challengeFromVerifier, generateVerifier, verifyPkce } from "./pkce.js";
import type { TenantConfig } from "./tenant.js";

function writeJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(JSON.stringify(body));
}

function redirectWithError(
  res: ServerResponse,
  base: string,
  error: string,
  description: string,
  state?: string,
): void {
  const url = new URL(base);
  url.searchParams.set("error", error);
  url.searchParams.set("error_description", description);
  if (state) url.searchParams.set("state", state);
  res.writeHead(302, { Location: url.toString() });
  res.end();
}

/** GET /mcp/t/<config>/authorize?... — 302 to Halo's authorize URL.
 *  The user's browser ends up on Halo's real login page (not proxied). */
export function handleAuthorize(
  req: IncomingMessage,
  res: ServerResponse,
  configBlob: string,
  tenant: TenantConfig,
): void {
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
  const params = url.searchParams;

  const responseType = params.get("response_type");
  const redirectUri = params.get("redirect_uri");
  const codeChallenge = params.get("code_challenge");
  const codeChallengeMethod = params.get("code_challenge_method") ?? "plain";
  const state = params.get("state") ?? "";
  // client_id is ignored — we don't enforce a client registry, see metadata.ts.

  if (responseType !== "code") {
    writeJson(res, 400, {
      error: "unsupported_response_type",
      error_description: "Only response_type=code is supported.",
    });
    return;
  }
  if (!redirectUri) {
    writeJson(res, 400, {
      error: "invalid_request",
      error_description: "redirect_uri is required.",
    });
    return;
  }
  if (!codeChallenge || codeChallengeMethod !== "S256") {
    writeJson(res, 400, {
      error: "invalid_request",
      error_description:
        "PKCE is required: send code_challenge and code_challenge_method=S256.",
    });
    return;
  }

  const stateId = newStateId();
  const haloVerifier = generateVerifier();
  const haloChallenge = challengeFromVerifier(haloVerifier);
  const haloRedirectUri = getCallbackUrl(req);

  putPending(stateId, {
    configBlob,
    haloBaseUrl: tenant.halo,
    haloClientId: tenant.clientId,
    claudeRedirectUri: redirectUri,
    claudeState: state,
    claudeCodeChallenge: codeChallenge,
    claudeCodeChallengeMethod: codeChallengeMethod,
    haloVerifier,
    haloRedirectUri,
  });

  const haloAuthorize = new URL(`${tenant.halo}/auth/authorize`);
  haloAuthorize.searchParams.set("response_type", "code");
  haloAuthorize.searchParams.set("client_id", tenant.clientId);
  haloAuthorize.searchParams.set("redirect_uri", haloRedirectUri);
  // Scope comes from the tenant config (set in the setup wizard), not the
  // client — it must match what the admin granted the Connect app. Defaults to
  // "all" so existing URLs without an explicit scope are unaffected.
  haloAuthorize.searchParams.set("scope", tenant.scope ?? "all");
  haloAuthorize.searchParams.set("state", `mcp:${stateId}`);
  haloAuthorize.searchParams.set("code_challenge", haloChallenge);
  haloAuthorize.searchParams.set("code_challenge_method", "S256");

  res.writeHead(302, { Location: haloAuthorize.toString() });
  res.end();
}

/** POST /mcp/t/<config>/token — handles both authorization_code and refresh_token. */
export async function handleToken(
  body: string,
  req: IncomingMessage,
  res: ServerResponse,
  tenant: TenantConfig,
): Promise<void> {
  const form = new URLSearchParams(body);
  const grantType = form.get("grant_type");

  if (grantType === "authorization_code") {
    await exchangeCode(form, res);
    return;
  }
  if (grantType === "refresh_token") {
    await exchangeRefresh(form, req, res, tenant);
    return;
  }
  writeJson(res, 400, {
    error: "unsupported_grant_type",
    error_description: `grant_type ${grantType ?? "(missing)"} not supported.`,
  });
}

async function exchangeCode(
  form: URLSearchParams,
  res: ServerResponse,
): Promise<void> {
  const code = form.get("code");
  const codeVerifier = form.get("code_verifier");
  const redirectUri = form.get("redirect_uri");

  if (!code || !codeVerifier || !redirectUri) {
    writeJson(res, 400, {
      error: "invalid_request",
      error_description:
        "code, code_verifier, and redirect_uri are required for authorization_code grant.",
    });
    return;
  }

  const entry = takeCode(code);
  if (!entry) {
    writeJson(res, 400, {
      error: "invalid_grant",
      error_description: "Unknown or expired authorization code.",
    });
    return;
  }
  if (entry.claudeRedirectUri !== redirectUri) {
    writeJson(res, 400, {
      error: "invalid_grant",
      error_description: "redirect_uri does not match the one used at /authorize.",
    });
    return;
  }
  if (!verifyPkce(codeVerifier, entry.claudeCodeChallenge, entry.claudeCodeChallengeMethod)) {
    writeJson(res, 400, {
      error: "invalid_grant",
      error_description: "PKCE verification failed.",
    });
    return;
  }

  writeJson(res, 200, {
    access_token: entry.haloTokens.access_token,
    refresh_token: entry.haloTokens.refresh_token,
    token_type: "Bearer",
    expires_in: entry.haloTokens.expires_in,
    scope: entry.haloTokens.scope ?? "all",
  });
}

async function exchangeRefresh(
  form: URLSearchParams,
  _req: IncomingMessage,
  res: ServerResponse,
  tenant: TenantConfig,
): Promise<void> {
  const refreshToken = form.get("refresh_token");
  if (!refreshToken) {
    writeJson(res, 400, {
      error: "invalid_request",
      error_description: "refresh_token is required for refresh_token grant.",
    });
    return;
  }
  // Forward the refresh server-to-server to Halo, with the tenant's Connect
  // app client_id. The token Halo returns is whatever the user authorized
  // against, so we pass it through verbatim.
  const haloUrl = `${tenant.halo}/auth/token`;
  const upstream = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: tenant.clientId,
  });
  let upstreamRes: Response;
  try {
    upstreamRes = await fetch(haloUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: upstream,
    });
  } catch (e) {
    writeJson(res, 502, {
      error: "server_error",
      error_description: `Halo /auth/token unreachable: ${(e as Error).message}`,
    });
    return;
  }
  const text = await upstreamRes.text();
  res.writeHead(upstreamRes.status, {
    "Content-Type": upstreamRes.headers.get("content-type") ?? "application/json",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(text);
}

/** Called from /auth/callback after we've successfully exchanged Halo's code
 *  for Halo's tokens. We mint a one-time auth code for Claude (preserving the
 *  PKCE challenge we received from Claude), store it server-side keyed by that
 *  code, and 302 Claude back to its redirect URI. */
export function completeMcpFlow(
  res: ServerResponse,
  pending: PendingHaloFlow,
  haloTokens: HaloTokenResponse,
): void {
  const code = newCode();
  putCode(code, {
    configBlob: pending.configBlob,
    haloBaseUrl: pending.haloBaseUrl,
    haloClientId: pending.haloClientId,
    haloTokens,
    claudeRedirectUri: pending.claudeRedirectUri,
    claudeCodeChallenge: pending.claudeCodeChallenge,
    claudeCodeChallengeMethod: pending.claudeCodeChallengeMethod,
  });

  const redirect = new URL(pending.claudeRedirectUri);
  redirect.searchParams.set("code", code);
  if (pending.claudeState) redirect.searchParams.set("state", pending.claudeState);
  res.writeHead(302, { Location: redirect.toString() });
  res.end();
}

/** Surface a Halo OAuth error back to Claude via the same redirect path. */
export function failMcpFlow(
  res: ServerResponse,
  pending: PendingHaloFlow,
  error: string,
  description: string,
): void {
  redirectWithError(res, pending.claudeRedirectUri, error, description, pending.claudeState);
}
