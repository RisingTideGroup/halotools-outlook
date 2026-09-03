#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createHaloMcpServer } from "./server.js";
import {
  installRequestStorage,
  installCustomHeaders,
  loadEnvAuth,
  withRequestAuth,
} from "./halo/context.js";
import { createHttpServer } from "./http/server.js";

// halo-api reads tenant + token via its storage adapter; install ours (which is
// AsyncLocalStorage-backed) before any tool can run.
installRequestStorage();
// Optional MCP_CUSTOM_HEADER_<id>_NAME/_VALUE pairs — no-op unless configured.
installCustomHeaders();

function pickTransport(argv: string[]): "stdio" | "http" {
  if (argv.includes("--http")) return "http";
  if (argv.includes("--stdio")) return "stdio";
  if (process.env.MCP_TRANSPORT === "http") return "http";
  return "stdio";
}

async function runStdio(): Promise<void> {
  const auth = loadEnvAuth();
  if (!auth) {
    process.stderr.write(
      "halo-mcp-server: missing Halo config. Set HALO_BASE_URL and HALO_ACCESS_TOKEN.\n",
    );
    process.exit(1);
  }

  const server = createHaloMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Stdio mode is single-tenant for the life of the process — wrap the whole
  // run in one auth scope so every tool call resolves the same Halo config.
  await withRequestAuth(auth, () => new Promise<void>(() => { /* run forever */ }));
}

async function runHttp(): Promise<void> {
  const port = Number(process.env.PORT ?? 3001);
  const httpServer = createHttpServer();
  httpServer.listen(port, () => {
    process.stderr.write(
      `halo-mcp-server: listening on http://0.0.0.0:${port}\n`,
    );
  });

  const shutdown = () => {
    httpServer.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 5000).unref();
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

async function main(): Promise<void> {
  const transport = pickTransport(process.argv);
  if (transport === "http") {
    await runHttp();
  } else {
    await runStdio();
  }
}

main().catch((err) => {
  process.stderr.write(`halo-mcp-server: fatal: ${err?.stack ?? err}\n`);
  process.exit(1);
});
