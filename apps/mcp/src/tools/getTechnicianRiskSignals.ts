import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getTechnicianRiskSignals } from "@iusehalo/halo-api";

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
    .max(200)
    .optional()
    .describe("Max technicians to return. Default 50."),
};

export function registerGetTechnicianRiskSignals(server: McpServer): void {
  server.registerTool(
    "getTechnicianRiskSignals",
    {
      title: "Get HaloPSA technician risk signals (coaching vs disengagement)",
      description:
        "Per-technician leading risk signals for a window (defaults to trailing 30 days), to separate techs who NEED COACHING from techs who look DISENGAGED. Of the reactive tickets each tech closed: zero-time-close rate (tickets closed with no time logged), resolution-SLA breach rate, and AI CSAT; plus their current owned-open backlog and the share of it that's stale (no action in 3+ days). Raises heuristic flags (high-zero-time-closes >30%, low-sla-attainment >20% breach, stale-backlog, low-csat <5). IMPORTANT: these are signals to investigate, not verdicts — a tech who under-logs time can look idle while busy; cross-read with throughput. Deeper per-category coaching, after-hours patterns, round-number time-entry analysis and utilisation-vs-target live in the reports/technicians SQL library.",
      inputSchema,
    },
    async ({ startdate, enddate, scope, limit }) => {
      const snap = await getTechnicianRiskSignals(startdate, enddate, scope ?? "reactive", limit ?? 50);
      return { content: [{ type: "text", text: JSON.stringify(snap, null, 2) }] };
    },
  );
}
