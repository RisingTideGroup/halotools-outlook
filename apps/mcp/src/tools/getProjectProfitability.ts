import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getProjectProfitability } from "@iusehalo/halo-api";

const inputSchema = {
  limit: z.number().int().positive().max(500).optional().describe("Max projects to return, sorted by hours. Default 50."),
  minHours: z.number().min(0).optional().describe("Only projects with more than this many delivered hours. Default 1."),
};

export function registerGetProjectProfitability(server: McpServer): void {
  server.registerTool(
    "getProjectProfitability",
    {
      title: "Get HaloPSA project profitability (auto-detected billing model)",
      description:
        "Per-project profitability with the billing model auto-detected from the data: retainer (prepay block top-ups on the project's contract) → time-and-materials (ActionChargeAmount) → fixed-fee/internal. Returns revenue (from the matching source), delivered hours, pay-type-adjusted labour cost with a coverage %, effective rate (£/hr), gross margin (only reliable when costCoveragePct≥80 — cost data is partial in this tenant), and an over-serviced flag (hours ≫ estimate). Caveats: retainer revenue is contract-level (may span multiple projects); effective rate is the robust profitability proxy when cost coverage is low.",
      inputSchema,
    },
    async ({ limit, minHours }) => {
      const res = await getProjectProfitability(limit ?? 50, minHours ?? 1);
      return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
    },
  );
}
