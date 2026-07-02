import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { appendAction } from "@iusehalo/halo-api";

const inputSchema = {
  ticket_id: z
    .number()
    .int()
    .positive()
    .describe("The Halo ticket ID to append an action to."),
  note: z
    .string()
    .min(1)
    .describe("Body of the action — what was done, observed, or communicated."),
  outcome: z
    .string()
    .optional()
    .describe(
      "Halo action outcome label. Default 'Note'. Other common values: 'Email Received', 'Phone Call', 'Internal Note'. Outcomes are tenant-configurable so unusual labels may 4xx.",
    ),
  hiddenfromuser: z
    .boolean()
    .optional()
    .describe("If true, marks this action as internal-only (not visible to the requester)."),
  timetaken: z
    .number()
    .nonnegative()
    .optional()
    .describe("Time spent in decimal hours (e.g. 0.25 = 15 minutes)."),
};

export function registerAppendActionToTicket(server: McpServer): void {
  server.registerTool(
    "appendActionToTicket",
    {
      title: "Append an action (note) to a HaloPSA ticket",
      description:
        "Append an action to an existing HaloPSA ticket — e.g. log a phone call, add an internal note, or record what was done. Use this rather than createTicket when continuing work on an existing issue. Default outcome is 'Note'.",
      inputSchema,
    },
    async ({ ticket_id, note, outcome, hiddenfromuser, timetaken }) => {
      const action = await appendAction({
        ticket_id,
        note,
        outcome: outcome ?? "Note",
        hiddenfromuser,
        timetaken,
      });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                id: action.id,
                ticket_id: action.ticket_id,
                outcome: action.outcome,
                actionnumber: action.actionnumber,
                datetime: action.datetime,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );
}
