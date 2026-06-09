import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { listReports } from "@iusehalo/halo-api";

export function registerListReports(server: McpServer): void {
  server.registerTool(
    "listReports",
    {
      title: "List saved HaloPSA reports",
      description:
        "List the saved reports in HaloPSA's Report Center. Use this BEFORE writing a new SQL query — if an MSP already has a report that answers the question (or answers most of it), it's faster and more accurate to reuse than to redo from scratch. The MSP may have years of accumulated analysis in here.",
      inputSchema: {},
    },
    async () => {
      const reports = await listReports();
      return {
        content: [{ type: "text", text: JSON.stringify(reports, null, 2) }],
      };
    },
  );
}
