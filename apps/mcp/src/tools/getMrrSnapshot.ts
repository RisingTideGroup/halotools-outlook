import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getMrrSnapshot } from "@iusehalo/halo-api";

export function registerGetMrrSnapshot(server: McpServer): void {
  server.registerTool(
    "getMrrSnapshot",
    {
      title: "Get HaloPSA MRR snapshot",
      description:
        "Monthly Recurring Revenue read from the ACTUAL marked-recurring invoices (invoice lines where idrecurringinvoiceid < -1), NOT a TTM/12 average. `mrr` is recurring invoiced in the latest COMPLETE calendar month (`mrrMonth`); `recentMonths` carries the in-progress month (partial) plus trailing complete months — use it for the multi-window read before stating any trend, since recurring billing is lumpy (quarterly/annual contracts land in a single month). `byClient` ranks clients by that month's recurring (with pctOfMrr); `topClientPct` is the biggest client's share. Use for 'top N clients by MRR', 'revenue concentration', 'which clients drive recurring revenue' — do NOT hand-roll listRecurringInvoices/listContracts. (TTM/12 was removed: it under-reported any tenant with <12 months of billing.)",
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
