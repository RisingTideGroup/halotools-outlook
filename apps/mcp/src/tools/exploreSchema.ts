import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { exploreSchema } from "@iusehalo/halo-api";

const inputSchema = {
  action: z
    .enum(["tables", "columns", "sample"])
    .describe(
      "What to discover: 'tables' = list base-table names (pass 'filter' to narrow); 'columns' = inspect one table's columns+types (pass 'table') or search column names across all tables (pass 'filter'); 'sample' = SELECT TOP n * from a table (pass 'table', optional 'where') to see real values.",
    ),
  table: z
    .string()
    .optional()
    .describe(
      "Table name (letters/digits/underscore). Required for 'sample'; for 'columns' it lists that table's columns. e.g. FAULTS, ACTIONS, AREA, SITE, USERS, UNAME, DEVICE.",
    ),
  filter: z
    .string()
    .optional()
    .describe(
      "Name substring. For 'tables' it matches table names; for 'columns' (without a 'table') it searches column names across every table. Always filter before a broad listing (Guideline 7).",
    ),
  where: z
    .string()
    .optional()
    .describe(
      "Only for 'sample': a SQL predicate to pin a row you can identify, e.g. \"faultid = 123456\" or \"INVNO = 'ABC-001'\". Lets you reverse-engineer which column holds a known real-world value (Guideline 8).",
    ),
  limit: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      "Row cap. 'tables' default 500, 'columns'-search default 300, 'sample' default 5 (max 25).",
    ),
};

export function registerExploreSchema(server: McpServer): void {
  server.registerTool(
    "exploreSchema",
    {
      title: "Database: Explore schema (START HERE before runSql)",
      description: [
        "Learn your way around HaloPSA's database BEFORE writing a report query. Halo's schema is huge and uses 25-year-old NetHelpDesk + ITIL naming — guessing column names wastes a query and produces wrong numbers. Use this to discover tables, inspect a table's columns, and look at real sample rows; THEN write the report with runSql.",
        "",
        "Typical flow: exploreSchema(action:'tables', filter:'…') to find the table → exploreSchema(action:'columns', table:'…') to see its columns → exploreSchema(action:'sample', table:'…', where:'…') to see real values → write the runSql query.",
        "",
        "THE 8 GUIDELINES for navigating Halo's database:",
        "",
        "1. FAULT = a ticket. Halo says 'fault' (a NetHelpDesk holdover). Select from FAULTS for ticket data — projects, opportunities and tasks are ALL stored as faults too.",
        "2. ACTION = a note/entry on a ticket. Every email, time entry, status change and internal note lives in ACTIONS, joined to tickets by fault id. If something happened to a ticket, it's here.",
        "3. Column prefixes mark the origin table. The prefix tells you where the data came from: on SITE, SArea is the client (AREA); on USERS, USite is the site id; a column like QHID is the primary key from the quotation header. Use action 'columns' to read them.",
        "4. Primary keys are reused across tables. Once you know a table's PK, look for it elsewhere to find relationships — area, site number, UID, fault id and a device's DID show up across many tables and are your join keys.",
        "5. Inspect columns before loading data. Don't pull massive result sets to learn structure — use action 'columns' on a table to read its column names/types first (the agent equivalent of Halo's Reporting 'Fields' tab), the way you'd inspect OutcomeID, ActionByUNum or SDeliveredBy to work out their function.",
        "6. Reverse-engineer from existing reports. Halo's report data sources show how things are built (e.g. how a 'Month Created' column uses CONVERT to format a date). Use listReports to find a saved report on the topic, and lean on the CANONICAL HALO DEFINITIONS in the runSql tool description, which capture the hard-won idioms.",
        "7. Search the schema, but always filter first. Use action 'tables' / 'columns' with a 'filter' substring to locate a term (e.g. find where an 'Azure Tenant' or client mapping lives) — this mirrors Halo's built-in 'Database Tables & Columns' report, which must be filtered or it's unusably slow. Never list everything raw.",
        "8. Use real values to discover field names. If you know a real-world value (asset tag, email, subject) but not its column, pull the row with action 'sample' + a 'where' that pins it, then read across the columns to find which one holds it — that's how an asset tag was found to live in DEVICE.INVNO.",
        "9. Cross-reference the REST API. The REST API is a second lens on the same data, and the endpoint name is more often than not the database table name (/Site ↔ SITE, /Faults ↔ FAULTS, /Users ↔ USERS; a report's mainEntity confirms it). When a raw column's meaning is unclear, GET one record from the matching endpoint with haloApiGet and line its friendly API field names/values up against this tool's sample row — the API label next to the raw value tells you what the column means.",
        "10. Learn from existing reports — but validate. Saved reports are worked examples of this tenant's own idioms: use listReports to find one on the topic and getReport to read its SQL. Don't trust it blindly though — getReport reports whether the SQL still loads; a broken or hand-edited/dynamic-SQL report is a starting point, not an answer. Confirm the columns are real (here) before reusing the logic.",
        "",
        "Each call returns the exact SQL it ran (so you learn the idioms), the rows, and a short note pointing at the relevant guideline. Read-only; runs through Report Center like runSql, so the same constraints apply to any 'where' you pass (British English string values, no variables).",
      ].join("\n"),
      inputSchema,
    },
    async ({ action, table, filter, where, limit }) => {
      const res = await exploreSchema({ action, table, filter, where, limit });
      return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
    },
  );
}
