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

  // Generic escape hatch — for unwrapped endpoints / exploration.
  // Registered last so a curious agent reads the typed tools first.
  registerHaloApiRaw(server);
}
