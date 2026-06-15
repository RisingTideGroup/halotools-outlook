import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getMrrPerSeatSnapshot } from "@iusehalo/halo-api";

export function registerGetMrrPerSeatSnapshot(server: McpServer): void {
  server.registerTool(
    "getMrrPerSeatSnapshot",
    {
      title: "Get HaloPSA MRR-per-seat snapshot",
      description:
        "MRR per managed seat, reflected BOTH ways: userSeats = active end-users EXCLUDING service accounts and the per-client 'General User' placeholder (~1/client, a large exclusion); assetSeats = active devices. Returns mrrPerUserSeat, mrrPerAssetSeat, and seatsByClient (userSeats + assetSeats + pctOfUserSeats per client). Use for 'how many seats per client', 'which clients have the most users/devices', seat concentration. 'Users' = external Halo contacts, NOT internal agents (use getRevenuePerTechSnapshot for the agent ratio). Note this tenant tracks few devices, so user-seats is the meaningful figure.",
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
