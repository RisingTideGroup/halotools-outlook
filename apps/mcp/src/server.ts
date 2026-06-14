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
        "HaloPSA tools for an MSP. The point of this MCP is to crunch data a human can't quickly assemble from Halo's UI — cross-client trends, time-series rollups, profitability, MTTR/SLA by category, ticket similarity, categorisation. Per-ticket edits are usually faster in Halo's UI; prefer this MCP for analysis and bulk operations.\n\n" +
        "TOOL FAMILIES:\n" +
        "- Ad-hoc analysis: runSql (highest-leverage — SELECT via Report Center; read its 7 rules) and listReports (check for an existing saved report FIRST). haloApiRaw is the REST escape hatch for writes / non-SQL endpoints.\n" +
        "- Financial KPIs (one-shot): getMspKpis, getMrrSnapshot, getRevenuePerTechSnapshot, getMrrPerSeatSnapshot, getTechnicianUtilizationSnapshot. Foundation REST reads: listRecurringInvoices, listTimesheets, listContracts, listOpportunities.\n" +
        "- Service-delivery KPIs: getServiceDeskHealth (overall: volume/SLA/MTTR/FTF/CSAT), getTicketBacklog (open aging + at-risk), getTechnicianScorecard + getTechnicianRiskSignals (per-tech performance & coaching-vs-disengagement), getClientHealthScorecard (at-risk accounts), getCategoryInsights (categorisation health + recurring problems).\n" +
        "- Similarity / embeddings (Halo ticket vector graph): getRecurringProblemClusters (recurring issues → KB/automation targets), getDuplicateTickets (merge candidates), getClientDejaVu (clients with repeat issues), getSimilarTicketInsights (a ticket's resolved neighbours → routing/effort), getKnowledgeGaps (KB coverage; needs KB embeddings enabled).\n" +
        "- Categorisation & noise: getTicketsToCategorize, setTicketCategory, createCategory, triggerTicketAiSummary, getNoiseTicketAnalysis.\n" +
        "- Projects & resourcing: getProjectPortfolio (% complete / hours vs estimate / age), getProjectProfitability (auto-detected billing model: retainer prepay > T&M charge > fixed; revenue, cost, effectiveRate, margin gated by marginReliable), getResourceForecast (forward booked appointment hours vs flat weekly capacity), getTechnicianUtilization (past-window booked vs worked vs billable vs leave-adjusted capacity).\n" +
        "- Operational (use sparingly): findContact, searchTickets, listOpenTickets, getActivityFeed; appendActionToTicket, createTicket, logNote; searchCannedText.\n\n" +
        "WORKFLOWS (call the tools in this order):\n" +
        "- Categorise tickets: getTicketsToCategorize (scope: onlyUncategorised / a specific category / time range) → for each ticket, match its AI summary to one of the returned `categories` (or decide none fits) → createCategory only for genuine gaps (don't make near-duplicates) → setTicketCategory per ticket. For tickets flagged summaryMissing, triggerTicketAiSummary first, wait a few seconds, then re-pull. Confidence-gate: low confidence → leave for human review.\n" +
        "- Reduce ticket noise: getNoiseTicketAnalysis → act on its per-type recommendations (mostly auto-reply suppression on the mailbox) to stop noise at intake rather than categorising it forever.\n" +
        "- Service-desk review: getServiceDeskHealth + getTicketBacklog + getCategoryInsights (+ getRecurringProblemClusters for what to fix/document).\n" +
        "- KB gaps: getKnowledgeGaps for coverage; getRecurringProblemClusters for which recurring issues to write up first.\n\n" +
        "KEY DATA GOTCHAS (the composite tools already handle these; mirror them in your own runSql):\n" +
        "- Ticket open time is dateoccured, NOT datecreated (datecreated is a corrupt row-stamp). Close time is datecleared. Exclude deleted/merged via fdeleted=fmergedintofaultid (COALESCE both, NULLable).\n" +
        "- Exclude closed-on-creation STUBS (datecleared==dateoccured, e.g. Quick Time) from service metrics; 'reactive' scope = REQUESTTYPE RTIsProject=0 AND RTIsOpportunity=0.\n" +
        "- Embeddings (FaultVectorScore): use fvsSearchMethod=1; FVSuse=0 = ticket↔ticket, FVSuse=1 = ticket↔KB (FVSSimiliarfaultid is then a KBENTRY.id).\n" +
        "- Categories off-by-one: API category_1/categoryid_1 == DB category2 == CATEGORYDETAIL CDType 2 (== /Category type_id 1) = the PRIMARY category.\n" +
        "- CSAT = faisatisfactionlevel (AI, nvarchar — TRY_CONVERT); native SatisfactionLevel is sparse. SLA state 'I'=met/'O'=breached/''=none.\n" +
        "- Time/billability: worked hours = ACTIONS.timetaken; billable = timetaken where the action carries a real charge code (ActionCode + 1 > 0; non-billable is stored as ActionCode = -1). Don't use ActIsBillable (over-counts -1 actions) or ActionChargeHours/ActionNonChargeHours (unreliable/empty in many tenants). This equals the charge_hours a timesheet day/range summary reports. Action work date = COALESCE(Whe_, ActionArrivalDate, ActionDateCreated) since ActionDateCreated can be backdated.\n" +
        "- Agent cost = ucostPrice, or the UnameCostTracking rate effective on the work date when populated (history tracking). Both are HOURLY in standard Halo; if a tenant stores annual salaries there, labour cost reads inflated — prefer effectiveRate. Avoid CF* columns (per-tenant custom fields).\n" +
        "- Resourcing sources: APPOINTMENT = calendar (APStartDate, exclude APdeleted/APAllDayEvent). Booked CLIENT/working time = ticket-linked only (APFaultid>0); unlinked appointments are internal meetings. worked (logged ACTIONS time) often exceeds ticket-linked booked. HOLIDAYS = leave (Hduration, HTechnicianID); TimesheetEvent = clock/shift hours (often sparse).\n" +
        "- Projects are refilled PREPAY BLOCKS, not fixed-fee. Budget = PREPAYHISTORY.PPHours purchased (top-ups) on the project's contract (FAULTS.fcontractid → CONTRACTHEADER.CHid); the estimate field is a stale placeholder. Prepay consumed = ACTIONS.ActionPrePayHours where AContractId = the contract. Over-servicing = delivered hours > purchased; the real leak = billable hours delivered but NOT deducted from the block (billable timetaken − ActionPrePayHours).\n" +
        "- Money: amounts are stored in the HOME currency = the CURRENCY row with Crate=1.0 (Ccode). Don't assume a symbol; read it.\n\n" +
        "When the user references a UI value you can't map to a column, ask for a screenshot, then SELECT TOP 5 against likely text columns to triangulate.",
    },
  );

  registerAllTools(server, opts.suppressTools);
  return server;
}
