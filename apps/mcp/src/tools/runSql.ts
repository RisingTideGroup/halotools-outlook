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
        content: [{ type: "text", text: JSON.stringify(res, null, 2) }],
      };
    },
  );
}
