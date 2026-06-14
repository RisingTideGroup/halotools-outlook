import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getCategoryInsights } from "@iusehalo/halo-api";

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
    .describe("'reactive' (default) excludes projects and opportunities; 'all' counts every type."),
  limit: z
    .number()
    .int()
    .positive()
    .max(100)
    .optional()
    .describe("Max categories per ranked list. Default 15."),
};

export function registerGetCategoryInsights(server: McpServer): void {
  server.registerTool(
    "getCategoryInsights",
    {
      title: "Get HaloPSA ticket-categorisation insights",
      description:
        "Ticket-categorisation health for a window (defaults to trailing 30 days): the share of tickets that are uncategorised (a high % — industry red flag ~40%+ — means reporting is blind to recurring issues), the top categories by ticket volume and by logged hours, and recurring-problem candidates (named categories ranked by tickets × hours = the KB-article / automation targets). Uses Halo's primary category (faults.category2). Use to audit taxonomy quality and find what to document or automate.",
      inputSchema,
    },
    async ({ startdate, enddate, scope, limit }) => {
      const snap = await getCategoryInsights(startdate, enddate, scope ?? "reactive", limit ?? 15);
      return { content: [{ type: "text", text: JSON.stringify(snap, null, 2) }] };
    },
  );
}
