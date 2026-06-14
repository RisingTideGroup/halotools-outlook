import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getRecurringProblemClusters } from "@iusehalo/halo-api";

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
  minScore: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .describe("Minimum cosine similarity for an edge. Default 0.85 ('similar')."),
  limit: z
    .number()
    .int()
    .positive()
    .max(100)
    .optional()
    .describe("Max clusters to return. Default 25."),
};

export function registerGetRecurringProblemClusters(server: McpServer): void {
  server.registerTool(
    "getRecurringProblemClusters",
    {
      title: "Get HaloPSA recurring-problem clusters (ticket embeddings)",
      description:
        "Clusters semantically-similar REACTIVE tickets to surface recurring problems worth a KB article, automation, or problem record, with a handling-consistency signal. Uses Halo's ticket embeddings (FaultVectorScore, method 1 only), noise-filtered on both endpoints (auto-replies / OTP / test / newsletter subjects are removed). Per cluster: anchor ticket, a representative summary, distinct ticket count, distinct clients, total hours logged, average resolution hours, distinct resolver count (many resolvers for one recurring problem = knowledge not captured), and average similarity score. Ranked by tickets × total hours. IMPORTANT: clustering is APPROXIMATE — tickets are grouped by the lowest faultid among each similar pair (Report Center can't do recursive transitive closure), so a long similarity chain can fragment across anchors. Defaults to the trailing 365 days.",
      inputSchema,
    },
    async ({ startdate, enddate, minScore, limit }) => {
      const snap = await getRecurringProblemClusters(
        startdate,
        enddate,
        minScore ?? 0.85,
        limit ?? 25,
      );
      return { content: [{ type: "text", text: JSON.stringify(snap, null, 2) }] };
    },
  );
}
