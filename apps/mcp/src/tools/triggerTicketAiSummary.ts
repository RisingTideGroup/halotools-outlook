import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { triggerTicketAiSummary } from "@iusehalo/halo-api";

const inputSchema = {
  ticket_id: z
    .number()
    .int()
    .positive()
    .describe("The Halo ticket (faultid) to re-index."),
};

export function registerTriggerTicketAiSummary(server: McpServer): void {
  server.registerTool(
    "triggerTicketAiSummary",
    {
      title: "Trigger a fresh AI summary/insight on a ticket",
      description:
        "Re-runs Halo's AI insight on a ticket (POST /Tickets with _re_index=true), regenerating faigeneratedsummary / suggested category etc. Best on a worked or closed ticket so the summary reflects what actually happened. IMPORTANT: the response confirms the trigger, but the new summary is written ASYNCHRONOUSLY — wait a few seconds and re-pull the ticket (e.g. getTicketsToCategorize) to read it. Use this for the tickets getTicketsToCategorize flags with summaryMissing=true before categorising them.",
      inputSchema,
    },
    async ({ ticket_id }) => {
      const res = await triggerTicketAiSummary(ticket_id);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              { ok: true, ticket_id, note: "Re-index triggered; summary populates asynchronously — re-pull the ticket shortly.", response: res },
              null,
              2,
            ),
          },
        ],
      };
    },
  );
}
