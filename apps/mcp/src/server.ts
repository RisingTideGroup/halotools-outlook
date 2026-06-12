import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAllTools } from "./tools/index.js";

export function createHaloMcpServer(opts: { suppressTools?: ReadonlySet<string> } = {}): McpServer {
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
        "HaloPSA tools for an MSP. The point of this MCP is to crunch data a human can't quickly assemble from Halo's UI — cross-client trends, time-series rollups, profitability, licence inventory, MTTR by category, etc. Per-ticket edits are usually faster done in Halo's UI; prefer this MCP for analysis.\n\n" +
        "ANALYSIS — the primary use case:\n" +
        "- runSql is the highest-leverage tool. It runs a SELECT against Halo's database via Report Center. Read its description for the 7 rules (one statement, no -- comments, no semicolons, no variables, British spellings, old-fashioned table names like FAULTS=tickets, ACTIONS=notes/time, USERS≠AGENT). When asked an analytical question, the default path is: listReports first (the MSP may already have it saved), then runSql, NOT the composite KPI tools.\n" +
        "- Composite KPI tools (getMrrSnapshot, getMspKpis, getTechnicianUtilizationSnapshot, getRevenuePerTechSnapshot, getMrrPerSeatSnapshot) are convenient one-shot answers for canonical MSP KPIs. Use them when the question is exactly what they compute; otherwise reach for runSql.\n" +
        "- Foundation REST reads (listRecurringInvoices, listTimesheets, listContracts, listOpportunities) are available when REST is more natural than SQL.\n" +
        "- haloApiRaw is the REST escape hatch for endpoints with side effects (writes) or that aren't exposed via SQL.\n\n" +
        "OPERATIONAL — secondary, use sparingly:\n" +
        "- findContact, searchTickets, listOpenTickets, getActivityFeed for anchoring conversation to a person/account.\n" +
        "- appendActionToTicket, createTicket, logNote for logging the agent's own work.\n" +
        "- searchCannedText returns snippets to paste.\n\n" +
        "When the user references a value they can see in Halo's UI but you can't find which column stores it, ask for a screenshot and then SELECT TOP 5 against likely text columns to triangulate. The schema is huge and undocumented externally — runSql's discovery flow (INFORMATION_SCHEMA.TABLES → SELECT TOP 5 from candidates) is how you map UI labels to columns.",
    },
  );

  registerAllTools(server, opts.suppressTools);
  return server;
}
