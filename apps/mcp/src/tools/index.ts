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
import { registerExploreSchema } from "./exploreSchema.js";
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
import { registerGetTechnicianUtilization } from "./getTechnicianUtilization.js";
import { registerGetPrepayAccountBalance } from "./getPrepayAccountBalance.js";

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
  { name: "getTechnicianUtilization", register: registerGetTechnicianUtilization },
  { name: "getPrepayAccountBalance", register: registerGetPrepayAccountBalance },

  // Database access + REST escape hatch
  { name: "listReports", register: registerListReports },
  { name: "exploreSchema", register: registerExploreSchema },
  { name: "runSql", register: registerRunSql },
  { name: "haloApiRaw", register: registerHaloApiRaw },
];

/**
 * Per-tool display metadata applied as MCP `annotations` after registration.
 *
 *  - `title` is the human-readable label shown in MCP client UIs (Claude's
 *    connector panel reads `annotations.title`, falling back to the tool
 *    name). The colon convention soft-categorises tools even when clients
 *    render them flat — see Hecher's MCP for the same convention.
 *  - `readOnly` drives Claude's "Read-only tools / Write tools" bucketing.
 *    Tools that POST/PATCH/DELETE go into the write bucket; everything else
 *    is read-only. haloApiRaw is intentionally NOT marked read-only — it
 *    can do anything, including writes.
 */
interface ToolMetadata {
  title: string;
  readOnly: boolean;
}

const TOOL_METADATA: Record<string, ToolMetadata> = {
  // Operational
  findContact: { title: "Contact: Find by email", readOnly: true },
  listOpenTickets: { title: "Tickets: List open for client/user", readOnly: true },
  searchTickets: { title: "Tickets: Free-text search", readOnly: true },
  createTicket: { title: "Tickets: Create new", readOnly: false },
  appendActionToTicket: { title: "Tickets: Append action (note/email/time)", readOnly: false },
  logNote: { title: "CRM: Log non-ticket note", readOnly: false },
  searchCannedText: { title: "Snippets: Search canned text", readOnly: true },
  getActivityFeed: { title: "CRM: Get activity feed", readOnly: true },

  // Analytics — foundation reads
  listRecurringInvoices: { title: "Financial: List recurring invoices", readOnly: true },
  listTimesheets: { title: "Time: List timesheet rows", readOnly: true },
  listContracts: { title: "Financial: List client contracts", readOnly: true },
  listOpportunities: { title: "Sales: List opportunities", readOnly: true },

  // Analytics — composite KPIs
  getMrrSnapshot: { title: "Analytics: MRR snapshot", readOnly: true },
  getTechnicianUtilizationSnapshot: { title: "Analytics: Technician utilisation (snapshot)", readOnly: true },
  getRevenuePerTechSnapshot: { title: "Analytics: Revenue per technician", readOnly: true },
  getMrrPerSeatSnapshot: { title: "Analytics: MRR per seat", readOnly: true },
  getMspKpis: { title: "Analytics: MSP KPI dashboard", readOnly: true },

  // Service-delivery KPIs (SQL-backed)
  getServiceDeskHealth: { title: "Service desk: Health overview", readOnly: true },
  getTechnicianScorecard: { title: "Service desk: Technician scorecard", readOnly: true },
  getClientHealthScorecard: { title: "Service desk: Client health scorecard", readOnly: true },
  getTicketBacklog: { title: "Service desk: Backlog & at-risk tickets", readOnly: true },
  getCategoryInsights: { title: "Service desk: Category insights", readOnly: true },
  getTechnicianRiskSignals: { title: "Service desk: Technician risk signals", readOnly: true },

  // Similarity / embeddings
  getRecurringProblemClusters: { title: "Insights: Recurring problem clusters", readOnly: true },
  getDuplicateTickets: { title: "Insights: Duplicate tickets", readOnly: true },
  getClientDejaVu: { title: "Insights: Clients with repeat issues", readOnly: true },
  getSimilarTicketInsights: { title: "Insights: Similar resolved tickets", readOnly: true },
  getKnowledgeGaps: { title: "Insights: Knowledge base gaps", readOnly: true },

  // Categorisation
  getTicketsToCategorize: { title: "Categorisation: Tickets to categorise", readOnly: true },
  setTicketCategory: { title: "Categorisation: Set ticket category", readOnly: false },
  createCategory: { title: "Categorisation: Create new category", readOnly: false },
  triggerTicketAiSummary: { title: "Categorisation: Trigger AI summary on ticket", readOnly: false },
  getNoiseTicketAnalysis: { title: "Categorisation: Noise ticket analysis", readOnly: true },

  // Projects & resourcing
  getProjectPortfolio: { title: "Projects: Portfolio overview", readOnly: true },
  getProjectProfitability: { title: "Projects: Profitability analysis", readOnly: true },
  getResourceForecast: { title: "Projects: Resource forecast", readOnly: true },
  getTechnicianUtilization: { title: "Projects: Technician utilisation (window)", readOnly: true },
  getPrepayAccountBalance: { title: "Projects: Prepay account balance", readOnly: true },

  // Database + escape hatch
  listReports: { title: "Database: List saved reports", readOnly: true },
  exploreSchema: { title: "Database: Explore schema (start here)", readOnly: true },
  runSql: { title: "Database: Run SQL SELECT", readOnly: true },
  haloApiRaw: { title: "API: Raw Halo REST call (read or write)", readOnly: false },
};

/** Internal shape of the SDK's registered-tool record. The MCP SDK exposes
 *  `RegisteredTool.update()` for changing config post-registration, which is
 *  how we apply annotations from a central catalogue without editing 40+
 *  individual tool files. */
interface RegisteredToolLike {
  update: (cfg: { annotations?: Record<string, unknown> }) => void;
}

export function registerAllTools(
  server: McpServer,
  suppress?: ReadonlySet<string>,
): void {
  for (const tool of TOOL_REGISTRY) {
    if (suppress?.has(tool.name)) continue;
    tool.register(server);
  }

  // Walk the SDK's internal registered-tools record and patch annotations
  // from the central catalogue. Annotations:
  //   - title          → human-readable display name (Claude shows this)
  //   - readOnlyHint   → drives the Read-only vs Write/destructive bucketing
  //   - destructiveHint → inverse of readOnlyHint for completeness
  // SDK doesn't expose a typed accessor for the registered-tools map; the cast
  // is the minimum surface-area required and is bounded to the update API.
  const registeredTools = (
    server as unknown as { _registeredTools?: Record<string, RegisteredToolLike> }
  )._registeredTools;
  if (!registeredTools) return;

  for (const [name, meta] of Object.entries(TOOL_METADATA)) {
    if (suppress?.has(name)) continue;
    const rt = registeredTools[name];
    if (!rt || typeof rt.update !== "function") continue;
    rt.update({
      annotations: {
        title: meta.title,
        readOnlyHint: meta.readOnly,
        destructiveHint: !meta.readOnly,
      },
    });
  }
}
