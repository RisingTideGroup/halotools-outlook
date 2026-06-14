import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getResourceForecast } from "@iusehalo/halo-api";

const inputSchema = {
  weeks: z.number().int().positive().max(26).optional().describe("Forecast horizon in weeks from today. Default 4."),
};

export function registerGetResourceForecast(server: McpServer): void {
  server.registerTool(
    "getResourceForecast",
    {
      title: "Get HaloPSA resource forecast (booked vs capacity)",
      description:
        "Forward resource load per technician: booked appointment hours over the next N weeks (from the APPOINTMENT calendar, excluding all-day/deleted) vs a weekly capacity target (UNAME.CFAgentRequiredBillableHours × weeks, default 40/wk). Flags over-allocated (>100% booked) and under-booked (<40%). Excludes bots and the Unassigned pseudo-agent. Use for capacity planning and spotting who's overloaded vs on the bench.",
      inputSchema,
    },
    async ({ weeks }) => {
      const res = await getResourceForecast(weeks ?? 4);
      return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
    },
  );
}
