import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createCategory } from "@iusehalo/halo-api";

const inputSchema = {
  categoryName: z
    .string()
    .min(1)
    .describe("The category path, e.g. 'License Request' or 'Noise>Auto-Reply'. Use '>' to nest."),
  typeId: z
    .number()
    .int()
    .optional()
    .describe("Category kind: 1 = primary ticket category (default; what tickets are tagged with), 2 = closure category, 4 = request-type category."),
  categoryGroupId: z
    .number()
    .int()
    .optional()
    .describe("Optional category group id to file it under (see /Category category_group_id)."),
};

export function registerCreateCategory(server: McpServer): void {
  server.registerTool(
    "createCategory",
    {
      title: "Create a HaloPSA category",
      description:
        "Create a new category via POST /Category. Defaults to a PRIMARY ticket category (typeId 1) — the kind tickets are tagged with and that setTicketCategory writes. Use to add genuinely missing categories surfaced by the categoriser (e.g. 'License Request', or a 'Noise>Auto-Reply' bucket). Returns the new category's id (CDid) for immediate use with setTicketCategory. Don't create near-duplicates of existing categories — check the controlled list first.",
      inputSchema,
    },
    async ({ categoryName, typeId, categoryGroupId }) => {
      const res = await createCategory(categoryName, typeId ?? 1, categoryGroupId);
      return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
    },
  );
}
