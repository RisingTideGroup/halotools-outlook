import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getPrepayAccountBalance } from "@iusehalo/halo-api";

const inputSchema = {
  limit: z.number().int().positive().max(2000).optional().describe("Max prepay contracts to return. Default 500."),
};

export function registerGetPrepayAccountBalance(server: McpServer): void {
  server.registerTool(
    "getPrepayAccountBalance",
    {
      title: "Get HaloPSA prepay (deferred-revenue) account balances",
      description:
        "Per-contract prepay account ledger. PREPAYHISTORY is split by sign (not net-summed): purchasedHours/collectedAmount = positive refills (top-ups invoiced); manualDeductionHours = negative rows (manual/off-the-books consumption or write-offs); expiredHours = negative rows the note marks expired (lost). consumedHours = logged action draw-down (ActionPrePayHours), separate and additive. remainingHours = purchased − consumed − manualDeduction − expired (negative = over-drawn). Also deferredBalance (collected − recognised adefprepayamount; negative = recognised beyond collected), blendedRate, projectsOnContract, lastTopUp, clientActive (flag churned clients still holding a balance), and status (over-drawn / untouched / low-balance / healthy). Answers 'which clients have a negative prepay balance', 'who has untouched prepay', 'how much deferred revenue is left'. A high manualDeductionHours vs consumedHours = time taken off the block manually rather than via logged work. Grain is the contract (a client may hold several); sorted most over-drawn first. Home currency.",
      inputSchema,
    },
    async ({ limit }) => {
      const res = await getPrepayAccountBalance(limit ?? 500);
      return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
    },
  );
}
