import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getDuplicateTickets } from "@iusehalo/halo-api";

const inputSchema = {
  scope: z
    .enum(["reactive", "all"])
    .optional()
    .describe("'reactive' (default) excludes projects and opportunities; 'all' counts every type."),
  minScore: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .describe("Minimum cosine similarity to count as a near-duplicate. Default 0.9."),
  limit: z
    .number()
    .int()
    .positive()
    .max(200)
    .optional()
    .describe("Max open tickets to return. Default 50."),
};

export function registerGetDuplicateTickets(server: McpServer): void {
  server.registerTool(
    "getDuplicateTickets",
    {
      title: "Get HaloPSA near-duplicate open tickets (ticket embeddings)",
      description:
        "OPEN tickets that are near-duplicates of another ticket — merge candidates and double-logging. For each open ticket it returns its single highest-scoring neighbour (in either direction) at or above minScore (default 0.9 = near-duplicate), with the matched ticket's id, summary, state (open or closed), and score, plus the open ticket's client and age in days. Uses Halo's ticket embeddings (FaultVectorScore, method 1 only), noise-filtered (auto-replies / OTP / test / newsletter subjects removed). Ordered by score desc.",
      inputSchema,
    },
    async ({ scope, minScore, limit }) => {
      const snap = await getDuplicateTickets(scope ?? "reactive", minScore ?? 0.9, limit ?? 50);
      return { content: [{ type: "text", text: JSON.stringify(snap, null, 2) }] };
    },
  );
}
