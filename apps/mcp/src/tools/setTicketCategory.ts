import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { setTicketCategory } from "@iusehalo/halo-api";

const inputSchema = {
  ticket_id: z
    .number()
    .int()
    .positive()
    .describe("The Halo ticket (faultid) to categorise."),
  categoryId: z
    .number()
    .int()
    .positive()
    .describe("The CATEGORYDETAIL CDid of the primary category (from getTicketsToCategorize `categories[].id`). Written as categoryid_1."),
  categoryPath: z
    .string()
    .optional()
    .describe("The category's 'A>B>C' path (the matching `categories[].name`). Recommended — Halo stores both id and path. Written as category_1."),
};

export function registerSetTicketCategory(server: McpServer): void {
  server.registerTool(
    "setTicketCategory",
    {
      title: "Set a HaloPSA ticket's primary category",
      description:
        "Writes a ticket's PRIMARY category (API category_1 / categoryid_1 = DB category2). Pass the CATEGORYDETAIL CDid as categoryId and, ideally, its path as categoryPath — both from getTicketsToCategorize. This is a single-ticket write; to bulk-categorise, review the AI's proposed mapping first, then call this per ticket. Does not create new categories — only assigns existing ones.",
      inputSchema,
    },
    async ({ ticket_id, categoryId, categoryPath }) => {
      const res = await setTicketCategory(ticket_id, categoryId, categoryPath);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ ok: true, ticket_id, categoryId, categoryPath, ticket: res }, null, 2),
          },
        ],
      };
    },
  );
}
