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
        "Per-project profitability. Projects are refilled PREPAY BLOCKS, not fixed-fee: the budget is prepayPurchasedHours (PREPAYHISTORY top-ups on the contract), not the stale estimate. Auto-detects the billing model (retainer prepay → T&M ActionChargeAmount → fixed/internal) and returns revenue, delivered hours, billableHours, prepayPurchasedHours/prepayConsumedHours, soldRate (revenue/purchased hrs), effectiveRate (revenue/delivered hrs), unchargedHours (billable delivered but NOT deducted from the block = leaked labour) + unchargedValue, labour cost with coverage %, gross margin (reliable only when costCoveragePct≥80), and overServiced (delivered > purchased block). All amounts in the home currency (returned in `currency`). Effective/sold rate is the robust profitability proxy when cost coverage is low.",
      inputSchema,
    },
    async ({ limit, minHours }) => {
      const res = await getProjectProfitability(limit ?? 50, minHours ?? 1);
      return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
    },
  );
}
