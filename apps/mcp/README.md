# halo-mcp-server

Model Context Protocol server exposing HaloPSA as tools for AI assistants (Claude Desktop, ChatGPT desktop, Cursor, etc.).

Lives alongside the Outlook add-in and Teams app under `apps/`; shares HaloPSA logic with them via the workspace package `@iusehalo/halo-api`.

Runs in two modes:

- **stdio** — Claude / Cursor spawn it as a subprocess and talk JSON-RPC over stdin/stdout. Single-tenant: env vars supply Halo URL + access token at process start.
- **HTTP** — hosted at `tools.iusehalo.com/mcp/t/<config>/`. Multi-tenant: every request carries a Halo access token, and OAuth sign-in is bridged to the user's own HaloPSA login. This is the mode meant for `tools.iusehalo.com`.

## What it exposes

| Tool                    | Purpose                                                                     |
| ----------------------- | --------------------------------------------------------------------------- |
| `findContact`           | Look up a Halo contact by email; returns name, client, phone, open count.   |
| `listOpenTickets`       | List open tickets for a client and/or user.                                 |
| `searchTickets`         | Free-text search across Halo tickets.                                       |
| `createTicket`          | Open a new ticket against a client (and optional user).                     |
| `appendActionToTicket`  | Append a note / action to an existing ticket. Default outcome `"Note"`.     |
| `logNote`               | Create a CRM note against a client / user / site.                           |
| `searchCannedText`      | Search saved canned-text snippets, optionally scoped to a group.            |
| `getActivityFeed`       | Merged activity feed (actions, notes, status changes) for a client/user.    |

More to come: time entries, invoices, recurring invoices, reports, runbooks, etc.

## Build & run

From the repo root:

```bash
npm install
npm run build:mcp           # builds @iusehalo/halo-api then halo-mcp-server
node apps/mcp/dist/index.js --stdio   # default
node apps/mcp/dist/index.js --http    # PORT=3001
```

## HTTP architecture

Every MCP URL bakes in the user's HaloPSA tenant. The shape is:

```
https://tools.iusehalo.com/mcp/t/<config>/
```

where `<config>` is `base64url(JSON({halo, clientId}))`. Endpoints under that base:

| Method | Path                                            | Purpose                                                                          |
| ------ | ----------------------------------------------- | -------------------------------------------------------------------------------- |
| POST   | `/`                                             | Streamable HTTP transport — JSON-RPC. Requires `Authorization: Bearer <token>`.  |
| GET    | `/.well-known/oauth-protected-resource`         | RFC 9728 metadata pointing the client at our authorization server (us).          |
| GET    | `/.well-known/oauth-authorization-server`       | RFC 8414 metadata describing `/authorize`, `/token`, `/register`.                |
| GET    | `/authorize`                                    | 302 to `halo.<tenant>/auth/authorize` — user sees the real Halo login.           |
| POST   | `/token`                                        | Server-to-server forward to `halo.<tenant>/auth/token`.                          |
| POST   | `/register`                                     | RFC 7591 dynamic client registration (stubbed — every client_id is accepted).    |

And one URL shared across the whole iusehalo tools hub:

| Method | Path             | Purpose                                                              |
| ------ | ---------------- | -------------------------------------------------------------------- |
| GET    | `/auth/callback` | Single redirect target Halo sees. Dispatches by `state:` prefix.     |

### OAuth flow (Claude perspective)

1. User pastes the MCP URL into Claude. Claude does normal MCP connect; we respond `401 + WWW-Authenticate` pointing at our protected-resource metadata.
2. Claude follows discovery → finds our authorization server metadata → kicks off OAuth with PKCE.
3. Claude opens the user's browser to `/authorize`. We 302 to `halo.<tenant>/auth/authorize` — **user sees their real Halo login page, not a proxied one**.
4. After login Halo redirects to `/auth/callback` (the shared endpoint). State is `mcp:<id>`; we exchange Halo's code for tokens server-to-server, then mint a one-time code for Claude.
5. Claude POSTs `/token` with PKCE verifier; we hand back the Halo access + refresh tokens.
6. Claude stores those tokens, sends Bearer on each MCP call. **Tokens never live server-side**.
7. Refresh: Claude POSTs `/token` with `grant_type=refresh_token`; we forward to Halo and return the response verbatim.

### Why a server in the middle at all

Halo Connect apps require a pre-registered `redirect_uri`. Claude's callback URL changes per session (`http://127.0.0.1:<random>/callback`), so Halo can't redirect there directly. Our `/auth/callback` is the one URL the admin ever registers; we bounce the code to wherever the current MCP client asked.

The same callback also serves Outlook (via `state=outlook:<id>`), so admins register **one** URL and never need to touch their Halo Connect app again to enable new tools.

## Halo Connect setup (admin)

1. In Halo: Config → Integrations → Halo Connect → API → New Application.
2. Grant type: **Authorization Code**. PKCE: **on**.
3. Redirect URIs:
   - `https://tools.iusehalo.com/outlook/auth/callback.html` (Outlook v1, deprecated in a future bump)
   - `https://tools.iusehalo.com/auth/callback` (shared callback — covers MCP and every future tool)
4. CORS: add `https://tools.iusehalo.com`.
5. Scopes: `all` (or scope down per Halo's docs).
6. Copy the Client ID — that goes into both Outlook setup and the MCP URL.

## Adding to Claude Desktop / Cursor (HTTP)

```jsonc
{
  "mcpServers": {
    "halo": {
      "url": "https://tools.iusehalo.com/mcp/t/<config>/"
    }
  }
}
```

The MCP URL with `<config>` filled in is shown in the Outlook task pane's **Settings → AI assistants (MCP)** section once the user has signed in. Copy-button included.

For end users without the Outlook add-in: build the URL by base64url-encoding `JSON({halo: "https://halo.your-tenant.com", clientId: "<your Halo Connect client id>"})` and pasting it into `https://tools.iusehalo.com/mcp/t/<that>/`.

## Adding to Claude Desktop (local stdio)

For quick local testing without standing up the HTTP server:

```jsonc
{
  "mcpServers": {
    "halo": {
      "command": "node",
      "args": ["/absolute/path/halotools-outlook/apps/mcp/dist/index.js", "--stdio"],
      "env": {
        "HALO_BASE_URL": "https://halo.your-tenant.com",
        "HALO_ACCESS_TOKEN": "<pre-issued bearer token>"
      }
    }
  }
}
```

## Hosted deployment

The root `Dockerfile` builds and runs everything in one container:

- nginx serves the landing page + Outlook SPA + Teams SPA
- the Node MCP server runs alongside on `127.0.0.1:3001`
- nginx reverse-proxies `/mcp/*` and `/auth/callback` to Node

```bash
docker build -t halotools .
docker run --rm -p 80:80 \
  -e MCP_PUBLIC_ORIGIN=https://tools.iusehalo.com \
  halotools
```

Set `MCP_PUBLIC_ORIGIN` so the OAuth metadata advertises the public URL, not whatever nginx infers from the request `Host` header.

The standalone `apps/mcp/Dockerfile` still exists if you want to run just the MCP server in a separate container.

## Environment variables

| Variable                          | Mode        | Purpose                                                                                          |
| ---------------------------------- | ----------- | -------------------------------------------------------------------------------------------------- |
| `HALO_BASE_URL` / `HALO_ACCESS_TOKEN` | stdio    | Single tenant's Halo URL + a pre-issued bearer token.                                              |
| `MCP_TRANSPORT`                    | both        | `http` to force HTTP mode (equivalent to `--http`); defaults to stdio.                             |
| `PORT`                             | http        | Port for the HTTP server. Defaults to `3001`.                                                      |
| `MCP_PUBLIC_ORIGIN`                | http        | Public origin advertised in OAuth metadata, since nginx sits in front.                             |
| `MCP_LOG_REQUESTS`                 | http        | `1`/`true` to log each request's method/URL/status/timing to stderr.                               |
| `MCP_CUSTOM_HEADER_<id>_NAME` / `MCP_CUSTOM_HEADER_<id>_VALUE` | both | Extra header sent on every outbound Halo call. See below. |

### Custom outbound headers

Set a matching `_NAME`/`_VALUE` pair under the same `<id>` (any identifier — it's not the header name itself, since env var names can't hold characters like `-` that real header names commonly do):

```bash
MCP_CUSTOM_HEADER_RATELIMIT_NAME=X-RateLimit-Bypass
MCP_CUSTOM_HEADER_RATELIMIT_VALUE=<secret>
```

Both must be present for the pair to take effect; multiple pairs (different `<id>`s) can be set at once. Use this for a Halo-issued rate-limit-bypass header on a trusted hosted instance, or for a self-hoster's Cloudflare/WAF bypass secret in front of their own Halo. Not applicable to the Outlook add-in or Teams app — those are browser SPAs with no server-side env vars to read from.

## Project layout

```
apps/mcp/
├── package.json
├── Dockerfile               # standalone MCP-only image (optional)
├── src/
│   ├── index.ts             # transport selector (stdio | http)
│   ├── server.ts            # McpServer + tool registration
│   ├── halo/
│   │   └── context.ts       # AsyncLocalStorage adapter → @iusehalo/halo-api
│   ├── http/
│   │   ├── server.ts        # HTTP router
│   │   ├── tenant.ts        # /mcp/t/<config>/ path encode/decode
│   │   ├── origin.ts        # public-origin resolution behind nginx
│   │   ├── state-store.ts   # in-memory TTL maps (pending flows, codes)
│   │   ├── pkce.ts          # PKCE helpers for the Halo leg
│   │   ├── metadata.ts      # .well-known endpoints + RFC 7591 stub
│   │   ├── oauth.ts         # /authorize, /token
│   │   └── callback.ts      # /auth/callback (state-prefix dispatcher)
│   └── tools/               # one file per MCP tool
```

## Limitations / deferred

- No tests yet.
- No tool for attachments / ticket updates / time entries / invoices — coming.
- HTTP state (pending OAuth flows, one-time codes) is in-process; horizontal scaling needs Redis or signed JWTs.
- Rate limiting: 429s from Halo are retried with backoff (honoring `Retry-After`, capped at 4 attempts / 30s per wait) — but there's no proactive throttling or request queuing on our side, so a burst of concurrent tool calls (e.g. multiple AI clients against the same tenant) can still trip Halo's limit before the retry kicks in.
