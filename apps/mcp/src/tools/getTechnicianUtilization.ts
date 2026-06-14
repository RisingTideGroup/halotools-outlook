import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getTechnicianUtilization } from "@iusehalo/halo-api";

const inputSchema = {
  startdate: z.string().optional().describe("Window start (YYYY-MM-DD). Default 30 days ago."),
  enddate: z.string().optional().describe("Window end (YYYY-MM-DD). Default today."),
  dailyCapacityHours: z.number().positive().max(24).optional().describe("Capacity hours per working weekday. Default 8."),
  targetUtilisationPct: z.number().positive().max(100).optional().describe("Target worked-utilisation %. Below it flags below-target; below half flags under-utilised. Default 75."),
};

export function registerGetTechnicianUtilization(server: McpServer): void {
  server.registerTool(
    "getTechnicianUtilization",
    {
      title: "Get HaloPSA technician utilisation (booked vs worked vs billable)",
      description:
        "Per-technician utilisation over a past window from three standard sources: booked calendar time (APPOINTMENT), actually-logged work and its billable share (ACTIONS timetaken + ActIsBillable), and leave (HOLIDAYS) which reduces capacity. Capacity = working weekdays × dailyCapacityHours − leave. Returns per-agent and rolled-up bookedUtil (calendar fill), workedUtil (logged effort vs capacity), billableUtil (revenue-bearing utilisation), and billability (billable/worked, the work-mix quality), with status flags for over-allocated, under-utilised/below-target, and low-billability. Use to evaluate over/under-utilisation and billable efficiency across the team.",
      inputSchema,
    },
    async ({ startdate, enddate, dailyCapacityHours, targetUtilisationPct }) => {
      const res = await getTechnicianUtilization(
        startdate,
        enddate,
        dailyCapacityHours ?? 8,
        targetUtilisationPct ?? 75,
      );
      return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
    },
  );
}
