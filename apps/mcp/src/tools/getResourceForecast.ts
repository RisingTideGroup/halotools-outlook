import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getResourceForecast } from "@iusehalo/halo-api";

const inputSchema = {
  weeks: z.number().int().positive().max(26).optional().describe("Forecast horizon in weeks from today. Default 4."),
  weeklyCapacityHours: z.number().positive().max(168).optional().describe("Assumed billable hours per technician per week. Default 40."),
};

export function registerGetResourceForecast(server: McpServer): void {
  server.registerTool(
    "getResourceForecast",
    {
      title: "Get HaloPSA resource forecast (booked vs capacity)",
      description:
        "Forward resource load per technician: booked CLIENT hours over the next N weeks vs a flat weekly capacity (weeklyCapacityHours × weeks, default 40/wk). scheduledHours counts only ticket-linked appointments (APFaultid>0 = client work); internalHours (unlinked = internal meetings) is reported separately and excluded from utilisation. Flags over-allocated (>100%) and under-booked (<40%). Excludes all-day/deleted appointments, bots, and the Unassigned pseudo-agent. Use for capacity planning and spotting who's overloaded vs on the bench.",
      inputSchema,
    },
    async ({ weeks, weeklyCapacityHours }) => {
      const res = await getResourceForecast(weeks ?? 4, weeklyCapacityHours ?? 40);
      return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
    },
  );
}
