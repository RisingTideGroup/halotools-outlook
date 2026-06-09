import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { listContracts } from "@iusehalo/halo-api";

export function registerListContracts(server: McpServer): void {
  server.registerTool(
    "listContracts",
    {
      title: "List HaloPSA client contracts",
      description:
        "Return every client contract from HaloPSA's /ClientContract endpoint. Separate concept from recurring invoices — a single contract may have zero, one, or many recurring invoices attached. Each row shows id, client, name, status, and start/end dates.",
      inputSchema: {},
    },
    async () => {
      const all = await listContracts();
      const rows = all.map((c) => ({
        id: c.id,
        client_id: c.client_id,
        client_name: c.client_name,
        name: c.name,
        status: c.status,
        active: c.active,
        inactive: c.inactive,
        startdate: c.startdate,
        enddate: c.enddate,
      }));
      return {
        content: [{ type: "text", text: JSON.stringify(rows, null, 2) }],
      };
    },
  );
}
