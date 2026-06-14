import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getProjectPortfolio } from "@iusehalo/halo-api";

const inputSchema = {
  includeCompleted: z.boolean().optional().describe("Include closed/completed projects (status 8,9). Default false (active only)."),
  limit: z.number().int().positive().max(500).optional().describe("Max projects to return. Default 100."),
};

export function registerGetProjectPortfolio(server: McpServer): void {
  server.registerTool(
    "getProjectPortfolio",
    {
      title: "Get HaloPSA project portfolio health",
      description:
        "Portfolio board of main projects (RTIsProject types): client, status, % complete (child tasks closed/total), rolled-up delivered hours, estimate hours, and age (days since project start). Active projects by default. Note: project deadline/target dates are not populated in this tenant, so there's no overdue/days-to-deadline — use % complete vs hours-vs-estimate as the at-risk signal.",
      inputSchema,
    },
    async ({ includeCompleted, limit }) => {
      const res = await getProjectPortfolio(includeCompleted ?? false, limit ?? 100);
      return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
    },
  );
}
