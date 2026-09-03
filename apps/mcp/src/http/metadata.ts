// MCP OAuth discovery metadata.
//
// We act as BOTH the protected resource and the authorization server. The
// "authorization" we do is mostly bouncing Claude through Halo's real OAuth
// page, but to MCP clients we look like a normal RFC 9728 + RFC 8414 OAuth
// server with PKCE.

import type { ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";

function writeJson(res: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(json);
}

export function emitProtectedResourceMetadata(
  res: ServerResponse,
  issuer: string,
): void {
  writeJson(res, 200, {
    resource: issuer,
    authorization_servers: [issuer],
    scopes_supported: ["all"],
    bearer_methods_supported: ["header"],
  });
}

export function emitAuthorizationServerMetadata(
  res: ServerResponse,
  issuer: string,
): void {
  writeJson(res, 200, {
    issuer,
    authorization_endpoint: `${issuer}/authorize`,
    token_endpoint: `${issuer}/token`,
    registration_endpoint: `${issuer}/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    // "none" for PKCE-native public clients (Claude, Cursor, ChatGPT);
    // "client_secret_post" for classic confidential clients that register via
    // /register and get a secret back (see handleRegistration below — e.g.
    // Copilot Studio's dynamic-discovery DCR flow, which requires a server to
    // issue one). /token never actually validates the secret — the one-time
    // code plus (when sent) PKCE remain the real checks — this is purely
    // shape-compatibility for clients that insist on seeing one.
    token_endpoint_auth_methods_supported: ["none", "client_secret_post"],
    scopes_supported: ["all"],
  });
}

/** Minimal RFC 7591 Dynamic Client Registration — echoes the request back as
 *  an issued client. We don't actually maintain a client registry: every
 *  client_id (and, when sent later, client_secret) is accepted on /token, and
 *  the only real authorization happens when the user logs in to Halo. This
 *  exists so MCP clients that demand DCR before continuing don't get stuck.
 *
 *  Always issues a client_secret: some DCR-consuming clients (e.g. Copilot
 *  Studio's dynamic-discovery flow) require one to be present in the
 *  registration response and won't proceed without it, even though we never
 *  check it back at /token. PKCE-only public clients that never look at
 *  client_secret (Claude, Cursor, ChatGPT) are unaffected either way. */
export async function handleRegistration(
  body: string,
  res: ServerResponse,
): Promise<void> {
  let parsed: Record<string, unknown> = {};
  try {
    parsed = body ? (JSON.parse(body) as Record<string, unknown>) : {};
  } catch {
    writeJson(res, 400, { error: "invalid_client_metadata" });
    return;
  }
  const clientId = `mcp-client-${Math.random().toString(36).slice(2, 10)}`;
  const clientSecret = randomBytes(24).toString("base64url");
  writeJson(res, 201, {
    ...parsed,
    client_id: clientId,
    client_id_issued_at: Math.floor(Date.now() / 1000),
    client_secret: clientSecret,
    client_secret_expires_at: 0, // never expires
    token_endpoint_auth_method: "client_secret_post",
  });
}
