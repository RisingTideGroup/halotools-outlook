// Per-instance tool-name slug, resolved from Halo's own /api/instanceinfo.
//
// instanceinfo is unauthenticated and reports a canonical single-word
// `tenant_id` for hosted instances (e.g. "settonconsulting", "sktechnology") —
// a more stable, authoritative namespace than parsing the hostname (SK Tech's
// tenant_id is "sktechnology" while its host is sktechgroup.com). Resolution
// order:
//   1. tenant_id            (single word — preferred)
//   2. agent_url host       (dots → underscores)
//   3. hostname-derived slug (only if instanceinfo is unreachable)
//
// Cached per Halo base URL since the value is effectively static.

import { instanceSlug } from "../http/tenant.js";

const TTL_MS = 24 * 60 * 60 * 1000;
const cache = new Map<string, { slug: string; expiresAt: number }>();

function sanitize(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** agent_url → host with dots replaced by underscores (e.g.
 *  https://psa.settonconsulting.com → psa_settonconsulting_com). */
function fromAgentUrl(agentUrl: string): string {
  let host = agentUrl;
  try {
    host = new URL(agentUrl).hostname;
  } catch {
    // not a full URL — sanitize whatever we got
  }
  return sanitize(host.replace(/\./g, "_"));
}

/**
 * Resolve the per-instance tool-name slug for a Halo base URL. Always returns a
 * usable slug — falls back to the hostname-derived one if instanceinfo can't be
 * reached, so tool registration never blocks on this call.
 */
export async function resolveInstanceSlug(haloBaseUrl: string): Promise<string> {
  const key = haloBaseUrl.replace(/\/+$/, "");
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) {
    hit.expiresAt = Date.now() + TTL_MS; // sliding
    return hit.slug;
  }

  let slug = "";
  try {
    const res = await fetch(`${key}/api/instanceinfo`, {
      headers: { Accept: "application/json" },
    });
    if (res.ok) {
      const info = (await res.json()) as { tenant_id?: unknown; agent_url?: unknown };
      if (typeof info.tenant_id === "string" && sanitize(info.tenant_id)) {
        slug = sanitize(info.tenant_id);
      } else if (typeof info.agent_url === "string" && info.agent_url) {
        slug = fromAgentUrl(info.agent_url);
      }
    } else {
      await res.body?.cancel().catch(() => undefined);
    }
  } catch {
    // network/parse failure — fall through to hostname slug
  }

  if (!slug) slug = instanceSlug(haloBaseUrl);
  cache.set(key, { slug, expiresAt: Date.now() + TTL_MS });
  return slug;
}
