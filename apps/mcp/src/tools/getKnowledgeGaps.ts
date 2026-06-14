import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getKnowledgeGaps } from "@iusehalo/halo-api";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const inputSchema = {
  startdate: z
    .string()
    .regex(DATE_RE, "YYYY-MM-DD")
    .optional()
    .describe("Window start date, YYYY-MM-DD. Defaults to 365 days ago."),
  enddate: z
    .string()
    .regex(DATE_RE, "YYYY-MM-DD")
    .optional()
    .describe("Window end date (inclusive), YYYY-MM-DD. Defaults to today."),
  matchThreshold: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .describe("Min cosine score for a ticket to count as KB-covered. Default 0.8."),
  limit: z
    .number()
    .int()
    .positive()
    .max(200)
    .optional()
    .describe("Max rows for the top-KB and gap-candidate lists. Default 20."),
};

export function registerGetKnowledgeGaps(server: McpServer): void {
  server.registerTool(
    "getKnowledgeGaps",
    {
      title: "Get HaloPSA knowledge-base gaps (ticket↔KB embeddings)",
      description:
        "Knowledge-base coverage and gaps from Halo's ticket↔KB embedding matches (FaultVectorScore where the match is a KB article). For a window (default trailing 365 days) of reactive, non-stub, noise-filtered tickets: KB coverage % (tickets with a matching article at/above matchThreshold), the most-matched KB articles (your workhorse docs), and the highest-effort UNCOVERED tickets ranked by hours logged — the articles worth writing first. Requires KB embeddings enabled in Halo; if absent, coverage reads zero. Pairs with getRecurringProblemClusters (which recurring issues need documenting).",
      inputSchema,
    },
    async ({ startdate, enddate, matchThreshold, limit }) => {
      const snap = await getKnowledgeGaps(startdate, enddate, matchThreshold ?? 0.8, limit ?? 20);
      return { content: [{ type: "text", text: JSON.stringify(snap, null, 2) }] };
    },
  );
}
