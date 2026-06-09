import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getTechnicianUtilizationSnapshot } from "@iusehalo/halo-api";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const inputSchema = {
  startdate: z
    .string()
    .regex(DATE_RE, "YYYY-MM-DD")
    .optional()
    .describe("Window start date, YYYY-MM-DD. Defaults to 30 days ago."),
  enddate: z
    .string()
    .regex(DATE_RE, "YYYY-MM-DD")
    .optional()
    .describe("Window end date, YYYY-MM-DD. Defaults to today."),
};

export function registerGetTechnicianUtilizationSnapshot(server: McpServer): void {
  server.registerTool(
    "getTechnicianUtilizationSnapshot",
    {
      title: "Get HaloPSA technician utilization snapshot",
      description:
        "Return chargeable-hours / target-hours utilization for all technicians in the window, plus per-agent breakdown sorted by rate descending. Default window is the trailing 30 days. Each per-agent row includes the agent name (joined from /Agent), total chargeable + target hours, and the agent-level rate.",
      inputSchema,
    },
    async ({ startdate, enddate }) => {
      const snap = await getTechnicianUtilizationSnapshot(startdate, enddate);
      return {
        content: [{ type: "text", text: JSON.stringify(snap, null, 2) }],
      };
    },
  );
}
