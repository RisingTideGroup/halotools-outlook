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
  /** OAuth scope requested at /authorize. Must match the scope granted on the
   *  Halo Connect app or sign-in fails. Defaults to "all"; only non-default
   *  values (e.g. "all:standard") are carried in the blob, so existing "all"
   *  URLs stay byte-for-byte identical. */
  scope?: string;
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
  const cleaned: Record<string, string> = {
    halo: cfg.halo.replace(/\/+$/, ""),
    clientId: cfg.clientId.trim(),
  };
  // Only carry a non-default scope so existing "all" URLs are unchanged.
  const scope = cfg.scope?.trim();
  if (scope && scope !== "all") cleaned.scope = scope;
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
  const scope =
    typeof obj.scope === "string" && obj.scope.trim() ? obj.scope.trim() : undefined;
  return { halo: obj.halo.replace(/\/+$/, ""), clientId: obj.clientId, scope };
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
