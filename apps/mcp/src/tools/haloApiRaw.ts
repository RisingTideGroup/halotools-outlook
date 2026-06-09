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
      title: "Call a HaloPSA REST endpoint directly",
      description:
        "Escape-hatch passthrough to any HaloPSA REST endpoint, using the user's current OAuth token. Use this when no typed tool covers what you need — for example, probing a new endpoint, exploring field shapes, or one-off list/filter combinations. Prefer the typed tools (findContact, searchTickets, listOpenTickets, getMspKpis, etc.) where they exist; they parse Halo's response variants for you. Returns the raw parsed JSON response.",
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
