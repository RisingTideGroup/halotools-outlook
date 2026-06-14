import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getNoiseTicketAnalysis } from "@iusehalo/halo-api";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const inputSchema = {
  startdate: z
    .string()
    .regex(DATE_RE, "YYYY-MM-DD")
    .optional()
    .describe("Window start date, YYYY-MM-DD. Defaults to 365 days ago."),
  enddate: z
    .string()
    .regex(DATE_RE, "YYYY-MM-DD")
    .optional()
    .describe("Window end date (inclusive), YYYY-MM-DD. Defaults to today."),
};

export function registerGetNoiseTicketAnalysis(server: McpServer): void {
  server.registerTool(
    "getNoiseTicketAnalysis",
    {
      title: "Analyse HaloPSA noise tickets (stop them at source)",
      description:
        "Quantifies low/no-value reactive tickets — auto-replies, out-of-office bounces, OTP/verification emails, vendor newsletters, test tickets — that still consume triage time, for a window (default trailing 365 days). Returns the noise share of reactive volume, hours wasted, a breakdown by noise type (each with a concrete source-fix recommendation, e.g. enable auto-reply detection on the mailbox), and a per-mailbox breakdown so you can see which inbound mailbox to harden. The goal is eliminating the noise at intake, not just categorising it.",
      inputSchema,
    },
    async ({ startdate, enddate }) => {
      const res = await getNoiseTicketAnalysis(startdate, enddate);
      return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
    },
  );
}
