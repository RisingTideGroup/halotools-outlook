import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getRecurringContractProfitability } from "@iusehalo/halo-api";

const inputSchema = {
  limit: z
    .number()
    .int()
    .positive()
    .max(500)
    .optional()
    .describe("Max clients to return, ranked by recurring revenue desc. Default 50."),
};

export function registerGetRecurringContractProfitability(server: McpServer): void {
  server.registerTool(
    "getRecurringContractProfitability",
    {
      title: "Financial: Recurring contract profitability",
      description:
        "Are we profitable on our managed-services agreements? Per client (the de-facto recurring contract), compares monthly recurring revenue against the support effort delivered for it: recurringRevenueMonthly (trailing-12-month recurring invoice net ÷ 12), supportHoursMonthly (all time logged on the client's tickets), billable share, the techs who logged the time (topTechs, with hours + best-effort cost), and a margin where agent-cost data allows. " +
        "LEAD WITH revenuePerSupportHour (recurring revenue ÷ support hours) — it's the reliable margin proxy and needs no cost data: low = lots of support delivered per dollar of fee (margin risk / over-serviced), high = light-touch. " +
        "GRAIN is the CLIENT: recurring revenue is client-grained in Halo (recurring invoices carry no contract id), so per-contract revenue isn't derivable; activeContracts is shown for context. " +
        "grossMargin is only populated when costCoveragePct is high enough to trust (marginReliable) because most tenants put a cost on only a few agents; labour cost is normalised for the annual-salary-in-hourly-field trap (values >1000 ÷ 2080). Flags surface negative-margin / thin-margin (reliable only), low-cost-coverage, low-revenue-per-hour, and no-support-logged. Pairs with getMrrSnapshot (revenue side) and getTechnicianUtilization (effort side).",
      inputSchema,
    },
    async ({ limit }) => {
      const snap = await getRecurringContractProfitability(limit ?? 50);
      return { content: [{ type: "text", text: JSON.stringify(snap, null, 2) }] };
    },
  );
}
