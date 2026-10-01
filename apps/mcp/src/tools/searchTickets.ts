import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { searchTickets } from "@iusehalo/halo-api";

const inputSchema = {
  query: z
    .string()
    .min(1)
    .describe(
      "Free-text query. Halo searches across ticket summary, details, and reference fields.",
    ),
  limit: z
    .number()
    .int()
    .positive()
    .max(100)
    .optional()
    .describe("Maximum number of tickets to return. Default 25."),
  open_only: z
    .boolean()
    .optional()
    .describe("Only return open tickets. Default false (open and closed)."),
};

export function registerSearchTickets(server: McpServer): void {
  server.registerTool(
    "searchTickets",
    {
      title: "Search HaloPSA tickets",
      description:
        "Free-text search across HaloPSA tickets. Use this to find tickets by keyword, error message, customer name, or any text that might appear in the summary or details. Includes opportunities and project tickets. Returns matching tickets with their id, summary, status, priority, client, and date opened.",
      inputSchema,
    },
    async ({ query, limit, open_only }) => {
      // Default matches the tool's historical behaviour (closed tickets included);
      // the shared searchTickets() defaults to open-only for the Outlook pickers.
      const tickets = await searchTickets(query, limit ?? 25, { openOnly: open_only ?? false });
      const rows = tickets.map((t) => ({
        id: t.id,
        summary: t.summary,
        status: t.statusname,
        priority: t.priorityname,
        client: t.client_name,
        user: t.user_name,
        dateopened: t.dateopened,
      }));
      return {
        content: [{ type: "text", text: JSON.stringify(rows, null, 2) }],
      };
    },
  );
}
