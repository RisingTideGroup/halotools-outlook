import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAllTools } from "./tools/index.js";

export function createHaloMcpServer(): McpServer {
  const server = new McpServer(
    {
      name: "halo-mcp-server",
      version: "0.1.0",
    },
    {
      capabilities: {
        tools: {},
      },
      instructions:
        "HaloPSA tools for an MSP, with two distinct layers.\n\n" +
        "OPERATIONAL (per-contact / per-ticket work):\n" +
        "- findContact when an email is mentioned to anchor context to a Halo client/user.\n" +
        "- searchTickets for free-text lookup, listOpenTickets for a known client/user.\n" +
        "- appendActionToTicket to log work on an existing ticket; createTicket to open a new one.\n" +
        "- logNote for non-ticket CRM activity; searchCannedText returns saved snippets.\n" +
        "- getActivityFeed gives a merged timeline of an account.\n\n" +
        "ANALYTICS (business-level KPIs and exploration):\n" +
        "- For a single number, prefer the composite tools: getMrrSnapshot, getTechnicianUtilizationSnapshot, getRevenuePerTechSnapshot, getMrrPerSeatSnapshot.\n" +
        "- getMspKpis returns the whole dashboard in one call — use when the user asks broad health questions.\n" +
        "- Foundation reads (listRecurringInvoices, listTimesheets, listContracts, listOpportunities) when the composite isn't quite what's wanted.\n" +
        "- haloApiRaw is the escape hatch: any endpoint, any method. Use it only when no typed tool covers the need, and tell the user you're exploring.",
    },
  );

  registerAllTools(server);
  return server;
}
