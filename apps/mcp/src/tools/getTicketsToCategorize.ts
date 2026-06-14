import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getTicketsToCategorize } from "@iusehalo/halo-api";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const inputSchema = {
  startdate: z
    .string()
    .regex(DATE_RE, "YYYY-MM-DD")
    .optional()
    .describe("Only tickets opened on/after this date (dateoccured). Omit for no lower bound."),
  enddate: z
    .string()
    .regex(DATE_RE, "YYYY-MM-DD")
    .optional()
    .describe("Only tickets opened on/before this date (inclusive). Omit for no upper bound."),
  onlyUncategorised: z
    .boolean()
    .optional()
    .describe("Default true — only tickets with no primary category. Set false (and omit `category`) to return ALL tickets."),
  category: z
    .string()
    .optional()
    .describe("Restrict to a specific existing primary category to audit/re-categorise: a CATEGORYDETAIL CDid (e.g. '177') or its path (e.g. 'Halo>Support'). Overrides onlyUncategorised."),
  scope: z
    .enum(["reactive", "all"])
    .optional()
    .describe("'reactive' (default) excludes projects/opportunities; 'all' includes every type."),
  limit: z
    .number()
    .int()
    .positive()
    .max(1000)
    .optional()
    .describe("Max tickets to return. Default 100."),
};

export function registerGetTicketsToCategorize(server: McpServer): void {
  server.registerTool(
    "getTicketsToCategorize",
    {
      title: "Get HaloPSA tickets to categorise (AI categoriser feed)",
      description:
        "Returns the controlled primary-category taxonomy (CATEGORYDETAIL CDType=2) plus a scoped set of tickets with their short AI summary, for an AI to categorise. Scope by `onlyUncategorised` (default true), a specific `category` (CDid or 'A>B>C' path) to audit/re-categorise, or onlyUncategorised=false for all; optionally a dateoccured range and reactive/all scope. Closed-on-creation stubs are excluded. Each ticket includes its AI summary (the cheap signal to match on), Halo's own (fragmented) suggested category for reference, and a `summaryMissing` flag for tickets needing a fresh AI insight first. Workflow: call this, match each summary to a category in `categories` (or propose a new one), then apply with setTicketCategory.",
      inputSchema,
    },
    async ({ startdate, enddate, onlyUncategorised, category, scope, limit }) => {
      const res = await getTicketsToCategorize({ startdate, enddate, onlyUncategorised, category, scope, limit });
      return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
    },
  );
}
