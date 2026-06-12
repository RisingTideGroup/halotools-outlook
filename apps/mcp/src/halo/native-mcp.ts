// Halo native MCP proxy.
//
// Halo exposes its own MCP server at <haloBaseUrl>/api/mcp on tenants where
// the admin has enabled it. When a user connects to OUR MCP, we detect this,
// fetch Halo's tool list, and register each one as a passthrough on our
// server's session — prefixed with `halo_` to disambiguate. Halo's tools then
// appear in Claude's tool catalogue alongside ours.
//
// The OAuth chain is already correct: by the time we're handling a tool call
// the user's Halo Bearer is in scope, and Halo's `/api/mcp` accepts the same
// token as `/api/Tickets` does — same Halo auth scope. We just forward.
//
// Detection is cached per tenant (haloBaseUrl) with a 1h TTL so we don't
// probe on every session init.

interface CachedDetection {
  enabled: boolean;
  tools: HaloMcpTool[];
  expiresAt: number;
}

export interface HaloMcpTool {
  name: string;
  title?: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

interface JsonRpcResponse<T = unknown> {
  jsonrpc: "2.0";
  id?: number | string | null;
  result?: T;
  error?: { code: number; message: string; data?: unknown };
}

const DETECTION_TTL_MS = 60 * 60 * 1000;
const detectionCache = new Map<string, CachedDetection>();

function cacheKey(haloBaseUrl: string): string {
  return haloBaseUrl.replace(/\/+$/, "");
}

/**
 * Probe `<haloBaseUrl>/api/mcp` with a `tools/list` JSON-RPC call. If Halo
 * returns a well-formed response, the native MCP is enabled and we capture
 * the tool list for later. Any failure (404 from older tenants, 401 from
 * misconfigured tokens, network) falls through to disabled — the caller
 * then serves only our own tools.
 */
export async function detectHaloMcp(
  haloBaseUrl: string,
  accessToken: string,
): Promise<{ enabled: boolean; tools: HaloMcpTool[] }> {
  const key = cacheKey(haloBaseUrl);
  const hit = detectionCache.get(key);
  if (hit && hit.expiresAt > Date.now()) {
    return { enabled: hit.enabled, tools: hit.tools };
  }

  try {
    const res = await fetch(`${key}/api/mcp`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
      }),
    });

    if (!res.ok) {
      detectionCache.set(key, { enabled: false, tools: [], expiresAt: Date.now() + DETECTION_TTL_MS });
      return { enabled: false, tools: [] };
    }

    const json = (await res.json()) as JsonRpcResponse<{ tools: HaloMcpTool[] }>;
    const tools = json.result?.tools ?? [];
    detectionCache.set(key, { enabled: true, tools, expiresAt: Date.now() + DETECTION_TTL_MS });
    return { enabled: true, tools };
  } catch {
    detectionCache.set(key, { enabled: false, tools: [], expiresAt: Date.now() + DETECTION_TTL_MS });
    return { enabled: false, tools: [] };
  }
}

/**
 * Forward a `tools/call` to Halo's native MCP. The user's Bearer is the same
 * token they already authenticated with — Halo's MCP accepts it. Returns the
 * `result` portion of Halo's JSON-RPC response (the MCP tool result shape:
 * `{ content: [...], isError?: boolean }`).
 */
export async function callHaloMcpTool(
  haloBaseUrl: string,
  accessToken: string,
  toolName: string,
  args: unknown,
): Promise<unknown> {
  const url = `${cacheKey(haloBaseUrl)}/api/mcp`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "Accept": "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: Math.floor(Math.random() * 1_000_000),
      method: "tools/call",
      params: { name: toolName, arguments: args },
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Halo MCP returned ${res.status}: ${text}`);
  }

  const json = (await res.json()) as JsonRpcResponse<unknown>;
  if (json.error) {
    throw new Error(`Halo MCP error ${json.error.code}: ${json.error.message}`);
  }
  return json.result;
}

/** Tools of ours that overlap closely with Halo's native equivalents — when
 *  proxy mode is active, we skip registering these locally so Claude doesn't
 *  see two near-identical options for the same job. Keep narrow: only obvious
 *  exact-or-better duplicates. */
export const OVERLAPPING_TOOL_NAMES: ReadonlySet<string> = new Set([
  "findContact", // Halo: Get One User / Search Users / Get User Info
  "searchTickets", // Halo: Search Tickets
  "listOpenTickets", // Halo: Get Assigned Tickets (close enough)
  "createTicket", // Halo: Create new Ticket
  "appendActionToTicket", // Halo: Add Note to Ticket
]);

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getTokens } from "@iusehalo/halo-api";

/** Normalise a Halo tool name (which may contain spaces and punctuation) to
 *  a valid MCP tool name suffix. "Search Tickets" → "search_tickets". */
function normaliseToolName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");
}

/** Convert a JSON Schema object to a Zod raw-shape the MCP SDK accepts. Covers
 *  the common primitive types; falls back to z.unknown() for anything weird. */
function jsonSchemaToZodShape(
  schema: Record<string, unknown> | undefined,
): Record<string, z.ZodTypeAny> {
  if (!schema || typeof schema !== "object") return {};
  const properties = (schema.properties as Record<string, Record<string, unknown>>) ?? {};
  const required = new Set((schema.required as string[]) ?? []);
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const [key, prop] of Object.entries(properties)) {
    let zType = jsonTypeToZod(prop);
    if (!required.has(key)) zType = zType.optional();
    shape[key] = zType;
  }
  return shape;
}

function jsonTypeToZod(prop: Record<string, unknown>): z.ZodTypeAny {
  const t = prop.type as string;
  let base: z.ZodTypeAny;
  switch (t) {
    case "string":
      base = z.string();
      break;
    case "number":
    case "integer":
      base = z.number();
      break;
    case "boolean":
      base = z.boolean();
      break;
    case "array":
      base = z.array(
        prop.items
          ? jsonTypeToZod(prop.items as Record<string, unknown>)
          : z.unknown(),
      );
      break;
    case "object":
      base = z.object(jsonSchemaToZodShape(prop));
      break;
    default:
      base = z.unknown();
  }
  if (prop.description) base = base.describe(prop.description as string);
  return base;
}

/** Register Halo's native MCP tools on our McpServer as `halo_<name>` proxies.
 *  Each proxy's handler reads the user's access token from the request scope
 *  (set by withRequestAuth) and forwards the call to `<haloBaseUrl>/api/mcp`. */
export function registerHaloProxyTools(
  server: McpServer,
  tools: HaloMcpTool[],
  haloBaseUrl: string,
): void {
  for (const tool of tools) {
    const proxyName = `halo_${normaliseToolName(tool.name)}`;
    const originalName = tool.name;
    server.registerTool(
      proxyName,
      {
        title: tool.title ?? originalName,
        description: `[Halo native] ${tool.description ?? originalName}`,
        inputSchema: jsonSchemaToZodShape(tool.inputSchema),
      },
      async (args: Record<string, unknown>) => {
        const tokens = getTokens();
        if (!tokens?.accessToken) {
          return {
            content: [
              { type: "text" as const, text: "Error: no Halo access token in request scope." },
            ],
            isError: true,
          };
        }
        try {
          const result = (await callHaloMcpTool(
            haloBaseUrl,
            tokens.accessToken,
            originalName,
            args,
          )) as { content: Array<{ type: "text"; text: string }>; isError?: boolean };
          return result;
        } catch (e) {
          return {
            content: [
              { type: "text" as const, text: `Halo MCP error: ${(e as Error).message}` },
            ],
            isError: true,
          };
        }
      },
    );
  }
}
