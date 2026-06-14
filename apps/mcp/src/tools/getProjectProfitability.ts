import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getProjectProfitability } from "@iusehalo/halo-api";

const inputSchema = {
  limit: z.number().int().positive().max(500).optional().describe("Max projects to return, sorted by hours. Default 50."),
  minHours: z.number().min(0).optional().describe("Only projects with more than this many delivered hours. Default 1."),
};

export function registerGetProjectProfitability(server: McpServer): void {
  server.registerTool(
    "getProjectProfitability",
    {
      title: "Get HaloPSA project profitability (auto-detected billing model)",
      description:
        "Per-project profitability. revenue = RECOGNISED revenue from distinct linked invoice lines (covers both prepay deferred-revenue and T&M, no double count); prepayRecognised + tmRecognised break it down. Projects are refilled PREPAY BLOCKS, not fixed-fee: the budget is prepayPurchasedHours (PREPAYHISTORY top-ups), not the stale estimate; prepayRevenue is cash collected. Returns delivered/billable hours, prepayPurchased/Consumed hours, soldRate, effectiveRate (revenue/delivered hrs), unchargedHours (billable time billed NEITHER via prepay NOR a charge amount = leaked labour) + unchargedValue, labour cost with coverage %, gross margin (reliable only when costCoveragePct≥80), and overServiced (delivered > purchased block). For the deferred-revenue account balance per client/contract (collected vs recognised vs remaining/over-drawn) use getPrepayAccountBalance. Amounts in the home currency (`currency`).",
      inputSchema,
    },
    async ({ limit, minHours }) => {
      const res = await getProjectProfitability(limit ?? 50, minHours ?? 1);
      return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
    },
  );
}
