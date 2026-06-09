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
        "Return a one-shot MSP KPI snapshot: MRR, active agent count, active user count, revenue per technician, MRR per seat, and technician utilization for the supplied window (defaults to trailing 30 days). Computes MRR once and shares it across the derived metrics — cheaper than calling each KPI tool separately. Utilization is best-effort: if /Timesheet is unavailable on this tenant, the field is omitted but the rest of the dashboard still returns.",
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
