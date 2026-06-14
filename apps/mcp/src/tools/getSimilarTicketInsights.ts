import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getSimilarTicketInsights } from "@iusehalo/halo-api";

const inputSchema = {
  faultid: z
    .number()
    .int()
    .positive()
    .describe("The ticket id (FAULTS.faultid) to find resolved neighbours for."),
};

export function registerGetSimilarTicketInsights(server: McpServer): void {
  server.registerTool(
    "getSimilarTicketInsights",
    {
      title: "Get HaloPSA similar-ticket insights for one ticket (ticket embeddings)",
      description:
        "For one ticket, surfaces its nearest RESOLVED neighbours so you can route to whoever solved the same thing and predict effort / category. Finds neighbours (either direction) at similarity >= 0.8 that are resolved, returning the top 10 by score with summary, score, resolver, resolution hours, category, and CSAT — plus a prediction block: median predicted resolution hours, the most common category, and the resolvers who handled the most neighbours. Uses Halo's ticket embeddings (FaultVectorScore, method 1 only). This is a per-ticket lookup, so it is NOT noise-filtered.",
      inputSchema,
    },
    async ({ faultid }) => {
      const snap = await getSimilarTicketInsights(faultid);
      return { content: [{ type: "text", text: JSON.stringify(snap, null, 2) }] };
    },
  );
}
