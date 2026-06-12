import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getClientHealthScorecard } from "@iusehalo/halo-api";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const inputSchema = {
  startdate: z
    .string()
    .regex(DATE_RE, "YYYY-MM-DD")
    .optional()
    .describe("Window start date, YYYY-MM-DD. Defaults to 30 days ago."),
  enddate: z
    .string()
    .regex(DATE_RE, "YYYY-MM-DD")
    .optional()
    .describe("Window end date (inclusive), YYYY-MM-DD. Defaults to today."),
  scope: z
    .enum(["reactive", "all"])
    .optional()
    .describe(
      "Which tickets to count. 'reactive' (default) excludes projects and opportunities; 'all' counts every type.",
    ),
  limit: z
    .number()
    .int()
    .positive()
    .max(500)
    .optional()
    .describe("Maximum number of clients to return, sorted by tickets created. Default 50."),
};

export function registerGetClientHealthScorecard(server: McpServer): void {
  server.registerTool(
    "getClientHealthScorecard",
    {
      title: "Get HaloPSA per-client service-health scorecard",
      description:
        "Per-client service-health scorecard for a window (defaults to trailing 30 days): tickets created and resolved, current open count, resolution and first-response SLA attainment %, mean time to resolve (wall-clock hours), and AI CSAT average. Sorted by tickets created (busiest clients first), capped at `limit`. Use to spot at-risk or unprofitable accounts — e.g. high volume paired with low SLA attainment or low CSAT. For revenue/MRR per client, combine with listRecurringInvoices.",
      inputSchema,
    },
    async ({ startdate, enddate, scope, limit }) => {
      const snap = await getClientHealthScorecard(startdate, enddate, scope ?? "reactive", limit ?? 50);
      return { content: [{ type: "text", text: JSON.stringify(snap, null, 2) }] };
    },
  );
}
