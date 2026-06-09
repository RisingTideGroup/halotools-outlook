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

export function registerAllTools(server: McpServer): void {
  // Core read + write
  registerFindContact(server);
  registerListOpenTickets(server);
  registerSearchTickets(server);
  registerCreateTicket(server);
  registerAppendActionToTicket(server);
  registerLogNote(server);
  registerSearchCannedText(server);
  registerGetActivityFeed(server);

  // Analytics — foundation reads
  registerListRecurringInvoices(server);
  registerListTimesheets(server);
  registerListContracts(server);
  registerListOpportunities(server);

  // Analytics — composite KPIs
  registerGetMrrSnapshot(server);
  registerGetTechnicianUtilizationSnapshot(server);
  registerGetRevenuePerTechSnapshot(server);
  registerGetMrrPerSeatSnapshot(server);
  registerGetMspKpis(server);

  // Direct database access via Halo Report Center — the highest-leverage tool
  // for cross-data analysis. Registered after the composites so they're tried
  // first for canonical KPI questions, but before haloApiRaw since SQL is the
  // primary escape hatch for "we don't have a tool for this question".
  registerListReports(server);
  registerRunSql(server);

  // Generic REST escape hatch — for unwrapped endpoints / exploration where
  // SQL isn't the right tool (e.g. firing a write that has side effects we
  // want Halo's business logic to handle).
  registerHaloApiRaw(server);
}
