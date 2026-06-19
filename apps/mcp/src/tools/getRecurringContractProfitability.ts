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
      title: "Get HaloPSA recurring-contract profitability",
      description:
        "Are we profitable on our managed-services agreements? Compares the latest complete month's recurring revenue against the support delivered for it, at one of two grains (groupBy): per CLIENT (default) or per CONTRACT (revenue tied via the recurring invoice line INVOICEDETAIL.IDCHID; labour via ACTIONS.AContractId). recurringRevenueMonthly = actual recurring invoiced that month (never TTM/12; use getMrrSnapshot.recentMonths for the trailing read). " +
        "LABOUR IS SPLIT BY ITIL TYPE (FAULTS.requesttype): reactiveHoursMonthly = Incident+Service-Request (1,3), the support the fee actually covers — and the margin is read against THAT slice. projectHoursMonthly (22/23/24, separately billed), problemHoursMonthly (4, root-cause) and adminHoursMonthly (Advice/Other 21 + rest) are reported but EXCLUDED from the margin so they don't dilute it. " +
        "LEAD WITH revenuePerReactiveHour (recurring ÷ reactive hours) — the reliable margin proxy, no cost data needed: low = lots of covered support per dollar of fee (margin risk), high = light-touch. grossMargin (recurring − reactive labour cost) only populates when reactiveCostCoveragePct ≥ 80% (marginReliable), since most tenants cost only a few agents; rate assumed hourly — annual salaries read inflated, check with exploreSchema. topTechs = who delivered the reactive support. Flags: no-reactive-support (fee with ~0 covered support — licensing-only or under-served), negative-margin / thin-margin (reliable only), low-cost-coverage, low-revenue-per-reactive-hour. At contract grain, unattributedRevenueMonthly holds recurring on lines with no contract so rows reconcile to MRR. Pairs with getMrrSnapshot (revenue) and getTechnicianUtilization (effort).",
      inputSchema,
    },
    async ({ limit, groupBy }) => {
      const snap = await getRecurringContractProfitability(limit ?? 50, groupBy ?? "client");
      return { content: [{ type: "text", text: JSON.stringify(snap, null, 2) }] };
    },
  );
}
