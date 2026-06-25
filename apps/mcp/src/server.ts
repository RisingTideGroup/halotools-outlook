import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAllTools } from "./tools/index.js";
import { instanceSlug } from "./http/tenant.js";

export interface CreateServerOpts {
  suppressTools?: ReadonlySet<string>;
  /** Tenant identity used to label the server in MCP clients. When provided,
   *  serverInfo.name becomes `<haloBaseUrl> [<clientIdShort>]` so connectors
   *  showing multiple HaloPSA instances can distinguish them. Falls back to a
   *  generic name otherwise (stdio mode without a tenant). */
  tenant?: { haloBaseUrl: string; clientId: string };
  /** Pre-resolved per-instance tool-name prefix (from Halo's /api/instanceinfo
   *  tenant_id). When omitted, falls back to a hostname-derived slug. */
  toolPrefix?: string;
}

function buildServerName(tenant: CreateServerOpts["tenant"]): string {
  if (!tenant) return "halo-mcp-server";
  const idShort = tenant.clientId.split("-")[0] ?? tenant.clientId.slice(0, 8);
  return `${tenant.haloBaseUrl.replace(/\/$/, "")} [${idShort}]`;
}

// Branding for the iusehalo tools hub. Advertised in the MCP `initialize`
// response (serverInfo) so clients like Claude render OUR icon instead of
// falling back to scraping the server origin. The asset at /favicon.ico is a
// PNG copy, but we point at the real .png so the URL and mimeType agree —
// strict clients may reject an image/png mimeType on a .ico extension.
const BRAND_WEBSITE_URL = "https://tools.iusehalo.com/";
const BRAND_ICON_URL = "https://tools.iusehalo.com/favicon.png";

export function createHaloMcpServer(opts: CreateServerOpts = {}): McpServer {
  // Per-instance tool-name prefix so multiple HaloPSA connectors don't collide
  // in the client (e.g. `spiretech_runSql`). Empty in stdio mode (no tenant),
  // where there's only ever one server so no namespacing is needed.
  const slug =
    opts.toolPrefix ?? (opts.tenant ? instanceSlug(opts.tenant.haloBaseUrl) : "");
  const toolPrefixNote = slug
    ? `TOOL NAMING: every tool in this connection is namespaced \`${slug}_<tool>\` ` +
      `(e.g. \`${slug}_runSql\`, \`${slug}_exploreSchema\`) so multiple HaloPSA ` +
      `instances don't collide in your client. Tool names below omit that prefix ` +
      `for readability — prepend \`${slug}_\` when calling.\n\n`
    : "";
  const server = new McpServer(
    {
      name: buildServerName(opts.tenant),
      version: "0.1.0",
      websiteUrl: BRAND_WEBSITE_URL,
      icons: [
        {
          src: BRAND_ICON_URL,
          mimeType: "image/png",
          sizes: ["32x32"],
        },
      ],
    },
    {
      capabilities: {
        tools: {},
      },
      instructions:
        toolPrefixNote +
        "HaloPSA tools for an MSP. The point of this MCP is to crunch data a human can't quickly assemble from Halo's UI — cross-client trends, time-series rollups, profitability, MTTR/SLA by category, ticket similarity, categorisation. Per-ticket edits are usually faster in Halo's UI; prefer this MCP for analysis and bulk operations.\n\n" +
        "TOOL FAMILIES:\n" +
        "- Ad-hoc analysis: exploreSchema (START HERE for unfamiliar data — discover tables/columns and sample real rows so you understand the schema before querying), runSql (highest-leverage — SELECT via Report Center; read its 7 rules), listReports + getReport (check for an existing saved report FIRST, and read its SQL as a worked example — but validate it loads). haloApiGet is the read-only REST lens (GET only; endpoint name ≈ table name — handy for decoding columns); haloApiRaw is the write escape hatch (POST/PUT/PATCH/DELETE).\n" +
        "- Financial KPIs (carry their own drill-down rows — prefer these over hand-rolling listRecurringInvoices for client rankings): getMrrSnapshot (MRR + per-client ranking byClient + concentration topClientPct + period mix), getMspKpis (exec dashboard + top-25 clients + per-agent utilisation), getMrrPerSeatSnapshot (+ seatsByClient), getRevenuePerTechSnapshot (capacity ratio + agent roster), getTechnicianUtilizationSnapshot, getRecurringContractProfitability (per-client managed-services margin: recurring revenue vs support effort delivered + revenue-per-support-hour). Foundation REST reads: listRecurringInvoices, listTimesheets, listContracts, listOpportunities.\n" +
        "- Service-delivery KPIs: getServiceDeskHealth (overall: volume/SLA/MTTR/FTF/CSAT), getTicketBacklog (open aging + at-risk), getTechnicianScorecard + getTechnicianRiskSignals (per-tech performance & coaching-vs-disengagement), getClientHealthScorecard (at-risk accounts), getCategoryInsights (categorisation health + recurring problems).\n" +
        "- Similarity / embeddings (Halo ticket vector graph): getRecurringProblemClusters (recurring issues → KB/automation targets), getDuplicateTickets (merge candidates), getClientDejaVu (clients with repeat issues), getSimilarTicketInsights (a ticket's resolved neighbours → routing/effort), getKnowledgeGaps (KB coverage; needs KB embeddings enabled).\n" +
        "- Categorisation & noise: getTicketsToCategorize, setTicketCategory, createCategory, triggerTicketAiSummary, getNoiseTicketAnalysis.\n" +
        "- Projects & resourcing: getProjectPortfolio (% complete / hours vs estimate / age), getProjectProfitability (recognised revenue from linked invoice lines, prepay vs T&M split, effectiveRate, uncharged leak, margin gated by marginReliable), getPrepayAccountBalance (per-contract deferred-revenue account: collected vs recognised vs remaining — answers 'negative prepay balance', 'untouched prepay', 'deferred left to recognise'), getResourceForecast (forward ticket-linked booked hours vs capacity), getTechnicianUtilization (past-window booked vs worked vs billable vs leave-adjusted capacity).\n" +
        "- Operational (use sparingly): findContact, searchTickets, listOpenTickets, getActivityFeed; appendActionToTicket, createTicket, logNote; searchCannedText.\n\n" +
        "WORKFLOWS (call the tools in this order):\n" +
        "- Categorise tickets: getTicketsToCategorize (scope: onlyUncategorised / a specific category / time range) → for each ticket, match its AI summary to one of the returned `categories` (or decide none fits) → createCategory only for genuine gaps (don't make near-duplicates) → setTicketCategory per ticket. For tickets flagged summaryMissing, triggerTicketAiSummary first, wait a few seconds, then re-pull. Confidence-gate: low confidence → leave for human review.\n" +
        "- Reduce ticket noise: getNoiseTicketAnalysis → act on its per-type recommendations (mostly auto-reply suppression on the mailbox) to stop noise at intake rather than categorising it forever.\n" +
        "- Service-desk review: getServiceDeskHealth + getTicketBacklog + getCategoryInsights (+ getRecurringProblemClusters for what to fix/document).\n" +
        "- KB gaps: getKnowledgeGaps for coverage; getRecurringProblemClusters for which recurring issues to write up first.\n\n" +
        "KEY DATA GOTCHAS (the composite tools already handle these; mirror them in your own runSql):\n" +
        "- Ticket open time is dateoccured, NOT datecreated (datecreated is a corrupt row-stamp). Close time is datecleared. Exclude deleted/merged via fdeleted=fmergedintofaultid (COALESCE both, NULLable).\n" +
        "- Exclude closed-on-creation STUBS (datecleared==dateoccured, e.g. Quick Time) from service metrics. 'Reactive' scope = ITIL Incident + Service Request via REQUESTTYPE.RTRequestType in (1,3) (FAULTS.RequestType carries the ITIL code directly). EXCLUDE Advice/Other (21) — the quick-time/admin/recordings catch-all that distorts every metric it touches (it can be the BULK of tickets). Project work = ITIL 22/23/24; Problem (4) is its own class (kept out of reactive MTTR/SLA so long-running root-cause work doesn't skew it). Do NOT use RTIsProject=0 AND RTIsOpportunity=0 for reactive — that leaves Advice/Other (21) in. Confirm a tenant's custom ticket-type→ITIL mapping once.\n" +
        "- Embeddings (FaultVectorScore): fvsSearchMethod is the vector BACKEND (0=Halo store,1=Azure,2=OpenSearch) but WHICH one is configured is irrelevant — just drop the garbage NULL/'' method rows (they score unrelated tickets at 1.0): `coalesce(cast(fvsSearchMethod as nvarchar(20)),'') <> ''`. FVSuse=0 = ticket↔ticket, FVSuse=1 = ticket↔KB (FVSSimiliarfaultid is then a KBENTRY.id). The score cutoff is NOT fixed — evaluate the returned scores and adjust per task.\n" +
        "- Categories off-by-one: API category_1/categoryid_1 == DB category2 == CATEGORYDETAIL CDType 2 (== /Category type_id 1) = the PRIMARY category.\n" +
        "- CSAT = faisatisfactionlevel (AI, nvarchar — TRY_CONVERT); native SatisfactionLevel is sparse. SLA state 'I'=met/'O'=breached/''=none.\n" +
        "- Time/billability: worked hours = ACTIONS.timetaken (full logged time, incl. write-offs/internal). Billable HOURS = actionchargehours (invoiceable T&M) + actionnonchargehours (covered by an AGREEMENT — still billable) + actionprepayhours (drawn from prepay) — all three are billable, just routed differently; SUM them. Do NOT use ActIsBillable (over-counts) and do NOT treat actionnonchargehours as non-billable. ActionCode is the charge-RATE id (ActionCode+1>0 = has a charge rate; 0/-1 = no charge). Action work date = COALESCE(Whe_, ActionArrivalDate, ActionDateCreated) since ActionDateCreated can be backdated.\n" +
        "- Agent cost = ucostPrice, or the UnameCostTracking rate effective on the work date when populated (history tracking). Both are HOURLY in standard Halo; if a tenant stores annual salaries there, labour cost reads inflated — prefer effectiveRate. Avoid CF* columns (per-tenant custom fields).\n" +
        "- Resourcing sources: APPOINTMENT = calendar (APStartDate, exclude APdeleted/APAllDayEvent). Booked CLIENT/working time = ticket-linked only (APFaultid>0); unlinked appointments are internal meetings. worked (logged ACTIONS time) often exceeds ticket-linked booked. HOLIDAYS = leave (Hduration, HTechnicianID); TimesheetEvent = clock/shift hours (often sparse).\n" +
        "- Projects are refilled PREPAY BLOCKS, not fixed-fee. Budget = PREPAYHISTORY.PPHours purchased (top-ups) on the project's contract (FAULTS.fcontractid → CONTRACTHEADER.CHid); the estimate field is a stale placeholder. Prepay consumed = ACTIONS.ActionPrePayHours where AContractId = the contract. Over-servicing = delivered hours > purchased. Billable time is billed EITHER by drawing down prepay (ActionPrePayHours) OR via a direct charge (ActionChargeAmount) — so the genuine leak is billable hours with BOTH zero: ActionPrePayHours=0 AND ActionChargeAmount=0. Do NOT infer a leak from delivered − prepayConsumed (that counts T&M-charged time as a false leak).\n" +
        "- Money: amounts are stored in the HOME currency = the CURRENCY row with Crate=1.0 (Ccode). Don't assume a symbol; read it.\n" +
        "- Recognised revenue: ACTIONS.actioninvoicelineid → INVOICEDETAIL.IDid (IDNet_Amount) is the UNIFIED recognition key — it covers BOTH T&M and prepay deferred-revenue lines, so SUM over DISTINCT line ids (many actions fan out to one line — per-action sum multiplies it). The prepay-DR slice is ACTIONS.adefprepayamount; don't add it on top of the distinct-line sum (already included). On DR tenants actionprepayamount is 0; use adefprepayamount.\n" +
        "- Prepay account (deferred revenue) is CONTRACT-grain: cash collected = PREPAYHISTORY top-ups (PPAmount/pphours, invoiced); earned = adefprepayamount; hours drawn = ActionPrePayHours. Remaining hours = purchased − consumed (negative = over-drawn); deferred balance = collected − recognised. Use getPrepayAccountBalance — don't hand-roll by client (ppareaint): a client may hold several contracts and rolling up mixes them.\n" +
        "- PREPAYHISTORY caveats: pphours can be NEGATIVE (manual/expiry adjustments) so purchased is net; PPAmount is sometimes 0 (hours credited without a cash top-up). A contract showing $0 collected but revenue recognised is usually that non-cash-credit artifact, NOT real uncollected revenue — verify before treating tiny/negative-hour $0-collected contracts as a liability. Real liabilities are large untouched balances (collected, ~0 consumed) and inactive clients still holding cash.\n" +
        "- Client active flag = AREA.aisinactive (0 = active); flag prepay balances sitting on inactive clients.\n\n" +
        "When the user references a UI value you can't map to a column, ask for a screenshot, then SELECT TOP 5 against likely text columns to triangulate.",
    },
  );

  registerAllTools(server, opts.suppressTools, slug);
  return server;
}
