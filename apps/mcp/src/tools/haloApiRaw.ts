import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { haloApiRaw } from "@iusehalo/halo-api";

const inputSchema = {
  path: z
    .string()
    .min(1)
    .describe(
      "Halo REST path starting with '/', e.g. '/Agent' or '/Tickets/123'. The host + '/api' prefix are added automatically.",
    ),
  method: z
    .enum(["GET", "POST", "PUT", "PATCH", "DELETE"])
    .optional()
    .describe("HTTP method. Defaults to GET."),
  query: z
    .record(z.union([z.string(), z.number(), z.boolean()]))
    .optional()
    .describe(
      "Object of query-string parameters. Values are coerced to strings.",
    ),
  body: z
    .unknown()
    .optional()
    .describe(
      "Optional JSON body for POST/PUT/PATCH. Pass an object or array; it will be JSON.stringify'd.",
    ),
};

export function registerHaloApiRaw(server: McpServer): void {
  server.registerTool(
    "haloApiRaw",
    {
      title: "API: Raw HaloPSA REST call (writes / escape hatch)",
      description:
        "Escape-hatch passthrough to any HaloPSA REST endpoint, using the user's current OAuth token. This is the WRITE path — use it for POST/PUT/PATCH/DELETE, and for any one-off no typed tool covers. For READ-ONLY GETs prefer haloApiGet (it can't write, so it's safe to use freely and a restrictive policy can allow it while blocking this tool). Prefer the typed tools (findContact, searchTickets, createTicket, appendActionToTicket, getMspKpis, etc.) where they exist; they parse Halo's response variants for you. Returns the raw parsed JSON response. Defaults to GET if no method is given.",
      inputSchema,
    },
    async ({ path, method, query, body }) => {
      const res = await haloApiRaw<unknown>(path, {
        method: method ?? "GET",
        query: query as Record<string, string | number | boolean> | undefined,
        body,
      });
      return {
        content: [{ type: "text", text: JSON.stringify(res, null, 2) }],
      };
    },
  );
}
