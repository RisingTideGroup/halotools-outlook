import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getMrrSnapshot } from "@iusehalo/halo-api";

export function registerGetMrrSnapshot(server: McpServer): void {
  server.registerTool(
    "getMrrSnapshot",
    {
      title: "Get HaloPSA MRR snapshot",
      description:
        "Return current Monthly Recurring Revenue across all active HaloPSA contracts, with a breakdown by billing period (monthly, quarterly, semi-annual, annual). Uses the net `revenue` field, not `total` (which includes tax). Excludes contracts marked disabled. Returns one normalized number plus the supporting breakdown — ask this when you want a single MRR figure rather than paginating through invoices.",
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
