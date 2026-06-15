import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getMspKpis } from "@iusehalo/halo-api";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const inputSchema = {
  utilizationStart: z
    .string()
    .regex(DATE_RE, "YYYY-MM-DD")
    .optional()
    .describe(
      "Utilization window start date, YYYY-MM-DD. Defaults to 30 days ago.",
    ),
  utilizationEnd: z
    .string()
    .regex(DATE_RE, "YYYY-MM-DD")
    .optional()
    .describe("Utilization window end date, YYYY-MM-DD. Defaults to today."),
};

export function registerGetMspKpis(server: McpServer): void {
  server.registerTool(
    "getMspKpis",
    {
      title: "Get HaloPSA MSP KPI dashboard",
      description:
        "One-shot MSP KPI dashboard: MRR, active agent/user counts, revenue-per-tech, MRR-per-seat, technician utilization, AND `mrrByClient` (top 25 clients by MRR) — the headline numbers plus the client and per-agent breakdowns inline, so 'top clients' / 'who's under-utilised' / concentration follow-ups are answerable without another call. Window defaults to trailing 30 days. MRR computed once and shared — cheaper than calling each KPI tool. Utilization is best-effort (omitted if /Timesheet is unavailable).",
      inputSchema,
    },
    async ({ utilizationStart, utilizationEnd }) => {
      const kpis = await getMspKpis(utilizationStart, utilizationEnd);
      return {
        content: [{ type: "text", text: JSON.stringify(kpis, null, 2) }],
      };
    },
  );
}
