import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getRevenuePerTechSnapshot } from "@iusehalo/halo-api";

export function registerGetRevenuePerTechSnapshot(server: McpServer): void {
  server.registerTool(
    "getRevenuePerTechSnapshot",
    {
      title: "Get HaloPSA revenue-per-technician snapshot",
      description:
        "MRR ÷ active agent count — a capacity/density ratio, NOT revenue attributed to each tech (MRR isn't tech-attributable). Returns the ratio plus the `agents` roster (who's counted) and `mrrByClient` (where the revenue actually comes from). Use for the headcount-density metric; for per-tech billable output/utilisation use getTechnicianUtilization or getTechnicianScorecard instead.",
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
