import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getServiceDeskHealth } from "@iusehalo/halo-api";

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
      "Which tickets to count. 'reactive' (default) excludes projects and opportunities; 'all' counts every non-deleted, non-merged ticket.",
    ),
  clientId: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Optional Halo client (company) ID to scope the snapshot to a single client."),
};

export function registerGetServiceDeskHealth(server: McpServer): void {
  server.registerTool(
    "getServiceDeskHealth",
    {
      title: "Get HaloPSA service-desk health snapshot",
      description:
        "One-shot service-desk KPI snapshot for a window (defaults to trailing 30 days): ticket inflow vs outflow, current open backlog and live SLA breaches, first-response and resolution SLA attainment %, mean time to resolve (wall-clock hours from ticket open to clear), first-time-fix rate, and CSAT (AI-derived plus native survey). Optionally scoped to one client via clientId. Cohorts differ by metric: inflow/first-response/CSAT are measured on tickets created in the window; outflow/resolution-SLA/MTTR/first-time-fix on tickets resolved in the window; backlog/breaches are point-in-time. This is the 'how is the service desk doing' tool — prefer it over hand-written SQL for the standard KPI set.",
      inputSchema,
    },
    async ({ startdate, enddate, scope, clientId }) => {
      const snap = await getServiceDeskHealth(startdate, enddate, scope ?? "reactive", clientId);
      return { content: [{ type: "text", text: JSON.stringify(snap, null, 2) }] };
    },
  );
}
