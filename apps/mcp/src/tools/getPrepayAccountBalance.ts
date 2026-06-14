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
        "Per-contract prepay account ledger: cash collected (PREPAYHISTORY top-ups) and net hours purchased vs hours consumed (ActionPrePayHours) and revenue recognised (adefprepayamount, deferred revenue). Returns remainingHours (negative = over-drawn — work delivered beyond the paid block), deferredBalance (cash collected but not yet earned; negative = recognised beyond collected), blendedRate, projectsOnContract, lastTopUp, a status (over-drawn / untouched / low-balance / healthy), and clientActive (whether the client account is still active — flag balances on inactive clients). Use to answer things like 'which clients have a negative prepay balance', 'who has untouched prepay sitting unused', or 'how much deferred revenue is left to recognise'. Grain is the contract (a client may hold several); sorted most over-drawn first. Amounts in the home currency.",
      inputSchema,
    },
    async ({ limit }) => {
      const res = await getPrepayAccountBalance(limit ?? 500);
      return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
    },
  );
}
