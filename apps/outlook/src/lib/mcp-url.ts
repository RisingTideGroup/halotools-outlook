// Build the MCP server URL a user pastes into Claude Desktop / Cursor / ChatGPT
// desktop. Mirrors the path-encoded tenant blob the MCP HTTP server expects:
//
//   https://tools.iusehalo.com/mcp/t/<base64url(JSON({halo, clientId}))>/
//
// Keep this in sync with apps/mcp/src/http/tenant.ts::decodeTenant.

/** Host of the hosted MCP hub. The MCP server is a distinct service from the
 *  Outlook add-in, so its callback/host is keyed here (not window.location). */
export const MCP_HOST = "https://tools.iusehalo.com";

function base64url(input: string): string {
  // btoa handles ASCII fine; Halo URLs + UUIDs are ASCII so we don't bother
  // with the TextEncoder dance.
  return btoa(input)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function buildMcpUrl(haloBaseUrl: string, clientId: string): string {
  const blob = base64url(
    JSON.stringify({
      halo: haloBaseUrl.replace(/\/+$/, ""),
      clientId: clientId.trim(),
    }),
  );
  return `${MCP_HOST}/mcp/t/${blob}/`;
}
