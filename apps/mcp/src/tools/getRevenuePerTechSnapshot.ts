import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getRevenuePerTechSnapshot } from "@iusehalo/halo-api";

export function registerGetRevenuePerTechSnapshot(server: McpServer): void {
  server.registerTool(
    "getRevenuePerTechSnapshot",
    {
      title: "Get HaloPSA revenue-per-technician snapshot",
      description:
        "Return MRR divided by active agent count — the per-tech revenue density metric. Returns MRR, active agent count, and the derived revenuePerTech. Active agents come from /Agent with inactive filtered out.",
      inputSchema: {},
    },
    async () => {
      const snap = await getRevenuePerTechSnapshot();
      return {
        content: [{ type: "text", text: JSON.stringify(snap, null, 2) }],
      };
    },
  );
}
