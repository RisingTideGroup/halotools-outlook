import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getSimilarTicketInsights } from "@iusehalo/halo-api";

const inputSchema = {
  faultid: z
    .number()
    .int()
    .positive()
    .describe("The ticket id (FAULTS.faultid) to find resolved neighbours for."),
  minScore: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .describe("Cosine similarity cutoff (0-1). Default 0.8. Tune it: if too few neighbours come back, lower it; if matches look loose, raise it. Evaluate the returned scores and re-call to adjust."),
};

export function registerGetSimilarTicketInsights(server: McpServer): void {
  server.registerTool(
    "getSimilarTicketInsights",
    {
      title: "Get HaloPSA similar-ticket insights for one ticket (ticket embeddings)",
      description:
        "For one ticket, surfaces its nearest RESOLVED neighbours so you can route to whoever solved the same thing and predict effort / category. Finds neighbours (either direction) above the minScore similarity cutoff (default 0.8 — adjust per task by reading the returned scores) that are resolved, returning the top 10 by score with summary, score, resolver, resolution hours, category, and CSAT — plus a prediction block: median predicted resolution hours, the most common category, and the resolvers who handled the most neighbours. Uses Halo's ticket embeddings (FaultVectorScore, garbage NULL-method rows excluded; backend-agnostic). Per-ticket lookup, so NOT noise-filtered.",
      inputSchema,
    },
    async ({ faultid, minScore }) => {
      const snap = await getSimilarTicketInsights(faultid, minScore ?? 0.8);
      return { content: [{ type: "text", text: JSON.stringify(snap, null, 2) }] };
    },
  );
}
