import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { runReportSql } from "@iusehalo/halo-api";

const inputSchema = {
  sql: z
    .union([z.string().min(1), z.array(z.string().min(1)).min(1).max(10)])
    .describe(
      "Either a single SELECT statement OR an array of statements. See the tool description for the seven rules and when to batch. Use a single string for the common case; pass an array (max 10) only when you need several uncorrelated datasets in one round-trip and a SQL JOIN can't express them.",
    ),
  save: z
    .object({
      name: z
        .string()
        .min(1)
        .describe("Name to save the report under in Halo's Report Center."),
      folder_id: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Halo report folder ID. Omit to land in the default folder."),
    })
    .optional()
    .describe(
      "Persist as a reusable saved report instead of running inline. Only valid with a single SQL string. Use for queries the MSP will want to run repeatedly.",
    ),
};

export function registerRunSql(server: McpServer): void {
  server.registerTool(
    "runSql",
    {
      title: "Run a SQL SELECT against the HaloPSA database",
      description: [
        "Execute one or more SELECT statements against the HaloPSA database via Halo's Report Center.",
        "Returns the raw report response. For a single SQL string, returns one result. For an array, returns an array of results in the same order — one HTTP round-trip server-side.",
        "This is the highest-leverage tool in the kit — most analytical questions across an MSP's data are best answered by writing a query rather than paginating through REST endpoints.",
        "",
        "EXPLORE FIRST: before writing a report against tables/columns you're not certain of, call exploreSchema to learn the database — find the table (action 'tables'), inspect its columns (action 'columns'), and look at real sample rows (action 'sample'). Halo's schema is huge and the naming is unintuitive (FAULT = ticket, ACTION = note); guessing a column name wastes a query and produces wrong numbers. Understand the structure, THEN spend the effort writing the report here. Also check listReports for an existing saved report first.",
        "",
        "WHEN TO BATCH:",
        "Pass an array of SQL strings (max 10) when you need several uncorrelated datasets that a single JOIN can't express — e.g. \"MRR rollup AND top 10 overdue invoices AND licence expiry list\" for a dashboard answer. Halo runs them in parallel and returns the bundle in one round-trip. For correlated data that a JOIN handles, use a single query.",
        "",
        "THE SEVEN RULES — follow all of them, per query:",
        "",
        "1. ONE statement per query string. No semicolon-joined batches, no UNION-of-everything. (Pass an array if you genuinely need separate result sets.)",
        "2. No `--` single-line comments. Use /* block comments */ if you need to annotate.",
        "3. No trailing semicolon.",
        "4. No variables. No DECLARE, no @vars, no #temp tables, no CTEs that require WITH-at-the-top variables.",
        "5. British English in any string literals you write or compare against. It's licence (not license), colour (not color), organisation (not organization), enquiry (not inquiry). Halo's UI and stored values follow British conventions.",
        "6. The schema is 25+ years old and uses ITIL + old-fashioned naming. Some specifics worth memorising:",
        "   - FAULTS = the tickets table. FAULTS.faultid = ticket number.",
        "   - ACTIONS = every note, email, time entry, status change. One ACTIONS row per CRM event.",
        "   - ACTIONS.actionnumber is unique PER faultid, NOT globally. Use (faultid, actionnumber) as the natural key.",
        "   - USERS = external contacts (the human reporting tickets). AGENT = internal staff (the human resolving them). They are different tables — don't conflate.",
        "   - CLIENT = the customer company. SITE = a location within a client (multi-site clients are common).",
        "7. The schema is FUCKING HUGE — do not try to dump all columns of all tables in one query. The recommended discovery flow:",
        "   a. First call: `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES ORDER BY TABLE_NAME` — names only.",
        "   b. Use Rule 6's idioms to infer which tables are relevant (looking for tickets? probably FAULTS. Looking for time? probably ACTIONS with a time_taken column.)",
        "   c. For chosen tables: `SELECT TOP 5 * FROM <table>` to inspect columns and example values.",
        "   d. Then write the real query.",
        "",
        "8. ORDER BY needs a row-limit clause: it's invalid unless TOP, OFFSET, or FOR XML is also present. NEVER combine TOP with OFFSET (errors). To cap rows use `OFFSET 0 ROWS FETCH NEXT n ROWS ONLY`; for a full ordered set use `ORDER BY ... OFFSET 0 ROWS` (no TOP).",
        "",
        "CANONICAL HALO DEFINITIONS — use these exact rules so your numbers match the curated MCP tools; reach for those tools first, only drop to SQL for what they don't cover:",
        "- Ticket dates: opened = `dateoccured` (NOT `datecreated`, a corrupt row-stamp); closed = `datecleared`. Exclude deleted/merged with `coalesce(fdeleted,0)=coalesce(fmergedintofaultid,0)`. Exclude closed-on-creation STUBS (`datecleared <= dateoccured`, e.g. Quick Time) from service metrics.",
        "- Action work date = `coalesce(Whe_, ActionArrivalDate, ActionDateCreated)` (ActionDateCreated can be backdated).",
        "- Time & billability: `timetaken` = raw logged time; `timetakenadjusted` = time rounded per the rate's rounding rule. `ActionCode` is the charge-RATE id: `ActionCode+1 > 0` = billable (0/-1 = no charge). Billable HOURS = `actionchargehours` (invoiceable T&M) + `actionnonchargehours` (covered by an AGREEMENT — still billable!) + `actionprepayhours` (drawn from prepay). All three are billable, just to different places. Do NOT treat actionnonchargehours as non-billable and do NOT use ActIsBillable (over-counts).",
        "- MRR / recurring revenue = the ACTUAL generated recurring invoices, read BY CALENDAR MONTH — NOT a trailing-12-month average (TTM/12 silently under-reports any tenant with <12 months of billing history; a freshly migrated book reads ~half). Classify recurring at the LINE level: `INVOICEDETAIL.idrecurringinvoiceid < -1` (-1 is the 'not recurring' sentinel — down payments / sales-order / ad-hoc), on generated non-void invoices (`IH.IHid>0 and isnull(IH.ihvoided,0)=0`, active lines `isnull(ID.idisInactive,0)=0`); do NOT filter on the header `IHisRecurringInvoice` bit (reads False on the generated children). MRR = recurring invoiced in the latest COMPLETE calendar month; ALWAYS pull current + trailing two months side by side because recurring billing is lumpy (quarterly/annual contracts land in one month). The contract is on the line too: `INVOICEDETAIL.IDCHID → CONTRACTHEADER.CHid`. (STDREQUEST holds the schedulers; trust the invoice for the amount.)",
        "- Recognised revenue for an action = `INVOICEDETAIL.IDNet_Amount` of the line it links to via `ACTIONS.actioninvoicelineid` — SUM over DISTINCT line ids (many actions fan out to one line; per-action sum multiplies). Prepay-recognised $ = `ACTIONS.adefprepayamount`.",
        "- Prepay account = CONTRACT grain. PREPAYHISTORY split by SIGN: positive rows = refills (cash collected, invoiced); negative rows = manual deductions / expirations (classify via `ppDesc`). Consumed hours = `ACTIONS.ActionPrePayHours`. Remaining = refills − consumed − manual − expired.",
        "- Agent cost = `UNAME.ucostPrice`, OR — if cost-history tracking is enabled — `UnameCostTracking` (`uctCost`, date-ranged by `uctStartDate`/`uctEndDate`) for the rate in effect when the work was done. Both are HOURLY; a tenant may store annual salaries there (inflates cost). Avoid CF* columns (per-tenant custom fields).",
        "- MTTR: wall-clock `datediff(minute, dateoccured, datecleared)` includes customer-wait/hold time. For WORKING-hours use the scalar function `dbo.Fn_GetWorkingHours_datetimes(@start, @end, @slaid, @faultid, @timezone)`. CAVEAT: @timezone must be a WINDOWS tz name (e.g. 'Pacific Standard Time') — passing null or the IANA value Halo stores (CONTROL3.rtimezone, e.g. 'US/Pacific-New') throws an AT TIME ZONE error. Clamp negative results to 0.",
        "- Embeddings / ticket similarity = `FaultVectorScore` (FVSfaultid → FVSSimiliarfaultid, FVSScore cosine). `fvsSearchMethod` is the vector BACKEND (0=Halo store,1=Azure,2=OpenSearch) but WHICH backend is configured is irrelevant — just exclude the garbage NULL/'' method rows (they score unrelated tickets at 1.0): `coalesce(cast(fvsSearchMethod as nvarchar(20)),'') <> ''`. `FVSuse`: 0 = ticket↔ticket (FVSSimiliarfaultid is a FAULTS.faultid), 1 = ticket↔KB (it's a KBENTRY.id). Do NOT hard-code the score cutoff — start somewhere (~0.8) and evaluate/adjust the returned scores for the clustering task at hand.",
        "- Reactive support = ticket types whose ITIL category qualifies: `FAULTS.RequestTypeNew → REQUESTTYPE.RTid → REQUESTTYPE.RTRequestType` (the ITIL type). Standard Halo uses 1=Incident, 3=Service Request, but tenants add custom IDs — confirm this tenant's IDs before filtering.",
        "- Money is in the HOME currency = the `CURRENCY` row with `Crate=1.0` (`Ccode`). Don't assume a symbol; read it.",
        "- Seats: separate ASSETS (devices) from USERS (contacts). For user seats exclude service users, disabled users, and the default 'General User' placeholder (named per settings). Clients = AREA (`aarea`, `aareadesc`; `aisinactive` flags churned).",
        "- Agents = UNAME (`unum`, `uname`); exclude bots (`coalesce(uisapiagent,0)=0`) and the Unassigned pseudo-agent (`unum<>1`).",
        "",
        "WHEN YOU CAN'T FIND A FIELD:",
        "If the user references a value they see in Halo's UI but you can't locate which column stores it, ASK THEM FOR A SCREENSHOT of where it appears. Then `SELECT TOP 5 * FROM <likely_table> WHERE <text_col> = '<value>'` across candidate columns until one returns the row. Halo's UI labels rarely match column names verbatim — the screenshot lets you triangulate.",
        "",
        "SAVE-AS-REPORT:",
        "For one-off analysis, omit the `save` parameter — the query runs inline and isn't persisted. To save a query for the MSP to reuse from Halo's UI (or for you to invoke later via listReports), pass `{name, folder_id}`. Save is only valid with a single SQL string (not an array). Use this only when the user asks you to save it.",
      ].join("\n"),
      inputSchema,
    },
    async ({ sql, save }) => {
      const res = await runReportSql(sql, save ? { save } : undefined);
      return {
        content: [{ type: "text", text: JSON.stringify(trimRunSqlResponse(res), null, 2) }],
      };
    },
  );
}

/**
 * Halo's `/api/Report` response wraps the actual data in a `report` object
 * alongside a `table_html` field that re-renders the rows as a styled HTML
 * table — easily tens of KB per query, blows the agent's context window for
 * any non-trivial result set.
 *
 * Drop everything except `report`, and drop `report.table_html` within that.
 * Preserves the array shape for batch queries.
 */
function trimRunSqlResponse(res: unknown): unknown {
  if (Array.isArray(res)) return res.map(trimOne);
  return trimOne(res);
}

function trimOne(item: unknown): unknown {
  if (!item || typeof item !== "object") return item;
  const report = (item as Record<string, unknown>).report;
  if (!report || typeof report !== "object") return null;
  const { table_html: _drop, ...rest } = report as Record<string, unknown> & {
    table_html?: unknown;
  };
  return rest;
}
