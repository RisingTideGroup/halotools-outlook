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
    .describe("Max rows to return, ranked by recurring revenue desc. Default 50."),
  groupBy: z
    .enum(["client", "contract"])
    .optional()
    .describe(
      "Grain. 'client' (default) = whole-client profitability (one row per client; MSPs who want overall managed-services margin). 'contract' = per-contract breakdown (one row per contract, revenue tied via the recurring invoice line IDCHID; MSPs who manage profitability per agreement).",
    ),
};

export function registerGetRecurringContractProfitability(server: McpServer): void {
  server.registerTool(
    "getRecurringContractProfitability",
    {
      title: "Financial: Recurring contract profitability",
      description:
        "Are we profitable on our managed-services agreements? Compares monthly recurring revenue against the support effort delivered for it, at one of two grains (groupBy): per CLIENT (default — whole-client margin) or per CONTRACT (revenue tied to each contract via the generated recurring invoice line, INVOICEDETAIL.IDCHID; labour via ACTIONS.AContractId). Returns recurringRevenueMonthly (trailing-12-month recurring net ÷ 12), supportHoursMonthly, billable share, the techs who logged the time (topTechs, with hours + best-effort cost), and a margin where agent-cost data allows. At contract grain, unattributedRevenueMonthly holds recurring revenue on lines with no contract so the rows reconcile to total MRR. " +
        "LEAD WITH revenuePerSupportHour (recurring revenue ÷ support hours) — it's the reliable margin proxy and needs no cost data: low = lots of support delivered per dollar of fee (margin risk / over-serviced), high = light-touch. " +
        "grossMargin is only populated when costCoveragePct is high enough to trust (marginReliable) because most tenants put a cost on only a few agents; labour cost uses the agent's stored rate (UnameCostTracking, else UNAME.ucostPrice), assumed hourly — if a tenant stored annual salaries there it reads inflated, so check the values with exploreSchema if margins look off. Flags surface negative-margin / thin-margin (reliable only), low-cost-coverage, low-revenue-per-hour, and no-support-logged. Pairs with getMrrSnapshot (revenue side) and getTechnicianUtilization (effort side).",
      inputSchema,
    },
    async ({ limit, groupBy }) => {
      const snap = await getRecurringContractProfitability(limit ?? 50, groupBy ?? "client");
      return { content: [{ type: "text", text: JSON.stringify(snap, null, 2) }] };
    },
  );
}
