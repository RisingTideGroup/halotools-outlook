import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getClientDejaVu } from "@iusehalo/halo-api";

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
    .describe("Minimum cosine similarity for a same-client pair. Default 0.85."),
  limit: z
    .number()
    .int()
    .positive()
    .max(200)
    .optional()
    .describe("Max clients to return. Default 50."),
};

export function registerGetClientDejaVu(server: McpServer): void {
  server.registerTool(
    "getClientDejaVu",
    {
      title: "Get HaloPSA client deja vu — clients re-logging the same issue (ticket embeddings)",
      description:
        "Clients who repeatedly log the SAME issue — chronic-pain / root-cause / training targets. Counts high-similarity REACTIVE ticket pairs where BOTH tickets belong to the same client, within the window. Per client: number of recurring pairs, distinct tickets involved, and total hours logged across those tickets. Ranked by recurring pair count desc. Same-client recurrence is the signal here — cross-client similarity (one problem hitting many customers) is what getRecurringProblemClusters surfaces. Uses Halo's ticket embeddings (FaultVectorScore, backend-agnostic — garbage NULL-method rows excluded), noise-filtered (auto-replies / OTP / test / newsletter subjects removed). Defaults to the trailing 365 days.",
      inputSchema,
    },
    async ({ startdate, enddate, minScore, limit }) => {
      const snap = await getClientDejaVu(startdate, enddate, minScore ?? 0.85, limit ?? 50);
      return { content: [{ type: "text", text: JSON.stringify(snap, null, 2) }] };
    },
  );
}
