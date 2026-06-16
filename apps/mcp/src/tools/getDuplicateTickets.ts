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
  searchMethod: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe("Optional vector backend filter: 0=Halo internal store, 1=Azure AI Search, 2=OpenSearch. Omit (default) to use all real backends (only NULL/junk rows excluded); set to isolate one backend's embeddings."),
};

export function registerGetDuplicateTickets(server: McpServer): void {
  server.registerTool(
    "getDuplicateTickets",
    {
      title: "Get HaloPSA near-duplicate open tickets (ticket embeddings)",
      description:
        "OPEN tickets that are near-duplicates of another ticket — merge candidates and double-logging. For each open ticket it returns its single highest-scoring neighbour (in either direction) at or above minScore (default 0.9 = near-duplicate), with the matched ticket's id, summary, state (open or closed), and score, plus the open ticket's client and age in days. Uses Halo's ticket embeddings (FaultVectorScore, backend-agnostic — garbage NULL-method rows excluded), noise-filtered (auto-replies / OTP / test / newsletter subjects removed). minScore is tunable — adjust if matches look too loose/tight. Ordered by score desc.",
      inputSchema,
    },
    async ({ scope, minScore, limit, searchMethod }) => {
      const snap = await getDuplicateTickets(scope ?? "reactive", minScore ?? 0.9, limit ?? 50, searchMethod);
      return { content: [{ type: "text", text: JSON.stringify(snap, null, 2) }] };
    },
  );
}
