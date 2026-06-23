import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getTechnicianScorecard } from "@iusehalo/halo-api";

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
      "Which resolved tickets to count. 'reactive' (default) excludes projects and opportunities; 'all' counts every type.",
    ),
  limit: z
    .number()
    .int()
    .positive()
    .max(200)
    .optional()
    .describe("Maximum number of technicians to return, sorted by tickets resolved. Default 25."),
};

export function registerGetTechnicianScorecard(server: McpServer): void {
  server.registerTool(
    "getTechnicianScorecard",
    {
      title: "Get HaloPSA technician performance scorecard",
      description:
        "Per-technician performance scorecard for a window (defaults to trailing 30 days), grouped by the agent who closed each resolved ticket. Returns, per tech: tickets resolved, mean time to resolve (wall-clock hours), resolution and first-response SLA attainment %, first-time-fix count/rate, AI CSAT average, and hours logged / billable (from time entries the agent authored in the window across all ticket types — so they reflect total effort, not just the reactive tickets in 'resolved'). hoursLogged is split by ITIL type (FAULTS.requesttype): hoursReactive (Incident+Service-Request 1,3 — matches the default reactive scope), hoursProject (22/23/24), hoursProblem (4), hoursAdmin (Advice/Other 21 + non-ticket), so you can see how much of an agent's effort was reactive desk work vs project/admin. Sorted by tickets resolved. Use to compare technician throughput and quality for reviews or coaching.",
      inputSchema,
    },
    async ({ startdate, enddate, scope, limit }) => {
      const snap = await getTechnicianScorecard(startdate, enddate, scope ?? "reactive", limit ?? 25);
      return { content: [{ type: "text", text: JSON.stringify(snap, null, 2) }] };
    },
  );
}
