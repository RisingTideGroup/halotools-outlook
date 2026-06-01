# Project notes for Claude Code

Quick context for picking this up in a new session.

## What this is

A monorepo of HaloPSA tools for the iusehalo.com tools hub. All apps share `@iusehalo/halo-api` — a framework-agnostic HaloPSA client (OAuth2+PKCE, fetch wrapper, RFC Message-ID threading). Pure SPAs, multi-tenant, no backend.

Deployed at `https://tools.iusehalo.com/` on EasyPanel (single static nginx serving multiple surfaces).

## Repo layout

```
/
├── package.json            # npm workspace root
├── Dockerfile, nginx.conf  # production image: builds outlook + teams, serves landing+outlook+teams
├── landing/                # marketing landing page (plain HTML)
├── packages/
│   └── halo-api/           # @iusehalo/halo-api — framework-agnostic HaloPSA client
│       └── src/            # api.ts, auth.ts, config.ts, storage.ts, pkce.ts, types.ts
└── apps/
    ├── outlook/            # Outlook task-pane add-in (Vite + React + Fluent UI v9)
    ├── teams/              # Microsoft Teams personal tab + message extension
    ├── mcp/                # Model Context Protocol server exposing HaloPSA as tools
    └── browser-ext/        # Chromium MV3 browser extension
```

Inside each app, imports of HaloPSA client logic come from `@iusehalo/halo-api`. Each app keeps its own surface-specific glue (Office.js helpers in outlook, Teams SDK in teams, etc.).

## Architecture invariants

- **No backend.** All Halo calls go from the browser/host directly. CORS is configured per-tenant on the Halo Connect application. Don't introduce a backend without explicit ask.
- **Multi-tenant.** Halo URL + Client ID live in per-host storage (roamingSettings in Outlook, localStorage elsewhere). Nothing about a specific MSP is in the build artifact.
- **Tokens never leave the client.** Refresh tokens stay in the per-host storage adapter. Auth is `signIn()` in `packages/halo-api/src/auth.ts`. The package is surface-agnostic — each app passes a `DialogOpener` adapter (Outlook → `apps/outlook/src/lib/office-dialog.ts`; others plug in their own).
- **Storage is pluggable.** Each app installs a Storage adapter at bootstrap via `setStorage(...)`. Outlook uses `roamingSettingsStorage(Office.context.roamingSettings)` from `@iusehalo/halo-api`; dev/non-Office contexts use `localStorageStorage()`.
- **Read surface only (Outlook v1).** v1 is `mailRead` context. Compose support uses a separate `mailCompose` runtime declared in the manifest.

## Conventions

- Fluent UI v9 only in UI apps. Don't pull in Fluent v8, MUI, Chakra, etc.
- Fluent stays in app workspaces; never depend on it from `packages/halo-api`.
- All Halo API calls go through `packages/halo-api/src/api.ts::call`. Adds bearer auth, 401-retry-on-refresh, and network-failure messaging.
- Components avoid persistent state. Tenant + tokens live in the `@iusehalo/halo-api` config module; per-user preferences live in app-specific defaults files.
- HaloPSA SQL constraints (Report Center, Runbooks): no single-line comments, no trailing semicolons, one statement, no variables.

## Common dev commands

All scripts run from the repo root; they delegate to the appropriate workspace via `npm -w`.

```bash
npm install                  # installs every workspace in one go
npm run dev                  # vite dev server (apps/outlook) on port 3000
npm run typecheck            # tsc -b across packages + outlook + teams
npm run build                # halo-api → outlook + teams
npm run build:outlook        # just halo-api + outlook
npm run build:teams          # just halo-api + teams
npm run build:mcp            # halo-api + mcp
npm run build:browser-ext    # halo-api + browser-ext
npm run validate-manifest    # office-addin-manifest validate apps/outlook/public/manifest.json
```

Manifest validation needs network access to `developer.microsoft.com` for the schema fetch.

## Threading model (Outlook)

Email-to-ticket threading uses RFC 5322 headers — no Halo custom fields, no admin setup.

- Halo's built-in email intake natively stamps `internetmessageid` on every Action it creates from an incoming email.
- This plugin does the same: when it appends an email or creates a ticket from an email, it sends `internetmessageid`, `inreplyto`, and `references` (space-separated) on the Action / Ticket payload.
- Resolving "which ticket(s) does this email belong to": collect the current email's Message-ID plus its `In-Reply-To` and `References` ancestors, then query `/Actions?internetmessageid=<id>` for each and dedupe the resulting `ticket_id`s. See `findTicketsForEmail` in `packages/halo-api/src/api.ts`.
- The In-Reply-To and References headers aren't on `Office.context.mailbox.item` directly — they require `getAllInternetHeadersAsync()`, which is async and Mailbox 1.8+. `getCurrentEmailContext()` (in `apps/outlook/src/lib/office.ts`) falls back to `references: []` on older Outlook.
- Message-IDs are normalized to have angle brackets stripped everywhere.

## Gotchas

- **Halo API payload variations.** Halo's REST endpoints vary slightly between versions. Two places to watch:
  1. Inline attachment field name: `data_base64` vs `data` vs `base64`. Currently using `data_base64`.
  2. Action `outcome` strings are tenant-configurable (`"Email Received"` is the assumed default).
  If something breaks at runtime, try the alternates before assuming a deeper bug.
- **Office.js loads from MS CDN**, not from npm. The `<script>` tag in `index.html` and `auth/callback.html` pulls it. `@types/office-js` provides the TS types.
- **Office Dialog API for OAuth.** `displayDialogAsync` requires HTTPS even for localhost dev, and the initial URL must be on the add-in's own origin. We wrap third-party authorize URLs in a same-origin `/outlook/auth/start.html` bounce page.
- **Dialog cross-domain redirects → `validDomains`.** Once the OAuth dialog opens, every redirect it follows must stay within domains listed in `validDomains`. If a tenant's Halo uses Azure AD / Google / Okta SSO, the authorize endpoint redirects through `login.microsoftonline.com` etc. — those need to be in `validDomains` or Outlook kills the dialog with the generic "this add-in could not be started" error. Template lists Microsoft + Google by default; admins on Okta / Auth0 / custom SAML need to either add their SSO domain to the manifest or sign in to Halo directly in a separate tab first so the authorize endpoint short-circuits without an SSO bounce.
- **Bundle splitting.** Dashboard is lazy-loaded so the initial config/auth flow stays under 100 KB gzipped. Don't import Dashboard statically from `App.tsx`.
- **roamingSettings has a ~32 KB total cap.** Tokens + tenant config + defaults fit comfortably, but don't dump large objects in there.
- **Manifest version bumps.** M365 admin rejects update uploads whose version isn't strictly greater than the deployed one. The setup wizard's `package.ts` bumps the patch on every regeneration when an existing version is known, or falls back to a timestamp-based version.

## Manifest version policy

The outlook manifest carries a 4-segment Office version `major.minor.patch.revision`:

- **`major.minor.patch`** — single source of truth at `apps/outlook/src/setup/version.ts` (`MANIFEST_VERSION`). Bump **manually** when manifest CONTENT changes in a way that requires admins to re-upload the .zip. Code-only changes (anything served from our origin) don't qualify.
- **`revision`** — auto-bumped by the setup wizard on every regeneration so each download is strictly greater than the prior one (required by M365 admin's update flow). Invisible to admins; ignored by the upgrade banner.

**Bump `MANIFEST_VERSION` when adding/changing:**
- permissions (`MailboxItem.*`, `Mailbox.*`, scopes)
- runtime declarations (new runtimes, new actions, new event handlers like `OnMessageSend`)
- runtime URLs (host/path — query params are stamped by the wizard so those don't count)
- icons (URL or size set)
- `requirements.capabilities` minVersion bumps
- ribbon/command surface changes that admins should see reflected in their tenant

**Don't bump for:**
- code logic in any .ts/.tsx/.js bundled into the SPA
- task-pane UI changes
- bug fixes inside `launchevent.js` / `commands.js`
- adding/removing components, helpers, dependencies

When bumping, update `MANIFEST_VERSION` only — the wizard handles the `.revision` reset on the next regeneration. The build emits `/outlook/latest.json` from this constant; the running SPA fetches it and compares against the `mv` URL query stamped by the wizard. Mismatch on `major.minor.patch` triggers a banner prompting the admin to re-upload.

## Things explicitly deferred (don't add without asking)

- Backend proxy / API gateway — pure SPA is the design.
- Server-side detection / classification layer — v2 work.
- Halo webhook handling — needs a backend.
- Time-tracking beyond per-action `time_taken` minutes — full timer / charge code logic is out of scope.
- Refactoring `apps/teams` / `apps/mcp` / `apps/browser-ext` to depend on `@iusehalo/halo-api` — they currently carry their own Halo client copies. Migration is a follow-up so each app can be moved independently.

## Likely first tasks after handoff

1. Replace the placeholder developer info in `apps/outlook/public/manifest.json` (privacyUrl, termsOfUseUrl, etc.) once you have the real URLs.
2. Test against a real Halo tenant — settle the payload variations listed under Gotchas.
3. Set up the EasyPanel deployment for `tools.iusehalo.com`.
4. Register the Halo Connect app in the Rising Tide tenant and run the first end-to-end auth.
