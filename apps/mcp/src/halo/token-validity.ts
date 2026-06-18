// Per-token Halo auth probe.
//
// The local JWT `exp` check (isAccessTokenExpired) catches clock expiry for
// free, but a token can be rejected by Halo while still inside `exp` — revoked,
// agent disabled, password reset, Connect app changed. Halo is the source of
// truth, so we confirm against a cheap auth-only endpoint and cache the positive
// result per token: at most one Halo round-trip per token per TTL, not one per
// MCP request.
//
// Fail OPEN: only an explicit 401/403 from Halo counts as "invalid". A 404
// (wrong path on some tenant), 5xx, or network blip returns "unknown" so a
// flaky Halo never wedges every request behind a false re-auth loop.

const PROBE_TTL_MS = 5 * 60 * 1000;
// Cheap, auth-only "who am I" endpoint. Returns the signed-in agent record.
const PROBE_PATH = "/api/agent/me";
// Bound the cache so a long-lived process churning tokens can't grow unbounded.
const MAX_ENTRIES = 5000;

interface CachedProbe {
  validUntil: number;
}

const validTokens = new Map<string, CachedProbe>();

export type TokenCheck = "valid" | "invalid" | "unknown";

/**
 * Confirm a Halo access token still authenticates.
 *   - "valid"   : Halo accepted it (cached for PROBE_TTL_MS)
 *   - "invalid" : Halo explicitly rejected it (401/403) — caller should 401
 *   - "unknown" : couldn't tell (404/5xx/network) — caller should NOT block
 */
export async function checkHaloToken(
  haloBaseUrl: string,
  accessToken: string,
): Promise<TokenCheck> {
  const now = Date.now();
  const hit = validTokens.get(accessToken);
  if (hit && hit.validUntil > now) return "valid";

  // Lazy prune of expired entries when the map gets large.
  if (validTokens.size > MAX_ENTRIES) {
    for (const [k, v] of validTokens) {
      if (v.validUntil <= now) validTokens.delete(k);
    }
  }

  const base = haloBaseUrl.replace(/\/+$/, "");
  let res: Response;
  try {
    res = await fetch(`${base}${PROBE_PATH}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
    });
  } catch {
    return "unknown";
  }
  // Drain the body so the socket is released; we only care about the status.
  await res.body?.cancel().catch(() => undefined);

  if (res.status === 401 || res.status === 403) return "invalid";
  if (res.ok) {
    validTokens.set(accessToken, { validUntil: now + PROBE_TTL_MS });
    return "valid";
  }
  return "unknown";
}
