import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getMrrSnapshot } from "@iusehalo/halo-api";

export function registerGetMrrSnapshot(server: McpServer): void {
  server.registerTool(
    "getMrrSnapshot",
    {
      title: "Get HaloPSA MRR snapshot",
      description:
        "Monthly Recurring Revenue from the ACTUAL recurring-generated invoices (trailing-12-month net ÷ 12 — real invoiced amounts, not the schedule's nominal/stale figure), WITH a full per-client ranking: `byClient` lists every client by monthlyRevenue + pctOfMrr, `topClientPct` is the biggest client's share (concentration), and `byCadence` is the monthly/quarterly/annual mix. Use for 'top N clients by MRR', 'revenue concentration / at-risk', 'which clients drive recurring revenue' — it already ranks clients, so do NOT hand-roll listRecurringInvoices/listContracts. (TTM/12 run-rate, so clients onboarded <12mo read slightly low.)",
      inputSchema: {},
    },
    async () => {
      const snap = await getMrrSnapshot();
      return {
        content: [{ type: "text", text: JSON.stringify(snap, null, 2) }],
      };
    },
  );
}
