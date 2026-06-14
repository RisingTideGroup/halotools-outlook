import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { registerFindContact } from "./findContact.js";
import { registerListOpenTickets } from "./listOpenTickets.js";
import { registerSearchTickets } from "./searchTickets.js";
import { registerCreateTicket } from "./createTicket.js";
import { registerAppendActionToTicket } from "./appendActionToTicket.js";
import { registerLogNote } from "./logNote.js";
import { registerSearchCannedText } from "./searchCannedText.js";
import { registerGetActivityFeed } from "./getActivityFeed.js";

import { registerHaloApiRaw } from "./haloApiRaw.js";
import { registerRunSql } from "./runSql.js";
import { registerListReports } from "./listReports.js";
import { registerListRecurringInvoices } from "./listRecurringInvoices.js";
import { registerListTimesheets } from "./listTimesheets.js";
import { registerListContracts } from "./listContracts.js";
import { registerListOpportunities } from "./listOpportunities.js";
import { registerGetMrrSnapshot } from "./getMrrSnapshot.js";
import { registerGetTechnicianUtilizationSnapshot } from "./getTechnicianUtilizationSnapshot.js";
import { registerGetRevenuePerTechSnapshot } from "./getRevenuePerTechSnapshot.js";
import { registerGetMrrPerSeatSnapshot } from "./getMrrPerSeatSnapshot.js";
import { registerGetMspKpis } from "./getMspKpis.js";
import { registerGetServiceDeskHealth } from "./getServiceDeskHealth.js";
import { registerGetTechnicianScorecard } from "./getTechnicianScorecard.js";
import { registerGetClientHealthScorecard } from "./getClientHealthScorecard.js";
import { registerGetTicketBacklog } from "./getTicketBacklog.js";
import { registerGetCategoryInsights } from "./getCategoryInsights.js";
import { registerGetTechnicianRiskSignals } from "./getTechnicianRiskSignals.js";
import { registerGetRecurringProblemClusters } from "./getRecurringProblemClusters.js";
import { registerGetDuplicateTickets } from "./getDuplicateTickets.js";
import { registerGetClientDejaVu } from "./getClientDejaVu.js";
import { registerGetSimilarTicketInsights } from "./getSimilarTicketInsights.js";
import { registerGetKnowledgeGaps } from "./getKnowledgeGaps.js";
import { registerGetTicketsToCategorize } from "./getTicketsToCategorize.js";
import { registerSetTicketCategory } from "./setTicketCategory.js";
import { registerCreateCategory } from "./createCategory.js";
import { registerTriggerTicketAiSummary } from "./triggerTicketAiSummary.js";
import { registerGetNoiseTicketAnalysis } from "./getNoiseTicketAnalysis.js";
import { registerGetProjectPortfolio } from "./getProjectPortfolio.js";
import { registerGetProjectProfitability } from "./getProjectProfitability.js";
import { registerGetResourceForecast } from "./getResourceForecast.js";

/** Map of tool name → register function so suppression can decide per-tool
 *  whether to wire it up. The order here defines the order the agent sees
 *  in tools/list — kept the same as the prior registerAllTools calls. */
const TOOL_REGISTRY: Array<{ name: string; register: (s: McpServer) => void }> = [
  // Operational
  { name: "findContact", register: registerFindContact },
  { name: "listOpenTickets", register: registerListOpenTickets },
  { name: "searchTickets", register: registerSearchTickets },
  { name: "createTicket", register: registerCreateTicket },
  { name: "appendActionToTicket", register: registerAppendActionToTicket },
  { name: "logNote", register: registerLogNote },
  { name: "searchCannedText", register: registerSearchCannedText },
  { name: "getActivityFeed", register: registerGetActivityFeed },

  // Analytics — foundation reads
  { name: "listRecurringInvoices", register: registerListRecurringInvoices },
  { name: "listTimesheets", register: registerListTimesheets },
  { name: "listContracts", register: registerListContracts },
  { name: "listOpportunities", register: registerListOpportunities },

  // Analytics — composite KPIs
  { name: "getMrrSnapshot", register: registerGetMrrSnapshot },
  { name: "getTechnicianUtilizationSnapshot", register: registerGetTechnicianUtilizationSnapshot },
  { name: "getRevenuePerTechSnapshot", register: registerGetRevenuePerTechSnapshot },
  { name: "getMrrPerSeatSnapshot", register: registerGetMrrPerSeatSnapshot },
  { name: "getMspKpis", register: registerGetMspKpis },

  // Analytics — service-delivery KPIs (SQL-backed)
  { name: "getServiceDeskHealth", register: registerGetServiceDeskHealth },
  { name: "getTechnicianScorecard", register: registerGetTechnicianScorecard },
  { name: "getClientHealthScorecard", register: registerGetClientHealthScorecard },
  { name: "getTicketBacklog", register: registerGetTicketBacklog },
  { name: "getCategoryInsights", register: registerGetCategoryInsights },
  { name: "getTechnicianRiskSignals", register: registerGetTechnicianRiskSignals },

  // Analytics — similarity/embeddings (ticket vector graph)
  { name: "getRecurringProblemClusters", register: registerGetRecurringProblemClusters },
  { name: "getDuplicateTickets", register: registerGetDuplicateTickets },
  { name: "getClientDejaVu", register: registerGetClientDejaVu },
  { name: "getSimilarTicketInsights", register: registerGetSimilarTicketInsights },
  { name: "getKnowledgeGaps", register: registerGetKnowledgeGaps },

  // Ticket categorisation (AI-in-the-loop: fetch feed + apply)
  { name: "getTicketsToCategorize", register: registerGetTicketsToCategorize },
  { name: "setTicketCategory", register: registerSetTicketCategory },
  { name: "createCategory", register: registerCreateCategory },
  { name: "triggerTicketAiSummary", register: registerTriggerTicketAiSummary },
  { name: "getNoiseTicketAnalysis", register: registerGetNoiseTicketAnalysis },

  // Analytics — project management / profitability / resourcing
  { name: "getProjectPortfolio", register: registerGetProjectPortfolio },
  { name: "getProjectProfitability", register: registerGetProjectProfitability },
  { name: "getResourceForecast", register: registerGetResourceForecast },

  // Database access + REST escape hatch
  { name: "listReports", register: registerListReports },
  { name: "runSql", register: registerRunSql },
  { name: "haloApiRaw", register: registerHaloApiRaw },
];

export function registerAllTools(
  server: McpServer,
  suppress?: ReadonlySet<string>,
): void {
  for (const tool of TOOL_REGISTRY) {
    if (suppress?.has(tool.name)) continue;
    tool.register(server);
  }
}
