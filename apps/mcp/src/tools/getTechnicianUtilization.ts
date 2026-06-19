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
        "Per-technician utilisation over a past window from three standard sources: booked calendar time (APPOINTMENT), actually-logged work (ACTIONS timetaken) and its billable share (the billed-hour buckets actionchargehours + actionnonchargehours + actionprepayhours = invoiceable + agreement-covered + prepay-covered, all billable), and leave (HOLIDAYS) which reduces capacity. Capacity = working weekdays × dailyCapacityHours − leave. worked is SPLIT BY ITIL TYPE (FAULTS.requesttype): reactiveHours (Incident+Service-Request 1,3), projectHours (22/23/24), problemHours (4), adminHours (Advice/Other 21 + non-ticket) — they sum to worked, with adminSharePct flagging effort lost to admin/quick-time. Returns per-agent and rolled-up bookedUtil (calendar fill), workedUtil (logged effort vs capacity), billableUtil (revenue-bearing utilisation), and billability (billable/worked, the work-mix quality), with status flags for over-allocated, under-utilised/below-target, low-billability, and admin-heavy (admin ≥40% of worked). Use to evaluate over/under-utilisation and where the team's hours actually go.",
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
