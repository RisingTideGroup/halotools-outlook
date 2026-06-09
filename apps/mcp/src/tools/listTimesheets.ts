import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { listTimesheets } from "@iusehalo/halo-api";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const inputSchema = {
  startdate: z
    .string()
    .regex(DATE_RE, "YYYY-MM-DD")
    .describe("Window start date, ISO YYYY-MM-DD."),
  enddate: z
    .string()
    .regex(DATE_RE, "YYYY-MM-DD")
    .describe("Window end date, ISO YYYY-MM-DD. Inclusive."),
};

export function registerListTimesheets(server: McpServer): void {
  server.registerTool(
    "listTimesheets",
    {
      title: "List HaloPSA timesheet rows for a date window",
      description:
        "Return raw timesheet rows from HaloPSA for the given window. Each row is one agent × one day with chargeable_hours, target_hours, and actual_hours. Source for technician utilization. Halo's /Timesheet endpoint returns a flat array, not a paginated wrapper.",
      inputSchema,
    },
    async ({ startdate, enddate }) => {
      const rows = await listTimesheets(startdate, enddate);
      return {
        content: [{ type: "text", text: JSON.stringify(rows, null, 2) }],
      };
    },
  );
}
