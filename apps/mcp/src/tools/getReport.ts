import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getReport } from "@iusehalo/halo-api";

const inputSchema = {
  id: z
    .number()
    .int()
    .positive()
    .describe("The saved report's id (from listReports)."),
};

export function registerGetReport(server: McpServer): void {
  server.registerTool(
    "getReport",
    {
      title: "Read a saved HaloPSA report's SQL",
      description:
        "Fetch one saved HaloPSA report's full definition INCLUDING its SQL. Use after listReports to read how an existing report derives its values — saved reports are worked examples of THIS tenant's idioms and column choices (Guideline 6: reverse-engineer from existing reports). VALIDATE FIRST — do not trust a report blindly: the response includes a `validates` block (whether the report's SQL currently loads, and any load error). A report that errors, or one flagged `usesDynamicSql` / hand-edited with $variables, is not reliable; read it for ideas but confirm the logic and that the columns are real (via exploreSchema) before reusing it. `mainEntity` is Halo's primary entity for the report and is almost always the primary DB table name (e.g. \"Faults\" = FAULTS), a useful bridge from REST/UI naming to the schema. Bulky column/permission/schedule/chart metadata and the rendered HTML are stripped.",
      inputSchema,
    },
    async ({ id }) => {
      const report = await getReport(id);
      return { content: [{ type: "text", text: JSON.stringify(report, null, 2) }] };
    },
  );
}
