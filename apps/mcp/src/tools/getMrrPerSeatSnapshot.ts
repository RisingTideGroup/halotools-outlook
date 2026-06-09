import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getMrrPerSeatSnapshot } from "@iusehalo/halo-api";

export function registerGetMrrPerSeatSnapshot(server: McpServer): void {
  server.registerTool(
    "getMrrPerSeatSnapshot",
    {
      title: "Get HaloPSA MRR-per-seat snapshot",
      description:
        "Return MRR divided by active external user (contact) count — revenue density per managed seat. Returns MRR, active user count, and the derived mrrPerSeat. Note: 'users' here means external Halo users (contacts), NOT internal agents (use getRevenuePerTechSnapshot for the agent-side metric).",
      inputSchema: {},
    },
    async () => {
      const snap = await getMrrPerSeatSnapshot();
      return {
        content: [{ type: "text", text: JSON.stringify(snap, null, 2) }],
      };
    },
  );
}
