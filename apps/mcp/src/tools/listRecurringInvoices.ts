import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { listRecurringInvoices, periodToMonthlyFactor } from "@iusehalo/halo-api";

export function registerListRecurringInvoices(server: McpServer): void {
  server.registerTool(
    "listRecurringInvoices",
    {
      title: "List active HaloPSA recurring invoices",
      description:
        "Return every active recurring invoice (contract) in HaloPSA, with normalized monthly revenue. Source for MRR calculations. Excludes invoices with disabled=true. Each row shows raw revenue + period plus a derived monthlyRevenue using the period→monthly mapping (3=monthly, 4=quarterly, 5=semi-annual, 6=annual).",
      inputSchema: {},
    },
    async () => {
      const all = await listRecurringInvoices();
      const active = all.filter((i) => i.disabled !== true);
      const rows = active.map((i) => ({
        id: i.id,
        client_id: i.client_id,
        client_name: i.client_name,
        contract_id: i.contract_id,
        revenue: i.revenue,
        total: i.total,
        period: i.period,
        monthlyRevenue:
          Math.round(((i.revenue ?? 0) * periodToMonthlyFactor(i.period)) * 100) /
          100,
      }));
      return {
        content: [{ type: "text", text: JSON.stringify(rows, null, 2) }],
      };
    },
  );
}
