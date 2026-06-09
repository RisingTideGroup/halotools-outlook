import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { listOpportunities } from "@iusehalo/halo-api";

const inputSchema = {
  limit: z
    .number()
    .int()
    .positive()
    .max(500)
    .optional()
    .describe("Maximum number of opportunities to return. Default 100."),
};

export function registerListOpportunities(server: McpServer): void {
  server.registerTool(
    "listOpportunities",
    {
      title: "List HaloPSA sales opportunities",
      description:
        "Return current sales opportunities from HaloPSA's /Opportunities endpoint. Each row shows id, summary, client, status, and value. Use for pipeline / forecast questions.",
      inputSchema,
    },
    async ({ limit }) => {
      const all = await listOpportunities(limit ?? 100);
      const rows = all.map((o) => ({
        id: o.id,
        summary: o.summary,
        client_id: o.client_id,
        client_name: o.client_name,
        status_id: o.status_id,
        statusname: o.statusname,
        oppvalue: o.oppvalue,
        oppstatus: o.oppstatus,
        dateoccurred: o.dateoccurred,
      }));
      return {
        content: [{ type: "text", text: JSON.stringify(rows, null, 2) }],
      };
    },
  );
}
