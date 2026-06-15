import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getMrrPerSeatSnapshot } from "@iusehalo/halo-api";

export function registerGetMrrPerSeatSnapshot(server: McpServer): void {
  server.registerTool(
    "getMrrPerSeatSnapshot",
    {
      title: "Get HaloPSA MRR-per-seat snapshot",
      description:
        "MRR ÷ active end-user (contact) count — revenue density per managed seat (ARPU-ish), WITH `seatsByClient`: clients ranked by seat count and % of seats. Use for 'how many seats per client', 'which clients have the most users', seat concentration. 'Users' = external Halo contacts, NOT internal agents (use getRevenuePerTechSnapshot for the agent-side ratio).",
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
