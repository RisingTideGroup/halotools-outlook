import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { haloApiRaw } from "@iusehalo/halo-api";

const inputSchema = {
  path: z
    .string()
    .min(1)
    .describe(
      "Halo REST path starting with '/', e.g. '/Agent', '/Tickets/123', '/Site'. The host + '/api' prefix are added automatically.",
    ),
  query: z
    .record(z.union([z.string(), z.number(), z.boolean()]))
    .optional()
    .describe(
      "Object of query-string parameters (e.g. {count: 5, includedetails: true}). Values are coerced to strings.",
    ),
};

export function registerHaloApiGet(server: McpServer): void {
  server.registerTool(
    "haloApiGet",
    {
      title: "Read a HaloPSA REST endpoint (GET only)",
      description:
        "Read-only passthrough to any HaloPSA REST endpoint (GET only), using the user's current OAuth token. Safe to use freely — it cannot write. Prefer the typed tools (findContact, searchTickets, listOpenTickets, getMspKpis, etc.) where they exist; reach for this to probe an endpoint or inspect field shapes no typed tool covers. For writes (POST/PUT/PATCH/DELETE) use haloApiRaw instead.\n\nSCHEMA DISCOVERY: the REST API is a second lens on the same data as runSql/exploreSchema, and the two cross-reference. The endpoint name is more often than not the database table name (e.g. /Site ↔ SITE, /Faults ↔ FAULTS, /Users ↔ USERS), and a report's `mainEntity` confirms it. When a database column's meaning is unclear, GET the matching endpoint for one record and compare the API field names/values against the row from exploreSchema(action:'sample') — the friendly API label next to the raw column value tells you what the column means. Returns the raw parsed JSON response.",
      inputSchema,
    },
    async ({ path, query }) => {
      const res = await haloApiRaw<unknown>(path, {
        method: "GET",
        query: query as Record<string, string | number | boolean> | undefined,
      });
      return {
        content: [{ type: "text", text: JSON.stringify(res, null, 2) }],
      };
    },
  );
}
