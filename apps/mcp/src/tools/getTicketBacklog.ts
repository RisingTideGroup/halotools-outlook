import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getTicketBacklog } from "@iusehalo/halo-api";

const inputSchema = {
  scope: z
    .enum(["reactive", "all"])
    .optional()
    .describe(
      "Which open tickets to count. 'reactive' (default) excludes projects and opportunities; 'all' counts every open type.",
    ),
  clientId: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Optional Halo client (company) ID to scope the backlog to a single client."),
};

export function registerGetTicketBacklog(server: McpServer): void {
  server.registerTool(
    "getTicketBacklog",
    {
      title: "Get HaloPSA open-ticket backlog & SLA-at-risk",
      description:
        "Point-in-time open-ticket backlog (not windowed — the queue as of now): total open tickets, count already breaching their fix SLA, count due within the next 24h, aging buckets (under 1 day, 1-3, 3-7, 7-30, over 30 days, by ticket-open date), and the 15 oldest open tickets with client, assigned agent, status, priority, age and SLA state. Optionally scoped to one client. Use for the operational 'what needs attention right now' view.",
      inputSchema,
    },
    async ({ scope, clientId }) => {
      const snap = await getTicketBacklog(scope ?? "reactive", clientId);
      return { content: [{ type: "text", text: JSON.stringify(snap, null, 2) }] };
    },
  );
}
