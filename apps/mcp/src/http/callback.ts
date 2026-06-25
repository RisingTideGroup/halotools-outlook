// Shared OAuth redirect target for every tool in the iusehalo hub.
//
// Halo's Connect app only allows pre-registered redirect_uri values. To avoid
// every tool needing its own entry in the admin's Halo Connect app, all tools
// point at this single URL and discriminate by `state` prefix:
//
//   state=outlook:<id>  → serve the Office.js postMessage page (parity with
//                         the current static /outlook/auth/callback.html)
//   state=mcp:<id>      → look up the pending Halo flow, exchange the code,
//                         hand a one-time code back to Claude
//   state=<other>:<id>  → easy to add — drop in another branch here
//
// Admins only ever register one URL with Halo for the whole hub.

import type { IncomingMessage, ServerResponse } from "node:http";
import { takePending, type HaloTokenResponse } from "./state-store.js";
import { completeMcpFlow, failMcpFlow } from "./oauth.js";

const ESC = (s: string): string =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** OAuth failures are rare and high-value to diagnose, and otherwise get
 *  swallowed into the redirect back to the client — so always surface them on
 *  stderr (EasyPanel captures it) regardless of MCP_LOG_REQUESTS. */
function logOauthFailure(msg: string): void {
  process.stderr.write(`halo-mcp-server: oauth: ${msg}\n`);
}

export async function handleAuthCallback(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
  const code = url.searchParams.get("code") ?? "";
  const state = url.searchParams.get("state") ?? "";
  const error = url.searchParams.get("error") ?? "";
  const errorDescription = url.searchParams.get("error_description") ?? "";

  const prefix = state.split(":", 1)[0];

  if (prefix === "mcp") {
    await dispatchMcp(state.slice(4), code, error, errorDescription, res);
    return;
  }
  if (prefix === "outlook") {
    dispatchOutlook(code, state, error, errorDescription, res);
    return;
  }
  // Unknown / no state — surface the raw error if Halo sent one, otherwise
  // serve a small "no flow" page.
  res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
  res.end(
    `<!doctype html><meta charset=utf-8><title>OAuth callback</title>` +
      `<p>No OAuth flow recognized this callback. ` +
      `state=${ESC(state)} error=${ESC(error)} ${ESC(errorDescription)}</p>`,
  );
}

async function dispatchMcp(
  stateId: string,
  code: string,
  error: string,
  errorDescription: string,
  res: ServerResponse,
): Promise<void> {
  const pending = takePending(stateId);
  if (!pending) {
    res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
    res.end(
      `<!doctype html><meta charset=utf-8><title>OAuth callback</title>` +
        `<p>OAuth flow expired or unknown. Re-run the sign-in from your MCP client.</p>`,
    );
    return;
  }
  if (error) {
    // Halo rejected /authorize (e.g. unregistered redirect_uri, unknown
    // client_id, disabled grant) — it redirected back here with the reason.
    logOauthFailure(
      `authorize rejected by halo=${pending.haloBaseUrl} client=${pending.haloClientId}: ` +
        `error=${error} description="${errorDescription}"`,
    );
    failMcpFlow(res, pending, error, errorDescription);
    return;
  }
  if (!code) {
    logOauthFailure(
      `no code from halo=${pending.haloBaseUrl} client=${pending.haloClientId}`,
    );
    failMcpFlow(res, pending, "invalid_request", "Halo returned no code.");
    return;
  }

  let tokens: HaloTokenResponse;
  try {
    tokens = await exchangeHaloCode(pending, code);
  } catch (e) {
    // The server-to-server code→token exchange failed — the message carries
    // Halo's status + body (PKCE mismatch, confidential-client secret required,
    // version-specific token-endpoint behaviour, etc.).
    logOauthFailure(
      `token exchange failed for halo=${pending.haloBaseUrl} client=${pending.haloClientId}: ` +
        `${(e as Error).message}`,
    );
    failMcpFlow(res, pending, "server_error", (e as Error).message);
    return;
  }

  completeMcpFlow(res, pending, tokens);
}

async function exchangeHaloCode(
  pending: import("./state-store.js").PendingHaloFlow,
  code: string,
): Promise<HaloTokenResponse> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: pending.haloRedirectUri,
    client_id: pending.haloClientId,
    code_verifier: pending.haloVerifier,
  });
  const url = `${pending.haloBaseUrl}/auth/token`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Halo /auth/token returned ${res.status}: ${text}`);
  }
  return (await res.json()) as HaloTokenResponse;
}

/** Outlook flow: serve the same Office.js postMessage page the current static
 *  callback.html serves. Lets us migrate Outlook's redirect_uri to this shared
 *  endpoint without changing how the task pane consumes the result. */
function dispatchOutlook(
  code: string,
  state: string,
  error: string,
  errorDescription: string,
  res: ServerResponse,
): void {
  const payload = JSON.stringify({
    code: code || undefined,
    state,
    error: error || undefined,
    errorDescription: errorDescription || undefined,
    // Self-identify so the add-in can confirm sign-in round-tripped through the
    // shared endpoint (vs the legacy per-app /outlook/auth/callback.html page).
    callback: "universal",
  });
  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(`<!doctype html>
<meta charset="utf-8">
<title>HaloPSA sign-in</title>
<script src="https://appsforoffice.microsoft.com/lib/1/hosted/office.js"></script>
<p>Sign-in complete. You can close this window.</p>
<script>
  (function () {
    var payload = ${payload};
    function send() {
      try {
        if (window.Office && Office.context && Office.context.ui && Office.context.ui.messageParent) {
          Office.context.ui.messageParent(JSON.stringify(payload));
        }
      } catch (e) {}
    }
    if (window.Office) {
      Office.onReady ? Office.onReady(send) : send();
    } else {
      setTimeout(send, 250);
    }
  })();
</script>`);
}
