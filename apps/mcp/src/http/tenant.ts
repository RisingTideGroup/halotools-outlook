// Per-MCP-URL tenant config encoding.
//
// The MCP URL a user pastes into Claude/Cursor looks like:
//
//   https://tools.iusehalo.com/mcp/t/<config>/
//
// where <config> = base64url(JSON({ halo, clientId })). This lets every endpoint
// (transport, /authorize, /token, .well-known) read the tenant from the URL path
// without needing the client to pass headers or query params separately. The
// OAuth metadata we serve embeds <config> in every endpoint URL we emit, so
// Claude never needs to know the structure.

export interface TenantConfig {
  halo: string;
  clientId: string;
}

function base64urlEncode(input: string): string {
  return Buffer.from(input, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function base64urlDecode(input: string): string {
  const pad = input.length % 4 === 0 ? "" : "=".repeat(4 - (input.length % 4));
  const b64 = input.replace(/-/g, "+").replace(/_/g, "/") + pad;
  return Buffer.from(b64, "base64").toString("utf8");
}

export function encodeTenant(cfg: TenantConfig): string {
  const cleaned: TenantConfig = {
    halo: cfg.halo.replace(/\/+$/, ""),
    clientId: cfg.clientId.trim(),
  };
  return base64urlEncode(JSON.stringify(cleaned));
}

export function decodeTenant(blob: string): TenantConfig {
  let raw: string;
  try {
    raw = base64urlDecode(blob);
  } catch {
    throw new Error("Invalid tenant blob: not base64url");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Invalid tenant blob: not JSON");
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Invalid tenant blob: not an object");
  }
  const obj = parsed as Record<string, unknown>;
  if (typeof obj.halo !== "string" || !/^https?:\/\//i.test(obj.halo)) {
    throw new Error("Invalid tenant blob: missing/malformed halo URL");
  }
  if (typeof obj.clientId !== "string" || !obj.clientId) {
    throw new Error("Invalid tenant blob: missing clientId");
  }
  return { halo: obj.halo.replace(/\/+$/, ""), clientId: obj.clientId };
}

/**
 * Derive a short, stable per-instance slug from a Halo base URL, used to
 * namespace this instance's MCP tool names so multiple HaloPSA connections
 * don't collide in a client (e.g. `spiretech_runSql`).
 *
 *   admin.spiretech.com        → spiretech      (registrable domain label)
 *   psa.settonconsulting.com   → settonconsulting
 *   service.risingtidegroup.net → risingtidegroup
 *   acme.halopsa.com           → acme           (subdomain for *.halopsa.com)
 *
 * For *.halopsa.com tenants the meaningful name is the subdomain; for custom
 * domains it's the registrable domain's main label (the SLD). Falls back to
 * "halo" if nothing usable can be parsed.
 */
export function instanceSlug(haloBaseUrl: string): string {
  let host: string;
  try {
    host = new URL(haloBaseUrl).hostname.toLowerCase();
  } catch {
    host = haloBaseUrl.toLowerCase();
  }
  const labels = host.replace(/\.+$/, "").split(".").filter(Boolean);
  // Second-level public-suffix tokens (e.g. co.uk, com.au, org.nz) — when the
  // second-to-last label is one of these, the registrable name is one further
  // left. Covers the common ccTLD cases without a full public-suffix list.
  const SECOND_LEVEL_SUFFIXES = new Set([
    "co", "com", "org", "net", "gov", "edu", "ac", "ltd", "plc",
  ]);
  let slug = "halo";
  if (labels.length >= 3 && host.endsWith("halopsa.com")) {
    // <subdomain>.halopsa.com → the label immediately before "halopsa"
    slug = labels[labels.length - 3];
  } else if (labels.length >= 2) {
    // custom domain → registrable domain's main label, skipping a two-part
    // TLD's second level (example.co.uk → "example", not "co").
    let i = labels.length - 2;
    if (i - 1 >= 0 && SECOND_LEVEL_SUFFIXES.has(labels[i])) i -= 1;
    slug = labels[i];
  } else if (labels.length === 1) {
    slug = labels[0];
  }
  slug = slug.replace(/[^a-z0-9]/g, "");
  return slug || "halo";
}

/** Parses /mcp/t/<config>/<rest> URL paths. Returns null for non-matching paths. */
export interface ParsedTenantPath {
  configBlob: string;
  tenant: TenantConfig;
  /** The portion of the path after `/mcp/t/<config>/`. Leading slash NOT included. */
  rest: string;
}

const TENANT_PATH_RE = /^\/mcp\/t\/([A-Za-z0-9_-]+)(?:\/(.*))?$/;

export function parseTenantPath(pathname: string): ParsedTenantPath | null {
  const m = TENANT_PATH_RE.exec(pathname);
  if (!m) return null;
  const configBlob = m[1];
  let tenant: TenantConfig;
  try {
    tenant = decodeTenant(configBlob);
  } catch {
    return null;
  }
  return { configBlob, tenant, rest: m[2] ?? "" };
}
