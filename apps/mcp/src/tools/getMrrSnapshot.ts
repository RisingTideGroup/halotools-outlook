import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getMrrSnapshot } from "@iusehalo/halo-api";

export function registerGetMrrSnapshot(server: McpServer): void {
  server.registerTool(
    "getMrrSnapshot",
    {
      title: "Get HaloPSA MRR snapshot",
      description:
        "Current Monthly Recurring Revenue across active HaloPSA contracts, WITH a full per-client ranking: `byClient` lists every client by monthly recurring (contracts, monthlyRevenue, pctOfMrr) and `topClientPct` is the biggest client's share (concentration risk), plus a billing-period mix. Use this for 'top N clients by MRR', 'revenue concentration / at-risk', 'which clients drive recurring revenue' — it already ranks clients, so do NOT hand-roll listRecurringInvoices/listContracts for that. Net `revenue` (not tax-inclusive `total`); excludes disabled contracts.",
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
