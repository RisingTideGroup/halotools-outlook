import { getAccessToken, refresh, NotAuthenticatedError } from "./auth.js";
import { getConfig, getTokens, clearTokens } from "./config.js";
import { storage } from "./storage.js";
import type {
  HaloClient,
  HaloUser,
  HaloTicket,
  HaloAction,
  HaloTicketType,
  HaloStatus,
  HaloAgent,
  HaloClientCache,
  HaloChargeRate,
  HaloSalesMailboxGroup,
  HaloKbArticle,
  HaloCannedText,
  HaloCannedTextGroup,
  HaloCRMNote,
  HaloFeedItem,
  HaloFeedResponse,
  HaloPriority,
  CreateTicketPayload,
  CreateActionPayload,
  CreateContactPayload,
  CreateCannedTextPayload,
  CreateCRMNotePayload,
  UpdateTicketPayload,
  HaloRecurringInvoice,
  HaloTimesheet,
  HaloContract,
  HaloOpportunity,
  MrrSnapshot,
  UtilizationSnapshot,
  MspKpis,
  TicketScope,
  SlaAttainment,
  ServiceDeskHealth,
  TechnicianScorecard,
  TechnicianScorecardRow,
  ClientHealthScorecard,
  ClientHealthRow,
  CategoryInsights,
  TechnicianRiskSignals,
  TechnicianRiskRow,
  TicketBacklog,
  RecurringProblemClusters,
  RecurringProblemCluster,
  DuplicateTickets,
  DuplicateTicketMatch,
  ClientDejaVu,
  ClientDejaVuRow,
  SimilarTicketInsights,
  KnowledgeGaps,
  TicketsToCategorize,
  CategorizationTicket,
  HaloCategory,
  NoiseTicketAnalysis,
  ProjectProfitability,
  ProjectProfitabilityRow,
  ProjectBillingModel,
  ProjectPortfolio,
  ResourceForecast,
  TechnicianUtilization,
  TechnicianUtilizationRow,
  PrepayAccountBalance,
  PrepayAccountRow,
  RecurringContractProfitability,
  RecurringContractProfitabilityRow,
  RecurringContractTech,
  SimilarTicketNeighbour,
} from "./types.js";

class HaloApiError extends Error {
  constructor(public status: number, public body: string) {
    super(`Halo API ${status}: ${body}`);
    this.name = "HaloApiError";
  }
}

async function call<T>(path: string, init: RequestInit = {}, retried = false): Promise<T> {
  const cfg = getConfig();
  if (!cfg) throw new NotAuthenticatedError("No tenant config");

  const token = await getAccessToken();
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  if (!headers.has("Accept")) headers.set("Accept", "application/json");
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  let res: Response;
  try {
    res = await fetch(`${cfg.haloBaseUrl}/api${path}`, { ...init, headers });
  } catch (e) {
    // Fetch only throws on network-level failures (CORS preflight rejection, offline, DNS, TLS).
    // Surface the most likely cause first since CORS misconfiguration is the dominant failure mode
    // for SPAs talking to a Halo tenant.
    throw new HaloApiError(
      0,
      `Network call to ${cfg.haloBaseUrl} failed. Most common cause: the add-in's origin (https://tools.iusehalo.com) is not on this Halo Connect app's CORS allowed origins list. Original error: ${(e as Error).message}`,
    );
  }

  // 401 → one retry after forced refresh. Skipped when there's no refresh
  // token (server-side stateless callers like the MCP server pass an access
  // token only). If refresh fails it already wipes tokens (auth.ts), so we
  // fall through to the auth-failure handling below.
  if (res.status === 401 && !retried) {
    const tokens = getTokens();
    if (tokens?.refreshToken) {
      try {
        await refresh(tokens.refreshToken);
        return call<T>(path, init, true);
      } catch {
        // refresh() already cleared tokens; let the !res.ok block below
        // surface a NotAuthenticatedError so the UI flips to AuthScreen.
      }
    }
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    // Classify auth failures vs every-other-thing-can-go-wrong:
    //   - 401 (and we already tried refresh) → token rejected
    //   - 403 → scope / permission revoked, treat as needing re-auth
    //   - 400 with OAuth error-code body markers → expired token surfaced
    //     as a 400 by some Halo endpoints
    // 5xx and other 4xx (404 not-found, 422 validation, etc.) stay as
    // HaloApiError so callers can show specific messages without booting
    // the user back to sign-in.
    const isAuthFailure =
      res.status === 401 ||
      res.status === 403 ||
      (res.status === 400 && /invalid_?token|expired_?token|invalid_?grant|unauthorized/i.test(body));
    if (isAuthFailure) {
      await clearTokens();
      throw new NotAuthenticatedError("Session expired — please sign in again");
    }
    throw new HaloApiError(res.status, body);
  }

  if (res.status === 204) return undefined as unknown as T;
  return (await res.json()) as T;
}

// ---------- Read paths ----------

export async function findUserByEmail(email: string): Promise<HaloUser | undefined> {
  const q = new URLSearchParams({ search: email, includeinactive: "false" });
  const res = await call<{ users: HaloUser[] } | HaloUser[]>(`/Users?${q}`);
  const arr = Array.isArray(res) ? res : res.users;
  return arr.find((u) => u.emailaddress?.toLowerCase() === email.toLowerCase()) ?? arr[0];
}

/** Broad user search for the manual picker — returns all matches. */
export async function searchUsers(query: string, limit = 25): Promise<HaloUser[]> {
  const q = new URLSearchParams({
    search: query,
    includeinactive: "false",
    count: String(limit),
  });
  const res = await call<{ users: HaloUser[] } | HaloUser[]>(`/Users?${q}`);
  return Array.isArray(res) ? res : res.users;
}

export async function findClientByDomain(domain: string): Promise<HaloClient | undefined> {
  const q = new URLSearchParams({ search: domain, includeinactive: "false" });
  const res = await call<{ clients: HaloClient[] } | HaloClient[]>(`/Client?${q}`);
  const arr = Array.isArray(res) ? res : res.clients;
  return arr[0];
}

/** Broad client search for the manual picker. */
export async function searchClients(query: string, limit = 25): Promise<HaloClient[]> {
  const q = new URLSearchParams({
    search: query,
    includeinactive: "false",
    count: String(limit),
  });
  const res = await call<{ clients: HaloClient[] } | HaloClient[]>(`/Client?${q}`);
  return Array.isArray(res) ? res : res.clients;
}

/** Free-text ticket search — used by the compose surface to insert ticket links. */
export async function searchTickets(query: string, limit = 25): Promise<HaloTicket[]> {
  const q = new URLSearchParams({
    search: query,
    pageinate: "false",
    count: String(limit),
  });
  const res = await call<{ tickets: HaloTicket[] } | HaloTicket[]>(`/Tickets?${q}`);
  return Array.isArray(res) ? res : res.tickets;
}

// ---------- Canned text ----------

/** Cache of the full canned-text list. Halo doesn't support server-side search reliably
 * on /CannedText, so we pull once and filter in-memory. The list is small enough
 * (hundreds of entries) that this is fast and avoids hitting the API on every keystroke.
 * Keyed by haloBaseUrl so stateless multi-tenant callers (MCP) don't leak across tenants. */
const _cannedTextCache = new Map<string, HaloCannedText[]>();

function cacheKey(): string {
  return getConfig()?.haloBaseUrl ?? "";
}

export async function listCannedText(force = false): Promise<HaloCannedText[]> {
  const key = cacheKey();
  const hit = _cannedTextCache.get(key);
  if (hit && !force) return hit;
  const q = new URLSearchParams({
    showall: "true",
    entity: "0",
    access_control_level: "2",
  });
  const res = await call<HaloCannedText[] | { canned_texts: HaloCannedText[] }>(
    `/CannedText?${q}`,
  );
  const list = Array.isArray(res) ? res : (res.canned_texts ?? []);
  _cannedTextCache.set(key, list);
  return list;
}

/** Search canned text by name and body, optionally scoped to a group. */
export async function searchCannedText(
  query: string,
  groupId?: number,
): Promise<HaloCannedText[]> {
  const all = await listCannedText();
  const scoped = groupId == null ? all : all.filter((c) => c.group_id === groupId);
  const needle = query.trim().toLowerCase();
  if (!needle) return scoped.slice(0, 50);
  return scoped
    .filter((c) => {
      const hay = `${c.name ?? ""} ${c.text ?? ""}`.toLowerCase();
      return hay.includes(needle);
    })
    .slice(0, 50);
}

/** Halo stores canned-text groups in the shared /Lookup table under lookupid=45.
 * Keyed by haloBaseUrl for the same reason as _cannedTextCache. */
const _cannedTextGroupsCache = new Map<string, HaloCannedTextGroup[]>();

export async function listCannedTextGroups(force = false): Promise<HaloCannedTextGroup[]> {
  const key = cacheKey();
  const hit = _cannedTextGroupsCache.get(key);
  if (hit && !force) return hit;
  const q = new URLSearchParams({
    lookupid: "45",
    showallcodes: "true",
    access_control_level: "2",
  });
  const res = await call<HaloCannedTextGroup[]>(`/Lookup?${q}`);
  // valueint1=0 is the Tickets/email type; 1 is Chat. Keep Tickets only — the
  // Outlook plug-in is composing email, not chat.
  const list = (Array.isArray(res) ? res : []).filter(
    (g) => g.valueint1 == null || g.valueint1 === 0,
  );
  _cannedTextGroupsCache.set(key, list);
  return list;
}

export async function createCannedText(
  payload: CreateCannedTextPayload,
): Promise<HaloCannedText> {
  const res = await call<HaloCannedText[]>("/CannedText", {
    method: "POST",
    body: JSON.stringify([payload]),
  });
  // Invalidate cache so the new entry appears in the next search.
  _cannedTextCache.delete(cacheKey());
  return res[0];
}

export async function createCannedTextGroup(name: string): Promise<HaloCannedTextGroup> {
  const res = await call<HaloCannedTextGroup[]>("/Lookup", {
    method: "POST",
    body: JSON.stringify([{ lookupid: 45, name, valueint1: 0 }]),
  });
  _cannedTextGroupsCache.delete(cacheKey());
  return res[0];
}

/** Free-text KB article search — used by the compose surface to insert article snippets. */
export async function searchKbArticles(query: string, limit = 25): Promise<HaloKbArticle[]> {
  const q = new URLSearchParams({
    search: query,
    pageinate: "false",
    count: String(limit),
  });
  // Halo's KB collection wrapper is inconsistent across versions — some tenants return a bare array,
  // others return { articles: [...] } or { kbarticles: [...] }. Normalize to an array.
  const res = await call<
    { articles?: HaloKbArticle[]; kbarticles?: HaloKbArticle[] } | HaloKbArticle[]
  >(`/KBArticle?${q}`);
  if (Array.isArray(res)) return res;
  return res.articles ?? res.kbarticles ?? [];
}

export async function listOpenTicketsForClient(clientId: number): Promise<HaloTicket[]> {
  const q = new URLSearchParams({
    client_id: String(clientId),
    open_only: "true",
    pageinate: "false",
    // Without these, Halo's list response omits agent name, priority, SLA and
    // custom fields — the row pills then read "Unassigned" / "—" for tickets
    // that are actually assigned.
    includedetails: "true",
    includeagentdetails: "true",
  });
  const res = await call<{ tickets: HaloTicket[] } | HaloTicket[]>(`/Tickets?${q}`);
  return Array.isArray(res) ? res : res.tickets;
}

export async function listOpenTicketsForUser(userId: number): Promise<HaloTicket[]> {
  const q = new URLSearchParams({
    user_id: String(userId),
    open_only: "true",
    pageinate: "false",
    includedetails: "true",
    includeagentdetails: "true",
  });
  const res = await call<{ tickets: HaloTicket[] } | HaloTicket[]>(`/Tickets?${q}`);
  return Array.isArray(res) ? res : res.tickets;
}

/** Best-effort open-ticket count for a contact. Swallows errors so the caller
 *  (e.g. the MCP contact dossier) renders zero rather than failing the whole request. */
export async function getOpenTicketCount(userId: number): Promise<number> {
  try {
    const tix = await listOpenTicketsForUser(userId);
    return tix.length;
  } catch {
    return 0;
  }
}

/**
 * Resolve a set of RFC Message-IDs (the current email + In-Reply-To + References)
 * to the Halo tickets they belong to. Threading works because Halo's email intake
 * and our own appendAction calls both stamp `internetmessageid` on each Action.
 */
export async function findTicketsForEmail(messageIds: string[]): Promise<HaloTicket[]> {
  const ids = Array.from(
    new Set(messageIds.map((id) => id?.trim()).filter((id): id is string => !!id)),
  );
  if (ids.length === 0) return [];

  const perId = await Promise.all(
    ids.map(async (id) => {
      try {
        const q = new URLSearchParams({
          internetmessageid: id,
          pageinate: "false",
        });
        const res = await call<{ actions: HaloAction[] } | HaloAction[]>(`/Actions?${q}`);
        return Array.isArray(res) ? res : res.actions ?? [];
      } catch {
        // A single bad ID (or a Halo version that 4xxs on unknown filters) shouldn't
        // blank the whole conversation pane.
        return [];
      }
    }),
  );

  const ticketIds = Array.from(
    new Set(
      perId
        .flat()
        .map((a) => a.ticket_id)
        .filter((tid): tid is number => typeof tid === "number" && tid > 0),
    ),
  );
  if (ticketIds.length === 0) return [];

  const tickets = await Promise.all(
    ticketIds.map(async (tid) => {
      try {
        return await call<HaloTicket | undefined>(`/Tickets/${tid}`);
      } catch {
        return undefined;
      }
    }),
  );
  return tickets.filter((t): t is HaloTicket => !!t && typeof t.id === "number");
}

// ---------- Reference data (cached in-memory for the session) ----------
// All keyed by haloBaseUrl so stateless multi-tenant callers don't see each
// other's data when serving multiple tenants from one process.

const _ticketTypesCache = new Map<string, HaloTicketType[]>();
const _agentsCache = new Map<string, HaloAgent[]>();
const _statusesCache = new Map<string, HaloStatus[]>();
const _prioritiesCache = new Map<string, HaloPriority[]>();

export async function listTicketTypes(force = false): Promise<HaloTicketType[]> {
  const key = cacheKey();
  const hit = _ticketTypesCache.get(key);
  if (hit && !force) return hit;
  // Prefer the list ClientCache already loaded — it's the same set Halo's own
  // UI uses, and we've already paid the round-trip on app bootstrap. Falls
  // through to /api/TicketType with the same flags Halo's UI sends when
  // ClientCache isn't loaded yet (older tenants, refresh path).
  const cached = getCachedClientCache();
  if (cached?.tickettypes && Array.isArray(cached.tickettypes)) {
    const list = cached.tickettypes.filter((t) => !t.inactive);
    _ticketTypesCache.set(key, list);
    return list;
  }
  const res = await call<{ tickettypes: HaloTicketType[] } | HaloTicketType[]>(
    "/TicketType?showall=true&showinactive=false&include_defaults=true",
  );
  const list = (Array.isArray(res) ? res : res.tickettypes).filter((t) => !t.inactive);
  _ticketTypesCache.set(key, list);
  return list;
}

/**
 * Subset of ticket types an agent can actually pick when creating from an email.
 * - agentscanselect === false drops types that exist only for auto-creation
 *   (e.g. "AI Parse Halo Email", "Triage") or end-user surfaces.
 * - visible === false drops types Halo has hidden everywhere.
 *
 * Does NOT filter on `use`: opportunities ("opps") and projects ("projects")
 * are valid log targets for emails (a sales email logged to an opportunity,
 * a project status email logged to a project) and were previously excluded
 * by an over-aggressive filter that's been removed.
 */
export function ticketTypesForAgentCreate(all: HaloTicketType[]): HaloTicketType[] {
  return all.filter((t) => {
    if (t.inactive) return false;
    if (t.visible === false) return false;
    if (t.agentscanselect === false) return false;
    return true;
  });
}

export async function listAgents(force = false): Promise<HaloAgent[]> {
  const key = cacheKey();
  const hit = _agentsCache.get(key);
  if (hit && !force) return hit;
  const res = await call<{ agents: HaloAgent[] } | HaloAgent[]>(
    "/Agent?includeinactive=false",
  );
  const list = (Array.isArray(res) ? res : res.agents).filter((a) => !a.inactive);
  _agentsCache.set(key, list);
  return list;
}

export async function listStatuses(force = false): Promise<HaloStatus[]> {
  const key = cacheKey();
  const hit = _statusesCache.get(key);
  if (hit && !force) return hit;
  const res = await call<{ statuses: HaloStatus[] } | HaloStatus[]>(
    "/Status?includeinactive=false",
  );
  const list = (Array.isArray(res) ? res : res.statuses).filter((s) => !s.inactive);
  _statusesCache.set(key, list);
  return list;
}

export async function listPriorities(force = false): Promise<HaloPriority[]> {
  const key = cacheKey();
  const hit = _prioritiesCache.get(key);
  if (hit && !force) return hit;
  const res = await call<{ priorities: HaloPriority[] } | HaloPriority[]>(
    "/Priority?includeinactive=false",
  );
  const list = (Array.isArray(res) ? res : res.priorities).filter((p) => !p.inactive);
  _prioritiesCache.set(key, list);
  return list;
}

export function clearReferenceCache() {
  const key = cacheKey();
  _ticketTypesCache.delete(key);
  _agentsCache.delete(key);
  _statusesCache.delete(key);
  _prioritiesCache.delete(key);
}

// ---------- ClientCache (bootstrap data) ----------

let _clientCache: HaloClientCache | undefined;
let _clientCachePromise: Promise<HaloClientCache> | undefined;

/**
 * Fetch /api/ClientCache — the same endpoint the Halo UI bootstraps from on
 * login. Single fat call (~3MB) that includes the signed-in agent's full
 * record, all agents, mailboxes, tenant control flags, and more. We cache
 * for the session and de-dupe concurrent callers via the in-flight promise.
 *
 * Use this in preference to listAgents() / getCurrentAgent() etc. — those
 * pre-existing helpers stay for compatibility but route through here when
 * possible to avoid duplicate round-trips.
 */
export async function getClientCache(force = false): Promise<HaloClientCache> {
  if (_clientCache && !force) return _clientCache;
  if (_clientCachePromise && !force) return _clientCachePromise;
  _clientCachePromise = call<HaloClientCache>("/ClientCache").then((res) => {
    _clientCache = res;
    _clientCachePromise = undefined;
    writeAgentSnapshot(res.agent);
    // Resolve the agent's sales mailbox in the background so it's cached by
    // the time the on-send handler needs it. Non-blocking; failure is
    // expected for tenants without sales mailbox functionality.
    if (res.agent?.email) {
      findSalesMailboxIdForAgent(res.agent.email)
        .then((id) => {
          if (id !== undefined) writeAgentSnapshot(res.agent);
        })
        .catch(() => { /* silent — feature optional */ });
    }
    return res;
  }).catch((e) => {
    _clientCachePromise = undefined;
    throw e;
  });
  return _clientCachePromise;
}

/**
 * Cross-runtime agent snapshot. Written to localStorage when ClientCache
 * resolves in the task pane so the on-send launchevent runtime (which can't
 * fetch ClientCache itself within its tight time budget) can read it
 * synchronously. Same shared-localStorage pattern as the diagnostics log.
 * Trimmed to just the fields the on-send handler needs.
 */
const AGENT_SNAPSHOT_KEY = "halo.agentSnapshot.v1";

interface AgentSnapshot {
  id: number;
  name: string;
  email?: string;
  signature?: string;
  /** Resolved sales-mailbox id for this agent (or undefined if none / not
   *  resolved yet). The launchevent runtime reads this for the
   *  `sales_mailbox_override_id` field on outbound action payloads. */
  salesMailboxId?: number;
}

function writeAgentSnapshot(agent: HaloAgent | undefined): void {
  if (!agent || typeof window === "undefined") return;
  try {
    const snap: AgentSnapshot = {
      id: agent.id,
      name: agent.name,
      email: agent.email,
      signature: agent.signature,
      salesMailboxId: getCachedSalesMailboxId(),
    };
    window.localStorage.setItem(AGENT_SNAPSHOT_KEY, JSON.stringify(snap));
  } catch {
    /* swallow — quota, private mode, etc. */
  }
}

/** Synchronous accessor — returns the cached ClientCache if already loaded,
 *  undefined otherwise. Use this in render paths where blocking on a fetch
 *  isn't appropriate. Call getClientCache() once at app bootstrap to warm. */
export function getCachedClientCache(): HaloClientCache | undefined {
  return _clientCache;
}

export function clearClientCache(): void {
  _clientCache = undefined;
  _clientCachePromise = undefined;
}

// ---------- Current user → Halo agent ----------

const CURRENT_AGENT_KEY = "halo.currentAgentId.v1";

/**
 * Resolve the current Halo agent for the signed-in user. Uses ClientCache.agent
 * when available (one round-trip on app load), falls back to the legacy
 * listAgents+filter path for older Halo tenants where /api/ClientCache might
 * not be exposed. The outlookEmail argument is only used by the fallback path
 * and is now optional.
 *
 * Cached in storage so subsequent calls don't re-fetch.
 */
export async function getCurrentAgent(
  outlookEmail?: string,
): Promise<HaloAgent | undefined> {
  // Primary path: ClientCache.agent IS the current agent.
  try {
    const cc = await getClientCache();
    if (cc.agent) {
      await storage().set(CURRENT_AGENT_KEY, cc.agent.id);
      return cc.agent;
    }
  } catch {
    // Fall through to legacy path on any ClientCache failure (older tenants,
    // permission issues, network). Don't surface as an error — the legacy
    // path is functionally equivalent for agent identity.
  }

  if (!outlookEmail) return undefined;
  const cachedId = storage().get<number>(CURRENT_AGENT_KEY);
  if (cachedId) {
    const agents = await listAgents();
    const cached = agents.find((a) => a.id === cachedId);
    if (cached) return cached;
  }
  const agents = await listAgents();
  const matched = agents.find(
    (a) => a.email?.toLowerCase() === outlookEmail.toLowerCase(),
  );
  if (matched) await storage().set(CURRENT_AGENT_KEY, matched.id);
  return matched;
}

// ---------- Sales mailbox resolution ----------

const SALES_MAILBOX_ID_KEY = "halo.salesMailboxId.v1";
const SALES_MAILBOX_RESOLVED_FOR_KEY = "halo.salesMailboxResolvedFor.v1";

/**
 * Resolve the `sales_mailbox_override_id` for the signed-in agent.
 *
 * Two-step walk against /api/SalesMailbox (accessible to non-admin agents):
 *   1. GET /SalesMailbox lists the sales-mailbox GROUPS in the tenant
 *   2. GET /SalesMailbox/<group_id>?includedetails=true returns the group
 *      with its `mailboxes[]` populated — each one a per-agent sales mailbox
 *      setup with either `name` (the mailbox email) or `linked_agent_email`
 *      we match against the agent's email
 *
 * Cached in storage keyed by the resolved-for email so we don't re-walk on
 * every send. Returns undefined when:
 *   - the tenant doesn't have sales mailbox functionality enabled
 *   - the agent has no shared/sales mailbox configured for them
 *   - the endpoint isn't reachable (older Halo, permission edge cases)
 *
 * The caller should omit `sales_mailbox_override_id` from the payload when
 * this returns undefined — Halo falls back to tenant defaults.
 */
export async function findSalesMailboxIdForAgent(
  agentEmail: string,
): Promise<number | undefined> {
  const lc = agentEmail.toLowerCase();
  const cachedFor = storage().get<string>(SALES_MAILBOX_RESOLVED_FOR_KEY);
  if (cachedFor === lc) {
    const cached = storage().get<number>(SALES_MAILBOX_ID_KEY);
    if (typeof cached === "number") return cached;
  }
  try {
    const list = await call<
      { mailboxes?: HaloSalesMailboxGroup[] } | HaloSalesMailboxGroup[]
    >("/SalesMailbox");
    const groups = Array.isArray(list) ? list : list.mailboxes ?? [];
    for (const group of groups) {
      if (typeof group?.id !== "number") continue;
      const detail = await call<HaloSalesMailboxGroup>(
        `/SalesMailbox/${group.id}?includedetails=true`,
      );
      const match = (detail.mailboxes ?? []).find(
        (m) =>
          m.name?.toLowerCase() === lc ||
          m.linked_agent_email?.toLowerCase() === lc,
      );
      if (match && typeof match.id === "number") {
        await storage().set(SALES_MAILBOX_RESOLVED_FOR_KEY, lc);
        await storage().set(SALES_MAILBOX_ID_KEY, match.id);
        return match.id;
      }
    }
  } catch {
    // Tenant without sales mailbox feature, or endpoint unreachable. Cache
    // the negative so we don't keep walking on every send. Use a sentinel
    // value (-1) since storage().get returns undefined for unset keys —
    // we want to distinguish "not resolved yet" from "resolved to nothing".
    await storage().set(SALES_MAILBOX_RESOLVED_FOR_KEY, lc);
    await storage().set(SALES_MAILBOX_ID_KEY, -1);
    return undefined;
  }
  // No match found across any group — same negative-cache treatment.
  await storage().set(SALES_MAILBOX_RESOLVED_FOR_KEY, lc);
  await storage().set(SALES_MAILBOX_ID_KEY, -1);
  return undefined;
}

/** Synchronous accessor for the cached sales-mailbox id. Returns the id when
 *  resolved successfully, undefined when not resolved or resolved-to-nothing
 *  (the sentinel -1 case). Used by render paths and by the on-send handler
 *  via the agent snapshot. */
export function getCachedSalesMailboxId(): number | undefined {
  const id = storage().get<number>(SALES_MAILBOX_ID_KEY);
  return typeof id === "number" && id > 0 ? id : undefined;
}

// ---------- Charge rates ----------

/** Halo lookup category that holds charge rates. */
const CHARGE_RATE_LOOKUP_ID = 17;

/** Read the charge-rate list out of ClientCache.lookups (lookupid 17).
 *  Returns "No Charge" (id 0) as a leading entry even when the tenant
 *  hasn't explicitly configured one — the compose timer defaults to
 *  no-charge and we want a stable picker option. */
export function getChargeRates(): HaloChargeRate[] {
  const cc = getCachedClientCache();
  const rows = (cc?.lookups ?? []).filter(
    (l) => l.lookupid === CHARGE_RATE_LOOKUP_ID,
  );
  const mapped: HaloChargeRate[] = rows.map((l) => ({
    id: l.id,
    name: l.name,
    colour: typeof l.custom2 === "string" ? l.custom2 : undefined,
  }));
  // Guarantee a No Charge option (id 0) at the top, even if Halo's tenant
  // config doesn't include one. The on-send payload omits chargerate_id
  // when 0 is selected, so this is purely a display affordance.
  if (!mapped.some((r) => r.id === 0)) {
    mapped.unshift({ id: 0, name: "No Charge" });
  }
  return mapped;
}

/**
 * Strip the agent's configured signature from an outbound email body.
 *
 * Pulls the signature from ClientCache.agent.signature and removes it via
 * exact substring match. Returns the body unchanged when:
 *   - ClientCache isn't loaded yet (use the synchronous accessor)
 *   - The agent hasn't configured a signature in Halo
 *   - The signature doesn't appear verbatim in the body (different rendering,
 *     edited send, attached at compose time differently)
 *
 * No regex / heuristics — false-positive stripping (removing real content)
 * would be worse than leaving the signature in.
 */
export function stripAgentSignature(bodyHtml: string): string {
  const cc = getCachedClientCache();
  const sig = cc?.agent?.signature;
  if (!sig || !bodyHtml) return bodyHtml;
  const idx = bodyHtml.indexOf(sig);
  if (idx === -1) return bodyHtml;
  return bodyHtml.slice(0, idx) + bodyHtml.slice(idx + sig.length);
}

// ---------- Write paths ----------

// Halo's write endpoints accept an array payload but inconsistently return
// the created/updated entity in one of THREE shapes depending on tenant
// version and endpoint:
//   1. Single object:        { id: 2381, ... }
//   2. Array of one:         [{ id: 2381, ... }]
//   3. Collection-wrapped:   { actions: [{ id: ... }] } or { tickets: [...] }
// Normalise all three to the entity itself.
function unwrapWriteResponse<T>(
  res: T | T[] | Record<string, unknown>,
  collectionKey?: string,
): T {
  if (Array.isArray(res)) return res[0];
  if (res && typeof res === "object") {
    if (collectionKey && Array.isArray((res as Record<string, unknown>)[collectionKey])) {
      return ((res as Record<string, unknown>)[collectionKey] as T[])[0];
    }
    // Fall through: the response IS the entity (case 1).
  }
  return res as T;
}

export async function appendAction(payload: CreateActionPayload): Promise<HaloAction> {
  const res = await call<HaloAction | HaloAction[] | { actions?: HaloAction[] }>("/Actions", {
    method: "POST",
    body: JSON.stringify([payload]),
  });
  return unwrapWriteResponse<HaloAction>(res, "actions");
}

export async function createTicket(payload: CreateTicketPayload): Promise<HaloTicket> {
  const res = await call<HaloTicket | HaloTicket[] | { tickets?: HaloTicket[] }>("/Tickets", {
    method: "POST",
    body: JSON.stringify([payload]),
  });
  return unwrapWriteResponse<HaloTicket>(res, "tickets");
}

/** Apply a partial update to an existing ticket (status / agent / priority / custom fields). */
export async function updateTicket(payload: UpdateTicketPayload): Promise<HaloTicket> {
  const res = await call<HaloTicket | HaloTicket[] | { tickets?: HaloTicket[] }>("/Tickets", {
    method: "POST",
    body: JSON.stringify([payload]),
  });
  return unwrapWriteResponse<HaloTicket>(res, "tickets");
}

/** Full client record — includes assigned account manager and other fields not in list results. */
export async function getClientDetails(clientId: number): Promise<HaloClient> {
  return await call<HaloClient>(`/Client/${clientId}`);
}

/**
 * Asynchronous stats for the contact dossier: open ticket count and last activity time.
 * Both calls are best-effort — any failure degrades gracefully to a zero count so the
 * dossier still renders the rest of its data.
 */
export async function getContactStats(
  userId: number,
): Promise<{ openTicketCount: number; lastActivityAt?: string }> {
  let openTicketCount = 0;
  let lastActivityAt: string | undefined;

  try {
    const q = new URLSearchParams({
      user_id: String(userId),
      open_only: "true",
      count: "true",
      pageinate: "false",
    });
    const res = await call<{ count?: number; tickets?: HaloTicket[] } | HaloTicket[]>(
      `/Tickets?${q}`,
    );
    if (Array.isArray(res)) {
      openTicketCount = res.length;
    } else if (typeof res.count === "number") {
      openTicketCount = res.count;
    } else if (Array.isArray(res.tickets)) {
      openTicketCount = res.tickets.length;
    }
  } catch {
    /* swallow — stats are decorative */
  }

  try {
    const q = new URLSearchParams({
      user_id: String(userId),
      count: "1",
      orderbydesc: "datetime",
      pageinate: "false",
    });
    const res = await call<{ actions?: HaloAction[] } | HaloAction[]>(`/Actions?${q}`);
    const arr = Array.isArray(res) ? res : res.actions ?? [];
    lastActivityAt = arr[0]?.datetime;
  } catch {
    /* swallow — stats are decorative */
  }

  return { openTicketCount, lastActivityAt };
}

/** Create a new contact (HaloPSA "user"). Mirrors createTicket's array-wrapped POST shape. */
export async function createContact(payload: CreateContactPayload): Promise<HaloUser> {
  const res = await call<HaloUser | HaloUser[] | { users?: HaloUser[] }>("/Users", {
    method: "POST",
    body: JSON.stringify([payload]),
  });
  return unwrapWriteResponse<HaloUser>(res, "users");
}

/**
 * Build a deep-link URL to a ticket in Halo's agent UI. Optionally jumps
 * directly to a specific action within the ticket via &action_id=N.
 * Returns undefined if the tenant config isn't loaded yet.
 */
export function ticketDeepLink(ticketId: number, actionId?: number): string | undefined {
  const halo = getConfig()?.haloBaseUrl;
  if (!halo) return undefined;
  const base = `${halo}/ticket?id=${ticketId}`;
  return actionId ? `${base}&action_id=${actionId}` : base;
}

// ---------- CRM notes (client/site/user-scoped activity) ----------

export interface CRMScope {
  /** Exactly one of these three should be set; whichever Halo entity the note belongs to. */
  client_id?: number;
  site_id?: number;
  user_id?: number;
}

function scopeToQuery(scope: CRMScope): URLSearchParams {
  const q = new URLSearchParams();
  if (scope.client_id) q.set("client_id", String(scope.client_id));
  if (scope.site_id) q.set("site_id", String(scope.site_id));
  if (scope.user_id) q.set("user_id", String(scope.user_id));
  return q;
}

export async function listCRMNotes(scope: CRMScope, count = 15): Promise<HaloCRMNote[]> {
  const q = scopeToQuery(scope);
  q.set("count", String(count));
  q.set("includehtmlnote", "true");
  q.set("includeattachments", "true");
  q.set("importanttop", "false");
  q.set("includereactions", "true");
  const res = await call<{ actions?: HaloCRMNote[] } | HaloCRMNote[]>(`/CRMNote?${q}`);
  return Array.isArray(res) ? res : res.actions ?? [];
}

export async function createCRMNote(payload: CreateCRMNotePayload): Promise<HaloCRMNote> {
  const res = await call<HaloCRMNote | { actions?: HaloCRMNote[] } | HaloCRMNote[]>("/CRMNote", {
    method: "POST",
    body: JSON.stringify([payload]),
  });
  if (Array.isArray(res)) return res[0];
  if (res && typeof res === "object" && "actions" in res && Array.isArray(res.actions)) {
    return res.actions[0];
  }
  return res as HaloCRMNote;
}

// ---------- Activity feed (cross-entity timeline) ----------

/**
 * Fetch the Halo activity feed for a client/site/user. The feed merges actions,
 * notes, status changes, and similar events across all entities related to the
 * scope — what you see on a Halo CRM overview page.
 *
 * The query keys are `related_*_id` rather than the bare `*_id` used elsewhere.
 */
export async function listFeed(scope: CRMScope, count = 20): Promise<HaloFeedItem[]> {
  const q = new URLSearchParams({ count: String(count) });
  if (scope.client_id) q.set("related_client_id", String(scope.client_id));
  if (scope.site_id) q.set("related_site_id", String(scope.site_id));
  if (scope.user_id) q.set("related_user_id", String(scope.user_id));
  const res = await call<HaloFeedResponse | HaloFeedItem[]>(`/Feed?${q}`);
  if (Array.isArray(res)) return res;
  return res.feed ?? [];
}

// ---------- Generic API escape hatch ----------

export interface HaloRawCallOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** Sent as a JSON body. Already-serialized strings are passed through. */
  body?: unknown;
  /** Appended as a URL-encoded query string. */
  query?: Record<string, string | number | boolean | undefined | null>;
}

/**
 * Direct passthrough to a Halo REST endpoint, sharing the same auth + 401
 * retry + error normalisation as every other call here.
 *
 * Use for endpoints we haven't written a typed wrapper for yet — handy for
 * MCP exploration where the agent needs to poke at an unwrapped surface, or
 * for one-off scripts. Prefer the typed functions where one exists.
 *
 * `path` must start with "/" and is appended to `<haloBaseUrl>/api`.
 */
export async function haloApiRaw<T = unknown>(
  path: string,
  opts: HaloRawCallOptions = {},
): Promise<T> {
  const { method = "GET", body, query } = opts;
  let fullPath = path;
  if (query) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null) params.set(k, String(v));
    }
    const qs = params.toString();
    if (qs) fullPath += (fullPath.includes("?") ? "&" : "?") + qs;
  }
  const init: RequestInit = { method };
  if (body !== undefined && body !== null) {
    init.body = typeof body === "string" ? body : JSON.stringify(body);
  }
  return call<T>(fullPath, init);
}

// ---------- Analytics: recurring invoices (MRR source) ----------

/**
 * HaloPSA recurring-invoice cadence (STDREQUEST.StdPeriod, surfaced as the REST
 * `period` field) → months-per-period and label. Mapping confirmed against a
 * Rising Tide Report Center report:
 *   1=Weekly · 2=Monthly · 3=Yearly · 4=Quarterly · 8=2-Yearly · 7=3-Yearly ·
 *   9=4-Yearly · else=5-Yearly.
 * MRR = per-period revenue × monthly factor, where factor = 1 / months-per-period
 * (weekly = 52/12). NOTE: an earlier mapping wrongly assumed 3=monthly, which
 * counted yearly contracts at 12× — fixed here.
 */
const PERIOD_INFO: Record<number, { label: string; factor: number }> = {
  1: { label: "weekly", factor: 52 / 12 },
  2: { label: "monthly", factor: 1 },
  3: { label: "yearly", factor: 1 / 12 },
  4: { label: "quarterly", factor: 1 / 3 },
  7: { label: "3-yearly", factor: 1 / 36 },
  8: { label: "2-yearly", factor: 1 / 24 },
  9: { label: "4-yearly", factor: 1 / 48 },
};
const FALLBACK_PERIOD = { label: "5-yearly", factor: 1 / 60 };

export function periodToMonthlyFactor(period: number | undefined): number {
  if (period === undefined) return 1; // missing cadence → assume already monthly
  return (PERIOD_INFO[period] ?? FALLBACK_PERIOD).factor;
}

export async function listRecurringInvoices(): Promise<HaloRecurringInvoice[]> {
  // /RecurringInvoice has no working date filter — fetch all, filter client-side.
  const res = await call<
    { invoices: HaloRecurringInvoice[] } | HaloRecurringInvoice[]
  >("/RecurringInvoice?pageinate=false&showcounts=true");
  return Array.isArray(res) ? res : res.invoices ?? [];
}

/**
 * Monthly Recurring Revenue from the ACTUAL generated recurring invoices, read
 * by calendar month — NOT a trailing-12-month average. The schedule's nominal
 * amount drifts and TTM/12 silently under-reports any tenant with under 12
 * months of billing history (a freshly migrated book reads ~half), so the
 * headline MRR is the recurring actually invoiced in the latest COMPLETE month,
 * with trailing months exposed for the multi-window read. Recurring is the
 * line-level discriminator `INVOICEDETAIL.idrecurringinvoiceid < -1` (-1 is the
 * "not recurring" sentinel), never the header bit.
 */
// Marked-recurring invoice LINES: generated (IHid>0), non-void, active line, and
// linked to a recurring template. Per the report methodology, recurring is the
// line-level `idrecurringinvoiceid < -1` discriminator (-1 is the "not recurring"
// sentinel — down payments / sales-order / ad-hoc), NOT the header bit. `ih`=
// INVOICEHEADER, `id`=INVOICEDETAIL aliases assumed.
const RECURRING_LINE =
  "ih.IHid > 0 and isnull(ih.ihvoided,0) = 0 and isnull(id.idisInactive,0) = 0 and id.idrecurringinvoiceid < -1";
// Net line revenue per the methodology (unit price × ordered qty).
const RECURRING_LINE_AMT = "id.IDUnit_Price * id.IDQty_Order";

/** [start,end) for the latest fully-elapsed calendar month plus its YYYY-MM label,
 *  and the first-of-month for the in-progress month (exclusive end). UTC. */
function latestCompleteMonth(): { start: string; end: string; label: string } {
  const now = new Date();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const firstOfThis = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const firstOfPrev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return { start: iso(firstOfPrev), end: iso(firstOfThis), label: iso(firstOfPrev).slice(0, 7) };
}

/**
 * MRR read from the ACTUAL marked-recurring invoices, not a TTM/12 average.
 * Headline `mrr` = recurring invoiced in the latest COMPLETE calendar month;
 * `recentMonths` carries the in-progress month (partial) plus trailing complete
 * months for the required multi-window read. `byClient` is per-client recurring
 * for that headline month. TTM/12 was removed — it under-reports any tenant with
 * under 12 months of billing history (a freshly migrated tenant reads ~half).
 */
export async function getMrrSnapshot(): Promise<MrrSnapshot> {
  const head = latestCompleteMonth();

  // Recurring billings by month: in-progress month + trailing 3 complete months.
  const seriesSql = `select year(ih.IHInvoice_Date) as yr, month(ih.IHInvoice_Date) as mo,
    cast(sum(${RECURRING_LINE_AMT}) as decimal(14,2)) as recurring,
    count(distinct ih.IHid) as invoices,
    count(distinct id.idrecurringinvoiceid) as streams
  from INVOICEHEADER ih
  join INVOICEDETAIL id on id.IdIHid = ih.IHid
  where ${RECURRING_LINE} and ih.IHInvoice_Date >= dateadd(month,-4,getdate())
  group by year(ih.IHInvoice_Date), month(ih.IHInvoice_Date)
  order by year(ih.IHInvoice_Date), month(ih.IHInvoice_Date)
  offset 0 rows`;

  // Per-client recurring for the headline (latest complete) month.
  const byClientSql = `select a.aarea as client_id, a.aareadesc as client,
    cast(sum(${RECURRING_LINE_AMT}) as decimal(14,2)) as recurring,
    count(distinct ih.IHid) as invoices
  from INVOICEHEADER ih
  join INVOICEDETAIL id on id.IdIHid = ih.IHid
  join area a on a.aarea = ih.IHaarea
  where ${RECURRING_LINE} and ih.IHInvoice_Date >= '${head.start}' and ih.IHInvoice_Date < '${head.end}'
  group by a.aarea, a.aareadesc
  order by sum(${RECURRING_LINE_AMT}) desc
  offset 0 rows`;

  const [seriesRows, clientRows] = await Promise.all([
    reportRows(seriesSql),
    reportRows(byClientSql),
  ]);

  const now = new Date();
  const curYm = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const recentMonths = seriesRows
    .map((r) => {
      const month = `${num(r.yr)}-${String(num(r.mo)).padStart(2, "0")}`;
      return { month, recurring: round2(num(r.recurring)), invoices: num(r.invoices), partial: month === curYm, streams: num(r.streams) };
    })
    .sort((a, b) => (a.month < b.month ? 1 : -1));

  const headRow = recentMonths.find((m) => m.month === head.label);
  const mrr = headRow ? headRow.recurring : 0;
  const recurringStreams = headRow ? headRow.streams : 0;

  const byClient = clientRows.map((r) => {
    const monthly = round2(num(r.recurring));
    return {
      clientId: num(r.client_id),
      client: String(r.client ?? ""),
      invoices: num(r.invoices),
      monthlyRevenue: monthly,
      pctOfMrr: mrr > 0 ? round2((monthly / mrr) * 100) : null,
    };
  });

  return {
    mrr,
    mrrMonth: head.label,
    recentMonths: recentMonths.map(({ streams: _s, ...m }) => m),
    recurringStreams,
    byClient,
    topClientPct: byClient.length > 0 ? byClient[0].pctOfMrr : null,
    presentation:
      "MRR = recurring actually invoiced in the latest COMPLETE calendar month (mrrMonth), from marked-recurring invoice LINES (idrecurringinvoiceid < -1) — real invoiced amounts, NOT a TTM/12 average (that under-reports any tenant with <12 months of billing). recentMonths gives the in-progress month (partial) + trailing complete months — use it for the required multi-window read before calling any direction a trend; recurring billing is lumpy (quarterly/annual contracts land in one month), so do not read a single month as the run-rate without the trailing context. byClient is per-client recurring for mrrMonth (clients on non-monthly cadence appear only in their billing month). topClientPct = biggest client's share that month. runSql for invoice-line detail / longer history.",
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ---------- Analytics: timesheets (utilization source) ----------

/**
 * Halo's /Timesheet endpoint returns a flat array — no `.timesheets` wrapper,
 * no `record_count`. Date params `startdate` / `enddate` are YYYY-MM-DD.
 */
export async function listTimesheets(
  startdate: string,
  enddate: string,
): Promise<HaloTimesheet[]> {
  const q = new URLSearchParams({ startdate, enddate });
  const res = await call<HaloTimesheet[] | { timesheets?: HaloTimesheet[] }>(
    `/Timesheet?${q}`,
  );
  if (Array.isArray(res)) return res;
  return res.timesheets ?? [];
}

/**
 * Total chargeable / target hours × 100, plus per-agent breakdown.
 * Window defaults to the trailing 30 days when start/end aren't supplied.
 */
export async function getTechnicianUtilizationSnapshot(
  startdate?: string,
  enddate?: string,
): Promise<UtilizationSnapshot> {
  const { start, end } = resolveWindow(startdate, enddate, 30);
  const [rows, agents] = await Promise.all([
    listTimesheets(start, end),
    listAgents().catch(() => [] as HaloAgent[]),
  ]);
  const agentNameById = new Map(agents.map((a) => [a.id, a.name]));

  let totalChargeable = 0;
  let totalTarget = 0;
  const perAgentMap = new Map<number, { chargeable: number; target: number }>();
  for (const r of rows) {
    const chargeable = r.chargeable_hours ?? 0;
    const target = r.target_hours ?? 0;
    totalChargeable += chargeable;
    totalTarget += target;
    if (r.agent_id != null) {
      const b = perAgentMap.get(r.agent_id) ?? { chargeable: 0, target: 0 };
      b.chargeable += chargeable;
      b.target += target;
      perAgentMap.set(r.agent_id, b);
    }
  }
  const perAgent = Array.from(perAgentMap.entries())
    .map(([agent_id, b]) => ({
      agent_id,
      agent_name: agentNameById.get(agent_id),
      chargeable: round2(b.chargeable),
      target: round2(b.target),
      rate: b.target > 0 ? round2((b.chargeable / b.target) * 100) : null,
    }))
    .sort((a, b) => (b.rate ?? 0) - (a.rate ?? 0));

  return {
    startdate: start,
    enddate: end,
    totalChargeableHours: round2(totalChargeable),
    totalTargetHours: round2(totalTarget),
    utilizationRate: totalTarget > 0 ? round2((totalChargeable / totalTarget) * 100) : null,
    perAgent,
  };
}

function resolveWindow(
  startdate: string | undefined,
  enddate: string | undefined,
  fallbackDays: number,
): { start: string; end: string } {
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  const end = enddate ?? fmt(new Date());
  const startFallback = new Date();
  startFallback.setUTCDate(startFallback.getUTCDate() - fallbackDays);
  const start = startdate ?? fmt(startFallback);
  return { start, end };
}

// ---------- Analytics: contracts ----------

export async function listContracts(): Promise<HaloContract[]> {
  const res = await call<
    { contracts: HaloContract[] } | HaloContract[]
  >("/ClientContract?pageinate=false&showcounts=true");
  return Array.isArray(res) ? res : res.contracts ?? [];
}

// ---------- Analytics: opportunities ----------

export async function listOpportunities(limit = 100): Promise<HaloOpportunity[]> {
  const q = new URLSearchParams({
    pageinate: "false",
    count: String(limit),
    showcounts: "true",
  });
  // /Opportunities is the correct path (plural); /Opportunity 404s.
  const res = await call<
    { opportunities: HaloOpportunity[] } | { tickets: HaloOpportunity[] } | HaloOpportunity[]
  >(`/Opportunities?${q}`);
  if (Array.isArray(res)) return res;
  if ("opportunities" in res && Array.isArray(res.opportunities)) return res.opportunities;
  if ("tickets" in res && Array.isArray(res.tickets)) return res.tickets;
  return [];
}

// ---------- Analytics: active user count (for MRR/seat) ----------

/** Fetch all active external contacts. Used for seat-count KPIs. */
export async function listActiveUsers(limit = 1000): Promise<HaloUser[]> {
  const q = new URLSearchParams({
    pageinate: "false",
    includeinactive: "false",
    count: String(limit),
  });
  const res = await call<{ users: HaloUser[] } | HaloUser[]>(`/Users?${q}`);
  const arr = Array.isArray(res) ? res : res.users ?? [];
  return arr.filter((u) => u.inactive !== true);
}

// ---------- Composite KPI tools ----------

/** MRR ÷ active agent count. Returns 0 if there are no active agents. */
export async function getRevenuePerTechSnapshot(): Promise<{
  mrr: number;
  activeAgentCount: number;
  revenuePerTech: number;
  agents: { id: number; name: string }[];
  mrrByClient: MrrSnapshot["byClient"];
  presentation: string;
}> {
  const [mrrSnap, agents] = await Promise.all([
    getMrrSnapshot(),
    listAgents(),
  ]);
  const activeAgentCount = agents.length;
  const revenuePerTech =
    activeAgentCount > 0 ? round2(mrrSnap.mrr / activeAgentCount) : 0;
  return {
    mrr: mrrSnap.mrr,
    activeAgentCount,
    revenuePerTech,
    agents: agents.map((a) => ({ id: a.id, name: a.name })),
    mrrByClient: mrrSnap.byClient,
    presentation:
      "revenuePerTech is a CAPACITY ratio (mrr ÷ headcount), NOT revenue attributed to each tech — MRR isn't tech-attributable. Dashboard: show the ratio, then the agent roster (who's counted) and mrrByClient (where the revenue actually comes from). Answer 'who are the techs' from agents[] and 'which clients fund it' from mrrByClient[] — no re-query needed. For per-tech billable output use getTechnicianUtilization / getTechnicianScorecard instead.",
  };
}

/** Active managed user seats = billable users: external users that are active
 *  (uinactive=0), not service accounts (uisserviceaccount=0), not flagged out of
 *  automated billing (uignoreautomatedbilling=0), excluding the per-client
 *  "General User" placeholder (named per settings; ~1 per client). */
const USER_SEAT_FILTER =
  "coalesce(u.uinactive,0)=0 and coalesce(u.uisserviceaccount,0)=0 and coalesce(u.uignoreautomatedbilling,0)=0 and u.uusername not like 'General%'";

async function countUserSeats(): Promise<number> {
  const rows = await reportRows(`select count(*) as n from USERS u where ${USER_SEAT_FILTER}`);
  return num(rows[0]?.n);
}

/** MRR ÷ managed seats — both ways (users and assets). */
export async function getMrrPerSeatSnapshot(): Promise<{
  mrr: number;
  userSeats: number;
  assetSeats: number;
  mrrPerUserSeat: number;
  mrrPerAssetSeat: number;
  seatsByClient: { clientId: number; client: string; userSeats: number; assetSeats: number; pctOfUserSeats: number | null }[];
  presentation: string;
}> {
  const userSql = `select u.uarea as client_id, max(a.aareadesc) as client, count(*) as user_seats from USERS u join area a on a.aarea = u.uarea where ${USER_SEAT_FILTER} group by u.uarea`;
  const assetSql = `select d.darea as client_id, max(a.aareadesc) as client, count(*) as asset_seats from DEVICE d join area a on a.aarea = d.darea where coalesce(d.dinactive,0)=0 group by d.darea`;
  const [mrrSnap, userRows, assetRows] = await Promise.all([
    getMrrSnapshot(),
    reportRows(userSql),
    reportRows(assetSql),
  ]);
  const merged = new Map<number, { client: string; userSeats: number; assetSeats: number }>();
  for (const r of userRows) {
    const cid = num(r.client_id);
    const m = merged.get(cid) ?? { client: String(r.client ?? ""), userSeats: 0, assetSeats: 0 };
    m.userSeats = num(r.user_seats);
    merged.set(cid, m);
  }
  for (const r of assetRows) {
    const cid = num(r.client_id);
    const m = merged.get(cid) ?? { client: String(r.client ?? ""), userSeats: 0, assetSeats: 0 };
    m.assetSeats = num(r.asset_seats);
    if (!m.client) m.client = String(r.client ?? "");
    merged.set(cid, m);
  }
  const userSeats = userRows.reduce((s, r) => s + num(r.user_seats), 0);
  const assetSeats = assetRows.reduce((s, r) => s + num(r.asset_seats), 0);
  const seatsByClient = Array.from(merged.entries())
    .map(([clientId, m]) => ({
      clientId,
      client: m.client,
      userSeats: m.userSeats,
      assetSeats: m.assetSeats,
      pctOfUserSeats: userSeats > 0 ? round2((m.userSeats / userSeats) * 100) : null,
    }))
    .sort((a, b) => b.userSeats - a.userSeats);
  return {
    mrr: mrrSnap.mrr,
    userSeats,
    assetSeats,
    mrrPerUserSeat: userSeats > 0 ? round2(mrrSnap.mrr / userSeats) : 0,
    mrrPerAssetSeat: assetSeats > 0 ? round2(mrrSnap.mrr / assetSeats) : 0,
    seatsByClient,
    presentation:
      "Seats reflected BOTH ways: userSeats = active end-users EXCLUDING service accounts and the per-client 'General User' placeholder (~1/client — a big exclusion); assetSeats = active devices. mrrPerUserSeat / mrrPerAssetSeat are MRR ÷ each. Dashboard: show both ratios, then seatsByClient (userSeats + assetSeats + pctOfUserSeats per client). Answer 'how many seats per client', 'which clients have the most users/devices' from seatsByClient[] directly. Note: this tenant tracks few devices, so user-seats is the meaningful number.",
  };
}

/**
 * One-shot "give me everything" KPI tool. Cheaper than running each composite
 * separately because MRR is computed once and shared. Utilization defaults to
 * the trailing 30 days and is best-effort — failures degrade silently so a
 * dashboard never goes blank because Timesheet is unavailable.
 */
export async function getMspKpis(
  utilizationStart?: string,
  utilizationEnd?: string,
): Promise<MspKpis> {
  const [mrrSnap, agents, userSeats, utilization] = await Promise.all([
    getMrrSnapshot(),
    listAgents().catch(() => [] as HaloAgent[]),
    countUserSeats().catch(() => 0),
    getTechnicianUtilizationSnapshot(utilizationStart, utilizationEnd).catch(
      () => undefined,
    ),
  ]);
  const activeAgentCount = agents.length;
  const activeUserCount = userSeats;
  return {
    mrr: mrrSnap.mrr,
    activeAgentCount,
    activeUserCount,
    revenuePerTech:
      activeAgentCount > 0 ? round2(mrrSnap.mrr / activeAgentCount) : 0,
    mrrPerSeat:
      activeUserCount > 0 ? round2(mrrSnap.mrr / activeUserCount) : 0,
    utilization,
    mrrByClient: mrrSnap.byClient.slice(0, 25),
    presentation:
      "One-shot MSP dashboard. Lead with mrr, activeAgentCount, activeUserCount (managed seats — excludes service accounts + the per-client 'General User' placeholder), revenuePerTech (capacity ratio, not per-tech attribution), mrrPerSeat. Then mrrByClient (top 25 — revenue concentration) and utilization.perAgent (each tech's chargeable vs target). Answer follow-ups (top clients, who's under/over-utilised, concentration) from mrrByClient[] and utilization.perAgent[] directly; reach for getMrrSnapshot / getTechnicianUtilization for the full lists, runSql only for detail beyond these.",
  };
}

// ---------- Report Center: ad-hoc SQL ----------

/**
 * Execute a SELECT statement against the HaloPSA database via Halo's Report
 * Center. POST /api/Report with `sql` and `_loadreportonly: true` runs the
 * query inline without persisting a saved report. Omit `_loadreportonly` and
 * pass `name` + `folder_id` to persist for reuse.
 *
 * Halo Report Center constraints (the SQL itself):
 *  - one statement only
 *  - no `--` single-line comments (use slash-star block comments)
 *  - no trailing semicolons
 *  - no variables / DECLARE
 *
 * The response shape varies — Halo returns the saved (or ephemeral) report
 * record plus a `report` or `results`/`rows` array. Callers should treat the
 * full body as opaque and let the MCP tool surface it whole.
 */
export interface RunSqlOptions {
  /** Persist as a saved report instead of running inline. Only meaningful for
   *  a single SQL statement — ignored when an array is passed. */
  save?: { name: string; folder_id?: number };
}

/**
 * Run one or more SQL statements through Halo's Report Center.
 *
 * Halo's `/api/Report` endpoint always expects an array body — even for a
 * single report — and returns an array of one result per query in the same
 * order. Pass a string for the common single-query case (we'll return the
 * single result unwrapped) or pass an array of strings to run several in
 * parallel server-side and get the full array back.
 *
 * Batching is useful when an agent needs several uncorrelated datasets at
 * once — e.g. "MRR rollup AND top 10 overdue tickets AND license expiry list"
 * — and a single SQL JOIN can't express them. One HTTP round-trip, all
 * results back together.
 */
export async function runReportSql(
  sql: string | string[],
  opts: RunSqlOptions = {},
): Promise<unknown> {
  const queries = Array.isArray(sql) ? sql : [sql];
  const isBatch = Array.isArray(sql);

  const body = queries.map((q, idx) => {
    const item: Record<string, unknown> = { sql: q };
    if (opts.save && !isBatch && idx === 0) {
      item.name = opts.save.name;
      if (opts.save.folder_id != null) item.folder_id = opts.save.folder_id;
    } else {
      item._loadreportonly = true;
    }
    return item;
  });

  const res = await call<unknown>("/Report", {
    method: "POST",
    body: JSON.stringify(body),
  });

  // Halo returns an array of results in the same order as the request. For
  // single-query input, unwrap to the lone result so callers don't have to
  // deal with the array.
  if (!isBatch && Array.isArray(res) && res.length > 0) {
    return res[0];
  }
  return res;
}

/** List existing saved reports — names, ids, folder placement.
 *  Useful so the agent can reuse an MSP's existing analysis instead of
 *  reinventing it on every question. */
export async function listReports(): Promise<unknown[]> {
  const res = await call<unknown>("/Report?pageinate=false");
  if (Array.isArray(res)) return res;
  if (res && typeof res === "object") {
    const obj = res as Record<string, unknown>;
    if (Array.isArray(obj.reports)) return obj.reports as unknown[];
  }
  return [];
}

export interface ReportDefinition {
  id: number;
  name: string;
  group: string | null;
  /** Halo's primary entity for the report — almost always a DB table name
   *  (e.g. "Faults" = FAULTS), a handy bridge from REST naming to the schema. */
  mainEntity: string | null;
  sql: string | null;
  usesDynamicSql: boolean;
  /** Whether the report's SQL actually runs right now. A report with
   *  `validates.error` (or hand-edited/dynamic SQL) is NOT a trustworthy worked
   *  example — read it for ideas, but verify the logic and columns before reuse. */
  validates: { loaded: boolean; error: string | null };
}

/**
 * Fetch one saved report's full definition, including its SQL, so the query can
 * be read and learned from (Guideline 6: reverse-engineer from existing
 * reports). The GET auto-runs the report, so we surface whether it currently
 * loads (validates) as a real-or-broken signal — don't trust a report blindly.
 * The bulky column / permission / schedule / chart metadata and the rendered
 * table_html are dropped.
 */
export async function getReport(id: number): Promise<ReportDefinition> {
  const r = await call<Record<string, unknown>>(
    `/Report/${Math.trunc(id)}?includedetails=true`,
  );
  const run = (r.report ?? {}) as { loaded?: boolean; load_error?: string };
  return {
    id: num(r.id),
    name: String(r.name ?? ""),
    group: r.group_name ? String(r.group_name) : null,
    mainEntity: r.mainentity ? String(r.mainentity) : null,
    sql: r.sql != null ? String(r.sql) : null,
    usesDynamicSql: Boolean(r.usesdynamicsql),
    validates: {
      loaded: Boolean(run.loaded),
      error: run.load_error ? String(run.load_error) : null,
    },
  };
}

// ---------- Report Center: schema discovery ----------
//
// `exploreSchema` is the "learn the database before you query it" tool. Halo's
// schema is huge and uses 25-year-old NetHelpDesk naming, so the right flow is
// to discover tables → inspect a table's columns → look at real sample rows,
// THEN write the report query. All three actions run through Report Center (the
// same SELECT path as runSql) with the ORDER-BY-needs-OFFSET gotcha handled and
// the table identifier validated.

/** Bare SQL identifier (table name) — letters, digits, underscore. Guards the
 *  one place we interpolate a name into a FROM/WHERE clause. */
const SQL_IDENTIFIER_RE = /^[A-Za-z0-9_]+$/;

export interface SchemaExploreResult {
  action: string;
  /** The exact SQL run — surfaced so the caller learns the idioms. */
  sql: string;
  rowCount: number;
  rows: Record<string, unknown>[];
  note: string;
}

/**
 * Schema discovery for Halo's database. Three actions:
 *  - "tables":  list base-table names (optionally filtered by a name substring).
 *  - "columns": list one table's columns + types (pass `table`), OR search
 *               column names across every table (pass `filter`).
 *  - "sample":  `select top N *` from a table (optionally with a `where`), to
 *               see real values and reverse-engineer which column holds what.
 */
export async function exploreSchema(opts: {
  action: "tables" | "columns" | "sample";
  table?: string;
  filter?: string;
  where?: string;
  limit?: number;
}): Promise<SchemaExploreResult> {
  const { action } = opts;
  const table = opts.table?.trim();
  const filter = opts.filter?.trim();
  const where = opts.where?.trim();
  const lit = (s: string) => s.replace(/'/g, "''");

  if (table && !SQL_IDENTIFIER_RE.test(table)) {
    throw new HaloApiError(
      400,
      `Invalid table name '${table}' — letters, digits and underscore only.`,
    );
  }

  if (action === "tables") {
    const cap = Math.max(1, Math.min(2000, Math.trunc(opts.limit ?? 500)));
    const like = filter ? ` and TABLE_NAME like '%${lit(filter)}%'` : "";
    const sql = `select TABLE_NAME from INFORMATION_SCHEMA.TABLES where TABLE_TYPE = 'BASE TABLE'${like} order by TABLE_NAME offset 0 rows fetch next ${cap} rows only`;
    const rows = await reportRows(sql);
    return {
      action,
      sql,
      rowCount: rows.length,
      rows,
      note: filter
        ? `Base tables whose name contains '${filter}'. Halo idioms: tickets/projects/opportunities all live in FAULTS; notes/time/emails in ACTIONS; clients in AREA; sites in SITE; contacts in USERS; agents in UNAME; assets in DEVICE.`
        : `First ${cap} base tables (names only). Narrow with a 'filter' substring — Guideline 7, always filter first. Tickets = FAULTS, notes/time/emails = ACTIONS, assets = DEVICE.`,
    };
  }

  if (action === "columns") {
    if (!table && !filter) {
      throw new HaloApiError(
        400,
        "exploreSchema columns needs either 'table' (list that table's columns) or 'filter' (search column names across all tables).",
      );
    }
    if (table) {
      const sql = `select COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH as max_len, IS_NULLABLE as nullable from INFORMATION_SCHEMA.COLUMNS where TABLE_NAME = '${lit(table)}' order by ORDINAL_POSITION offset 0 rows`;
      const rows = await reportRows(sql);
      return {
        action,
        sql,
        rowCount: rows.length,
        rows,
        note: `Columns of ${table}. Guideline 3: a column's prefix marks its origin table (e.g. SArea on SITE → AREA; USite on USERS → SITE; QHID → quotation header). Guideline 4: a primary key reused elsewhere (faultid, aarea, DID, UID…) is your join key. Use action 'sample' to see real values.`,
      };
    }
    const cap = Math.max(1, Math.min(2000, Math.trunc(opts.limit ?? 300)));
    const sql = `select TABLE_NAME, COLUMN_NAME, DATA_TYPE from INFORMATION_SCHEMA.COLUMNS where COLUMN_NAME like '%${lit(filter!)}%' order by TABLE_NAME, COLUMN_NAME offset 0 rows fetch next ${cap} rows only`;
    const rows = await reportRows(sql);
    return {
      action,
      sql,
      rowCount: rows.length,
      rows,
      note: `Columns across all tables whose NAME contains '${filter}' — the agent equivalent of Halo's "Database Tables & Columns" schema report (Guideline 7). To find a column by its VALUE instead (Guideline 8), use action 'sample' with a 'where' that pins a row you recognise.`,
    };
  }

  if (action === "sample") {
    if (!table) {
      throw new HaloApiError(400, "exploreSchema sample needs a 'table'.");
    }
    const top = Math.max(1, Math.min(25, Math.trunc(opts.limit ?? 5)));
    const whereSql = where ? ` where ${where}` : "";
    const sql = `select top ${top} * from ${table}${whereSql}`;
    const rows = await reportRows(sql);
    return {
      action,
      sql,
      rowCount: rows.length,
      rows,
      note: `Top ${top} row(s) of ${table}${where ? ` where ${where}` : ""}. Guideline 8: if you know a real-world value (asset tag, email, ticket subject) put it in 'where' to pull that row, then read across the columns to find which one stores it (e.g. an asset's tag turned out to live in DEVICE.INVNO).`,
    };
  }

  throw new HaloApiError(400, `Unknown exploreSchema action '${String(action)}'.`);
}

// ---------- Service-delivery KPIs (SQL-backed) ----------
//
// These compose Halo's Report Center (runReportSql) into canonical MSP
// service-delivery metrics so callers don't have to re-derive the schema each
// time. Schema idioms used throughout (Halo's 25-year-old internal naming):
//   FAULTS            = tickets. faultid = ticket number.
//   FAULTS.areaint    -> AREA.aarea           (the client/company; aareadesc = name)
//   FAULTS.assignedtoint / clearwhoint -> UNAME.unum  (agent; uname = name)
//   FAULTS.status     -> TSTATUS.Tstatus      (tstatusdesc = label; TstatusType 0 = open)
//   FAULTS.RequestTypeNew -> REQUESTTYPE.RTid (RTIsProject / RTIsOpportunity flags)
//   Slastate / Fslafirstresponsestate: 'I' = in SLA (met), 'O' = out (breached), '' = no SLA
//   datecleared empty (NULL or < 1900) = ticket still open
//   fdeleted = fmergedintofaultid           = the "not deleted AND not merged" idiom
//   dateoccured is the real ticket-open timestamp — NOT datecreated, which is a row
//     metadata stamp that post-dates clearance on ~95% of tickets (negative durations).
//   cleartime is Halo's working-DAYS SLA duration; we report wall-clock MTTR via
//     DATEDIFF(dateoccured -> datecleared) instead, which is intuitive and never negative.
//   faisatisfactionlevel = AI CSAT (~1–10); SatisfactionLevel = native survey (usually sparse)

/** Run a SELECT and return its result rows as plain objects, throwing on a
 *  Report Center load error. Report cell values come back as strings. */
async function reportRows(sql: string): Promise<Record<string, unknown>[]> {
  const res = (await runReportSql(sql)) as {
    report?: { loaded?: boolean; load_error?: string; rows?: Record<string, unknown>[] };
  };
  const report = res?.report;
  if (report?.load_error) {
    throw new HaloApiError(400, `Report SQL failed: ${report.load_error}`);
  }
  return report?.rows ?? [];
}

function num(v: unknown): number {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : 0;
}

/** Coerce to a rounded number, or null when the source value is absent (Halo
 *  returns null/"" for AVG over an empty cohort). */
function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = parseFloat(String(v));
  return Number.isFinite(n) ? round2(n) : null;
}

/** Home/base currency code (the CURRENCY row with rate 1.0). Amounts in Halo
 *  are stored in the home currency, so tools surface this rather than assume a
 *  symbol. Cached for the process. */
let baseCurrencyCache: string | null = null;
async function baseCurrency(): Promise<string> {
  if (baseCurrencyCache) return baseCurrencyCache;
  const rows = await reportRows("select top 1 Ccode as code from CURRENCY order by abs(Crate - 1.0)");
  baseCurrencyCache = (String(rows[0]?.code ?? "").trim() || "USD");
  return baseCurrencyCache;
}

function attainment(met: unknown, breached: unknown): SlaAttainment {
  const m = num(met);
  const b = num(breached);
  const denom = m + b;
  return { met: m, breached: b, attainmentPct: denom > 0 ? round2((m / denom) * 100) : null };
}

function rate(part: number, whole: number): number | null {
  return whole > 0 ? round2((part / whole) * 100) : null;
}

/** Day after `end` (YYYY-MM-DD) so window comparisons can use an exclusive `<`
 *  upper bound and include the whole final day. */
function exclusiveEnd(end: string): string {
  const d = new Date(`${end}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Excludes "closed-on-creation" stub tickets (e.g. Halo "Quick Time" time-log
 * entries) from service-delivery metrics: a ticket that was closed at the same
 * instant it was opened (`datecleared == dateoccured`) was never serviced. Real
 * closed tickets (`datecleared > dateoccured`) and any still-open ticket are
 * kept. These stubs can dominate a tenant (~96% of the "reactive" set here) and
 * drag every duration toward zero, so they're filtered everywhere. Note: time
 * logged on stubs still counts towards technician hours — that comes from
 * ACTIONS, not this ticket filter.
 */
const NOT_STUB =
  "(f.datecleared > f.dateoccured or f.datecleared is null or f.datecleared < '1900-01-01')";

/** FAULTS "live ticket" predicate — the standard exclusion that must guard
 *  EVERY query reading FAULTS: not soft-deleted AND not merged into another
 *  ticket (Halo's `fdeleted = fmergedintofaultid` idiom; merged tickets carry
 *  the target id in both columns). `alias` is the FAULTS table alias (e.g.
 *  "f", "fa", "fb", "o"). */
function liveFault(alias: string): string {
  return `coalesce(${alias}.fdeleted,0) = coalesce(${alias}.fmergedintofaultid,0)`;
}

/** AGENT (UNAME) "real agent" predicate — the standard exclusion for staff
 *  rollups: drop API/bot agents and the Unassigned pseudo-agent (unum=1).
 *  `alias` is the UNAME table alias (e.g. "u"). */
function realAgentFilter(alias: string): string {
  return `coalesce(${alias}.uisapiagent,0) = 0 and ${alias}.unum <> 1`;
}

/** SQL fragments shared by the windowed service-delivery queries. */
function deliverySql(start: string, end: string, scope: TicketScope, clientId?: number) {
  const ex = exclusiveEnd(end);
  const filters = [
    liveFault("f"),
    NOT_STUB,
    // Reactive = standard ITIL Incident (1) + Service Request (3) on the ticket
    // itself (FAULTS.RequestType). For a professional-services shop this is a
    // small slice — most work is projects/opportunities.
    scope === "reactive" ? "f.RequestType in (1,3)" : "",
    clientId != null ? `f.areaint = ${Math.trunc(clientId)}` : "",
  ]
    .filter(Boolean)
    .join(" and ");
  return {
    join: "",
    filters,
    createdIn: `f.dateoccured >= '${start}' and f.dateoccured < '${ex}'`,
    clearedIn: `f.datecleared >= '${start}' and f.datecleared < '${ex}'`,
    open: `(f.datecleared is null or f.datecleared < '1900-01-01')`,
  };
}

/**
 * One-shot service-desk health snapshot for a window (defaults to trailing 30
 * days). Volume in/out, current open backlog + live breaches, first-response &
 * resolution SLA attainment, mean time to resolve, first-time-fix rate, and
 * CSAT (AI + native). Optionally scoped to a single client. See ServiceDeskHealth
 * for which cohort each metric is measured on.
 */
export async function getServiceDeskHealth(
  startdate?: string,
  enddate?: string,
  scope: TicketScope = "reactive",
  clientId?: number,
): Promise<ServiceDeskHealth> {
  const { start, end } = resolveWindow(startdate, enddate, 30);
  const s = deliverySql(start, end, scope, clientId);
  const sql = `select
  sum(case when ${s.createdIn} then 1 else 0 end) as inflow,
  sum(case when ${s.clearedIn} then 1 else 0 end) as outflow,
  sum(case when ${s.open} then 1 else 0 end) as open_now,
  sum(case when ${s.open} and f.Slastate = 'O' then 1 else 0 end) as breaching_now,
  sum(case when ${s.createdIn} and f.Fslafirstresponsestate = 'I' then 1 else 0 end) as frt_met,
  sum(case when ${s.createdIn} and f.Fslafirstresponsestate = 'O' then 1 else 0 end) as frt_breach,
  sum(case when ${s.clearedIn} and f.Slastate = 'I' then 1 else 0 end) as fix_met,
  sum(case when ${s.clearedIn} and f.Slastate = 'O' then 1 else 0 end) as fix_breach,
  avg(case when ${s.clearedIn} then datediff(minute, f.dateoccured, f.datecleared) / 60.0 end) as mttr_hours,
  sum(case when ${s.clearedIn} and f.fFirstTimeFix = 1 then 1 else 0 end) as ftf,
  avg(case when ${s.createdIn} and f.faisatisfactionlevel > 0 then cast(f.faisatisfactionlevel as float) end) as ai_csat,
  sum(case when ${s.createdIn} and f.faisatisfactionlevel > 0 then 1 else 0 end) as ai_csat_n,
  avg(case when ${s.createdIn} and f.SatisfactionLevel > 0 then cast(f.SatisfactionLevel as float) end) as nat_csat,
  sum(case when ${s.createdIn} and f.SatisfactionLevel > 0 then 1 else 0 end) as nat_csat_n
from faults f
${s.join}
where ${s.filters} and ((${s.createdIn}) or (${s.clearedIn}) or ${s.open})`;

  const row = (await reportRows(sql))[0] ?? {};
  const inflow = num(row.inflow);
  const outflow = num(row.outflow);
  const ftf = num(row.ftf);
  return {
    window: { startdate: start, enddate: end, scope, clientId },
    inflow,
    outflow,
    netBacklogChange: inflow - outflow,
    openBacklogNow: num(row.open_now),
    breachingNow: num(row.breaching_now),
    resolvedCohort: outflow,
    firstResponseSla: attainment(row.frt_met, row.frt_breach),
    resolutionSla: attainment(row.fix_met, row.fix_breach),
    meanTimeToResolveHours: numOrNull(row.mttr_hours),
    firstTimeFixCount: ftf,
    firstTimeFixRate: rate(ftf, outflow),
    csat: {
      ai: { avg: numOrNull(row.ai_csat), responses: num(row.ai_csat_n), scale: "1-10 (AI-derived)" },
      native: { avg: numOrNull(row.nat_csat), responses: num(row.nat_csat_n) },
    },
  };
}

/**
 * Per-technician performance scorecard for a window (defaults to trailing 30
 * days), grouped by the agent who closed each resolved ticket. Returns tickets
 * resolved, mean time to resolve, SLA attainment, first-time-fix, AI CSAT, and
 * hours logged / billable. hoursLogged is also split by ITIL type
 * (FAULTS.requesttype): hoursReactive (Incident+Service Request 1,3 — matches the
 * default reactive ticket scope), hoursProject (22/23/24), hoursProblem (4),
 * hoursAdmin (Advice/Other 21 + non-ticket time). Sorted by tickets resolved,
 * capped at `limit` (25).
 */
export async function getTechnicianScorecard(
  startdate?: string,
  enddate?: string,
  scope: TicketScope = "reactive",
  limit = 25,
): Promise<TechnicianScorecard> {
  const { start, end } = resolveWindow(startdate, enddate, 30);
  const ex = exclusiveEnd(end);
  const s = deliverySql(start, end, scope);
  const top = Math.max(1, Math.trunc(limit));
  const sql = `select top ${top}
  u.unum as agent_id,
  u.uname as agent,
  count(*) as resolved,
  avg(datediff(minute, f.dateoccured, f.datecleared) / 60.0) as mttr_hours,
  sum(case when f.Slastate = 'I' then 1 else 0 end) as fix_met,
  sum(case when f.Slastate = 'O' then 1 else 0 end) as fix_breach,
  sum(case when f.Fslafirstresponsestate = 'I' then 1 else 0 end) as frt_met,
  sum(case when f.Fslafirstresponsestate = 'O' then 1 else 0 end) as frt_breach,
  sum(case when f.fFirstTimeFix = 1 then 1 else 0 end) as ftf,
  avg(case when f.faisatisfactionlevel > 0 then cast(f.faisatisfactionlevel as float) end) as ai_csat,
  sum(case when f.faisatisfactionlevel > 0 then 1 else 0 end) as csat_n,
  max(act.hrs_logged) as hrs_logged,
  max(act.hrs_billable) as hrs_billable,
  max(act.hrs_reactive) as hrs_reactive,
  max(act.hrs_project) as hrs_project,
  max(act.hrs_problem) as hrs_problem,
  max(act.hrs_admin) as hrs_admin
from faults f
join uname u on f.clearwhoint = u.unum
${s.join}
left join (
  select ac.whoagentid,
    sum(ac.timetaken) as hrs_logged,
    sum(coalesce(ac.actionchargehours,0) + coalesce(ac.actionnonchargehours,0) + coalesce(ac.actionprepayhours,0)) as hrs_billable,
    sum(case when f2.RequestType in (1,3) then ac.timetaken else 0 end) as hrs_reactive,
    sum(case when f2.RequestType in (22,23,24) then ac.timetaken else 0 end) as hrs_project,
    sum(case when f2.RequestType = 4 then ac.timetaken else 0 end) as hrs_problem,
    sum(case when coalesce(f2.RequestType,0) not in (1,3,4,22,23,24) then ac.timetaken else 0 end) as hrs_admin
  from actions ac left join faults f2 on f2.faultid = ac.faultid
  where ac.ActionDateCreated >= '${start}' and ac.ActionDateCreated < '${ex}'
  group by ac.whoagentid
) act on act.whoagentid = f.clearwhoint
where ${s.filters} and ${realAgentFilter("u")} and (${s.clearedIn})
group by u.unum, u.uname
order by count(*) desc`;

  const rows = await reportRows(sql);
  const technicians: TechnicianScorecardRow[] = rows.map((r) => {
    const resolved = num(r.resolved);
    const ftf = num(r.ftf);
    return {
      agentId: num(r.agent_id),
      agent: String(r.agent ?? ""),
      resolved,
      meanTimeToResolveHours: numOrNull(r.mttr_hours),
      resolutionSla: attainment(r.fix_met, r.fix_breach),
      firstResponseSla: attainment(r.frt_met, r.frt_breach),
      firstTimeFixCount: ftf,
      firstTimeFixRate: rate(ftf, resolved),
      aiCsatAvg: numOrNull(r.ai_csat),
      csatResponses: num(r.csat_n),
      hoursLogged: round2(num(r.hrs_logged)),
      hoursBillable: round2(num(r.hrs_billable)),
      hoursReactive: round2(num(r.hrs_reactive)),
      hoursProject: round2(num(r.hrs_project)),
      hoursProblem: round2(num(r.hrs_problem)),
      hoursAdmin: round2(num(r.hrs_admin)),
    };
  });
  return { window: { startdate: start, enddate: end, scope }, technicians };
}

/**
 * Per-client service-health scorecard for a window (defaults to trailing 30
 * days). Ticket volume in/out, current open count, SLA attainment, mean time to
 * resolve, and AI CSAT — sorted by tickets created, capped at `limit` (default
 * 50). Use to spot at-risk accounts (high volume + low SLA / CSAT).
 */
export async function getClientHealthScorecard(
  startdate?: string,
  enddate?: string,
  scope: TicketScope = "reactive",
  limit = 50,
): Promise<ClientHealthScorecard> {
  const { start, end } = resolveWindow(startdate, enddate, 30);
  const s = deliverySql(start, end, scope);
  const top = Math.max(1, Math.trunc(limit));
  const sql = `select top ${top}
  a.aarea as client_id,
  a.aareadesc as client,
  sum(case when ${s.createdIn} then 1 else 0 end) as created,
  sum(case when ${s.clearedIn} then 1 else 0 end) as resolved,
  sum(case when ${s.open} then 1 else 0 end) as open_now,
  sum(case when ${s.clearedIn} and f.Slastate = 'I' then 1 else 0 end) as fix_met,
  sum(case when ${s.clearedIn} and f.Slastate = 'O' then 1 else 0 end) as fix_breach,
  sum(case when ${s.createdIn} and f.Fslafirstresponsestate = 'I' then 1 else 0 end) as frt_met,
  sum(case when ${s.createdIn} and f.Fslafirstresponsestate = 'O' then 1 else 0 end) as frt_breach,
  avg(case when ${s.clearedIn} then datediff(minute, f.dateoccured, f.datecleared) / 60.0 end) as mttr_hours,
  avg(case when ${s.createdIn} and f.faisatisfactionlevel > 0 then cast(f.faisatisfactionlevel as float) end) as ai_csat,
  sum(case when ${s.createdIn} and f.faisatisfactionlevel > 0 then 1 else 0 end) as csat_n
from faults f
join area a on a.aarea = f.areaint
${s.join}
where ${s.filters} and ((${s.createdIn}) or (${s.clearedIn}) or ${s.open})
group by a.aarea, a.aareadesc
order by sum(case when ${s.createdIn} then 1 else 0 end) desc`;

  const rows = await reportRows(sql);
  const clients: ClientHealthRow[] = rows.map((r) => ({
    clientId: num(r.client_id),
    client: String(r.client ?? ""),
    created: num(r.created),
    resolved: num(r.resolved),
    openNow: num(r.open_now),
    resolutionSla: attainment(r.fix_met, r.fix_breach),
    firstResponseSla: attainment(r.frt_met, r.frt_breach),
    meanTimeToResolveHours: numOrNull(r.mttr_hours),
    aiCsatAvg: numOrNull(r.ai_csat),
    csatResponses: num(r.csat_n),
  }));
  return { window: { startdate: start, enddate: end, scope }, clients };
}

/**
 * Point-in-time open-ticket backlog: total open, aging buckets, tickets already
 * breaching their fix SLA, tickets due within 24h, and the oldest open tickets.
 * Optionally scoped to a single client. Not windowed — reflects the queue right
 * now. `scope` defaults to reactive (excludes projects/opportunities).
 */
export async function getTicketBacklog(
  scope: TicketScope = "reactive",
  clientId?: number,
): Promise<TicketBacklog> {
  const join = "";
  const filters = [
    liveFault("f"),
    "(f.datecleared is null or f.datecleared < '1900-01-01')",
    scope === "reactive" ? "f.RequestType in (1,3)" : "",
    clientId != null ? `f.areaint = ${Math.trunc(clientId)}` : "",
  ]
    .filter(Boolean)
    .join(" and ");
  const age = "datediff(day, f.dateoccured, getdate())";

  const aggSql = `select
  count(*) as open_total,
  sum(case when f.Slastate = 'O' then 1 else 0 end) as breached_now,
  sum(case when f.Slastate <> 'O' and f.fixbydate > '1900-01-01' and f.fixbydate < dateadd(hour, 24, getdate()) then 1 else 0 end) as due_24h,
  sum(case when ${age} < 1 then 1 else 0 end) as a0,
  sum(case when ${age} >= 1 and ${age} < 3 then 1 else 0 end) as a1,
  sum(case when ${age} >= 3 and ${age} < 7 then 1 else 0 end) as a2,
  sum(case when ${age} >= 7 and ${age} < 30 then 1 else 0 end) as a3,
  sum(case when ${age} >= 30 then 1 else 0 end) as a4
from faults f
${join}
where ${filters}`;

  const oldestSql = `select top 15
  f.faultid as ticket_id,
  a.aareadesc as client,
  u.uname as agent,
  s.tstatusdesc as status,
  f.seriousness as priority,
  ${age} as age_days,
  f.Slastate as fix_sla_state,
  f.Fslafirstresponsestate as frt_state
from faults f
join area a on a.aarea = f.areaint
left join uname u on f.assignedtoint = u.unum
join tstatus s on f.status = s.Tstatus
${join}
where ${filters}
order by f.dateoccured asc`;

  const [agg, oldest] = await Promise.all([reportRows(aggSql), reportRows(oldestSql)]);
  const a = agg[0] ?? {};
  return {
    scope,
    clientId,
    openTotal: num(a.open_total),
    breachedNow: num(a.breached_now),
    dueWithin24h: num(a.due_24h),
    aging: {
      lessThan1Day: num(a.a0),
      oneToThreeDays: num(a.a1),
      threeToSevenDays: num(a.a2),
      sevenToThirtyDays: num(a.a3),
      overThirtyDays: num(a.a4),
    },
    oldest: oldest.map((r) => ({
      ticketId: num(r.ticket_id),
      client: String(r.client ?? ""),
      agent: r.agent ? String(r.agent) : null,
      status: String(r.status ?? ""),
      priority: num(r.priority),
      ageDays: num(r.age_days),
      fixSlaState: String(r.fix_sla_state ?? ""),
      firstResponseState: String(r.frt_state ?? ""),
    })),
  };
}

/**
 * Ticket-categorisation insight for a window (defaults to trailing 30 days):
 * how much of the queue is uncategorised, the top categories by volume and by
 * logged hours, and the recurring-problem candidates (named categories ranked
 * by tickets × hours — the KB-article / automation targets). A high
 * `uncategorisedPct` (industry red flag is ~40%+) means reporting is blind to
 * recurring issues. Uses faults.category2 (Halo's primary category, stored as a
 * denormalised "A>B>C" path); hours come from ACTIONS time logged in the window.
 */
export async function getCategoryInsights(
  startdate?: string,
  enddate?: string,
  scope: TicketScope = "reactive",
  limit = 15,
): Promise<CategoryInsights> {
  const { start, end } = resolveWindow(startdate, enddate, 30);
  const ex = exclusiveEnd(end);
  const join = "";
  const reactive = scope === "reactive" ? "and f.RequestType in (1,3)" : "";
  const base = `${liveFault("f")} and ${NOT_STUB} ${reactive} and f.dateoccured >= '${start}' and f.dateoccured < '${ex}'`;
  const cat = `coalesce(nullif(ltrim(rtrim(f.category2)), ''), '(uncategorised)')`;

  const summarySql = `select
  count(*) as total,
  sum(case when nullif(ltrim(rtrim(f.category2)), '') is null then 1 else 0 end) as uncategorised
from faults f
${join}
where ${base}`;

  const catSql = `select top 100
  ${cat} as category,
  count(*) as tickets,
  cast(sum(coalesce(a.hrs, 0)) as decimal(12,2)) as hours
from faults f
${join}
left join (select faultid, sum(timetaken) as hrs from actions where ActionDateCreated >= '${start}' and ActionDateCreated < '${ex}' group by faultid) a on a.faultid = f.faultid
where ${base}
group by ${cat}
order by count(*) desc`;

  const [summaryRows, catRows] = await Promise.all([reportRows(summarySql), reportRows(catSql)]);
  const summary = summaryRows[0] ?? {};
  const total = num(summary.total);
  const uncategorised = num(summary.uncategorised);
  const cats = catRows.map((r) => ({
    category: String(r.category ?? ""),
    tickets: num(r.tickets),
    hours: round2(num(r.hours)),
  }));
  const named = cats.filter((c) => c.category !== "(uncategorised)");
  return {
    window: { startdate: start, enddate: end, scope },
    totalTickets: total,
    uncategorisedTickets: uncategorised,
    uncategorisedPct: rate(uncategorised, total),
    topByVolume: cats.slice(0, limit),
    topByHours: [...cats].sort((a, b) => b.hours - a.hours).slice(0, limit),
    recurringProblemCandidates: named
      .map((c) => ({ ...c, effortScore: round2(c.tickets * c.hours) }))
      .sort((a, b) => b.effortScore - a.effortScore)
      .slice(0, limit),
  };
}

/**
 * Per-technician leading risk signals for a window (defaults to trailing 30
 * days): of the reactive tickets a tech closed — zero-time-close rate (closed
 * with no time logged) and resolution-SLA breach rate and AI CSAT; plus their
 * current owned-open backlog and how much of it is stale (no action in 3+ days);
 * plus time-entry discipline — average lag between work date and entry creation,
 * % logged within an hour, and entries back-edited >1 day later. Raises heuristic
 * `flags` (high-zero-time-closes >30%, low-sla >20% breach, stale-backlog,
 * low-csat <5, late-time-entry <60% real-time) to separate "needs coaching"
 * from "disengaged".
 * These are signals to investigate, not verdicts — a tech who under-logs time
 * looks idle while busy, so always read with throughput and context.
 */
export async function getTechnicianRiskSignals(
  startdate?: string,
  enddate?: string,
  scope: TicketScope = "reactive",
  limit = 50,
): Promise<TechnicianRiskSignals> {
  const { start, end } = resolveWindow(startdate, enddate, 30);
  const ex = exclusiveEnd(end);
  const join = "";
  const reactive = scope === "reactive" ? "and f.RequestType in (1,3)" : "";
  const notDeleted = liveFault("f");
  const realAgent = realAgentFilter("u");
  const top = Math.max(1, Math.trunc(limit));

  // Closed-by-tech cohort: throughput + zero-time closes + SLA breach + CSAT.
  const closedSql = `select top ${top}
  u.unum as agent_id,
  u.uname as agent,
  count(*) as resolved,
  sum(case when coalesce(a.hrs,0) = 0 then 1 else 0 end) as zero_time_closes,
  sum(case when f.Slastate = 'O' then 1 else 0 end) as sla_breach,
  cast(avg(try_convert(float, nullif(f.faisatisfactionlevel, ''))) as decimal(6,2)) as ai_csat
from faults f
join uname u on f.clearwhoint = u.unum
${join}
left join (select faultid, sum(timetaken) as hrs from actions group by faultid) a on a.faultid = f.faultid
where ${notDeleted} and ${NOT_STUB} ${reactive} and ${realAgent} and f.datecleared >= '${start}' and f.datecleared < '${ex}'
group by u.unum, u.uname
order by count(*) desc`;

  // Owned-open cohort: current backlog held by each tech + stale share.
  const ownedSql = `select top ${top}
  u.unum as agent_id,
  u.uname as agent,
  count(*) as open_owned,
  sum(case when f.Flastactiondate < dateadd(day, -3, getdate()) then 1 else 0 end) as stale_3d,
  cast(avg(datediff(day, f.dateoccured, getdate()) * 1.0) as decimal(10,1)) as avg_age_days
from faults f
join uname u on f.assignedtoint = u.unum
${join}
where ${notDeleted} ${reactive} and ${realAgent} and (f.datecleared is null or f.datecleared < '1900-01-01')
group by u.unum, u.uname
order by count(*) desc`;

  // Time-entry discipline: lag between work date (Whe_) and entry creation, plus
  // back-edits >1 day after creation (which clears this tenant's automation that
  // touches every action a few minutes after creation).
  const latencySql = `select top ${top}
  u.unum as agent_id,
  u.uname as agent,
  count(*) as time_entries,
  cast(avg(datediff(minute, a.Whe_, a.ActionDateCreated) / 60.0) as decimal(10,1)) as avg_lag_hrs,
  sum(case when datediff(hour, a.Whe_, a.ActionDateCreated) <= 1 then 1 else 0 end) as realtime_1h,
  sum(case when a.ALastUpdated > dateadd(hour, 24, a.ActionDateCreated) then 1 else 0 end) as edited_1day_plus
from actions a
join uname u on a.whoagentid = u.unum
where ${realAgent} and a.timetaken > 0 and a.Whe_ >= '${start}' and a.Whe_ < '${ex}'
group by u.unum, u.uname
order by count(*) desc`;

  const [closedRows, ownedRows, latencyRows] = await Promise.all([
    reportRows(closedSql),
    reportRows(ownedSql),
    reportRows(latencySql),
  ]);

  const blank = (id: number, agent: string): TechnicianRiskRow => ({
    agentId: id,
    agent,
    resolved: 0,
    zeroTimeCloses: 0,
    zeroTimeCloseRate: null,
    slaBreaches: 0,
    resolutionSlaBreachRate: null,
    aiCsatAvg: null,
    openOwned: 0,
    staleOwned: 0,
    staleOwnedRate: null,
    avgOpenAgeDays: null,
    timeEntries: 0,
    avgEntryLagHours: null,
    pctLoggedRealtime: null,
    lateEditedEntries: 0,
    flags: [],
  });

  const byId = new Map<number, TechnicianRiskRow>();
  for (const r of closedRows) {
    const id = num(r.agent_id);
    const resolved = num(r.resolved);
    const zero = num(r.zero_time_closes);
    const breach = num(r.sla_breach);
    const row = blank(id, String(r.agent ?? ""));
    row.resolved = resolved;
    row.zeroTimeCloses = zero;
    row.zeroTimeCloseRate = rate(zero, resolved);
    row.slaBreaches = breach;
    row.resolutionSlaBreachRate = rate(breach, resolved);
    row.aiCsatAvg = numOrNull(r.ai_csat);
    byId.set(id, row);
  }
  for (const r of ownedRows) {
    const id = num(r.agent_id);
    const openOwned = num(r.open_owned);
    const stale = num(r.stale_3d);
    const row = byId.get(id) ?? blank(id, String(r.agent ?? ""));
    row.openOwned = openOwned;
    row.staleOwned = stale;
    row.staleOwnedRate = rate(stale, openOwned);
    row.avgOpenAgeDays = numOrNull(r.avg_age_days);
    byId.set(id, row);
  }
  for (const r of latencyRows) {
    const id = num(r.agent_id);
    const entries = num(r.time_entries);
    const realtime = num(r.realtime_1h);
    const row = byId.get(id) ?? blank(id, String(r.agent ?? ""));
    row.timeEntries = entries;
    row.avgEntryLagHours = numOrNull(r.avg_lag_hrs);
    row.pctLoggedRealtime = rate(realtime, entries);
    row.lateEditedEntries = num(r.edited_1day_plus);
    byId.set(id, row);
  }

  const technicians = Array.from(byId.values()).map((t) => {
    const flags: string[] = [];
    if ((t.zeroTimeCloseRate ?? 0) > 30 && t.resolved >= 5) flags.push("high-zero-time-closes");
    if ((t.resolutionSlaBreachRate ?? 0) > 20 && t.resolved >= 5) flags.push("low-sla-attainment");
    if (t.staleOwned >= 5 && (t.staleOwnedRate ?? 0) >= 50) flags.push("stale-backlog");
    if (t.aiCsatAvg != null && t.aiCsatAvg < 5) flags.push("low-csat");
    if (t.pctLoggedRealtime != null && t.pctLoggedRealtime < 60 && t.timeEntries >= 10)
      flags.push("late-time-entry");
    return { ...t, flags };
  });
  technicians.sort((a, b) => b.resolved - a.resolved);

  return {
    window: { startdate: start, enddate: end, scope },
    note: "Signals to investigate, not verdicts. Cross-read with throughput and context — e.g. zero-time-closes can mean under-logging, not idleness; after-hours and category-level coaching signals live in the reports/technicians SQL library.",
    technicians,
  };
}

// ---------- Analytics: similarity / embeddings (SQL-backed) ----------
//
// These compose Halo's ticket-embedding similarity graph (table
// FaultVectorScore) into recurring-problem / duplicate / per-ticket-neighbour
// insights. Schema idioms (in addition to the service-delivery ones above):
//   FaultVectorScore.FVSfaultid          -> the source ticket (FAULTS.faultid)
//   FaultVectorScore.FVSSimiliarfaultid  -> the matched item; a TICKET id when FVSuse=0,
//                                            a KB-article id (KBENTRY.id) when FVSuse=1.
//   FaultVectorScore.FVSScore            -> cosine similarity (~0.62–1.0)
//   FaultVectorScore.fvsSearchMethod     -> the vector-search BACKEND that wrote the
//                                            row (0=Halo internal store, 1=Azure AI
//                                            Search, 2=OpenSearch). WHICH backend is
//                                            configured is irrelevant — just drop the
//                                            garbage NULL/'' method rows (they score
//                                            unrelated tickets at 1.0); keep the rest.
//   FaultVectorScore.FVSuse              -> match TYPE: 0 = ticket↔ticket, 1 = ticket↔KB.
//     (KB ids 1..N collide with low faultids, so without this split a KB match looks
//      like an unrelated old ticket — the trap that hides KB matches.)
//
// CRITICAL: filter `coalesce(cast(fvsSearchMethod as nvarchar(20)),'') <> '' AND FVSuse = 0`
// for ticket↔ticket (drop the NULL/'' garbage backend; don't pin a specific backend). The
// score threshold (minScore) is the caller's to tune per task — not a fixed baked range.
// The graph is directional (source -> similar); for clustering we treat edges as undirected.

/** FaultVectorScore method predicate. When the caller pins a backend
 *  (0=Halo store, 1=Azure, 2=OpenSearch) we filter to it; otherwise we just drop
 *  the garbage NULL/'' method rows (which score unrelated tickets at 1.0). `col`
 *  is the qualified column, e.g. "v.fvsSearchMethod". */
function vectorMethodFilter(col: string, method?: number): string {
  return method !== undefined && Number.isFinite(method)
    ? `${col} = ${Math.trunc(method)}`
    : `coalesce(cast(${col} as nvarchar(20)),'') <> ''`;
}

/**
 * Non-actionable-noise predicate on FAULTS.Symptom. The strongest similar
 * clusters in an embedding graph are auto-replies, OTP / verification emails,
 * test tickets, recurring review / newsletter notifications, etc. — high
 * similarity but zero value as a recurring-problem signal. We filter these on
 * BOTH endpoints of every pair. Heuristic, deliberately conservative.
 *
 * EDIT: tune these LIKE patterns per tenant if a noisy auto-generated subject
 * line is dominating the clusters. Kept internal (no param) so the tools stay
 * simple; this is the one place to change it.
 *
 * `alias` is the FAULTS table alias to apply it to (e.g. "fa", "fb", "f").
 */
function noiseFilter(alias: string): string {
  const s = `cast(${alias}.Symptom as nvarchar(400))`;
  return (
    `(${s} is not null` +
    ` and ${s} not like 'Automatic reply%'` +
    ` and ${s} not like 'Re: Automatic reply%'` +
    ` and ${s} not like '%verification code%'` +
    ` and ${s} not like '% is your %code%'` +
    ` and ${s} not like 'Test%'` +
    ` and ${s} not like '%Monthly Support Review%'` +
    ` and ${s} not like '%Newsletter%'` +
    ` and ${s} not like 'A new sms ticket received%')`
  );
}

/** Median of a numeric array (linear interpolation between the two middle
 *  values for even counts). Null for an empty set. Used to summarise neighbour
 *  resolution effort in getSimilarTicketInsights — Report Center has no clean
 *  single-statement grouped median, so we compute it in TS from the rows. */
function median(values: number[]): number | null {
  const xs = values.filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (xs.length === 0) return null;
  const mid = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[mid] : round2((xs[mid - 1] + xs[mid]) / 2);
}

/**
 * Cluster semantically-similar reactive tickets to surface recurring problems
 * worth a KB article / automation / problem record, plus a handling-consistency
 * signal (how many distinct resolvers, how spread the resolution time is).
 *
 * Uses Halo's ticket embeddings (FaultVectorScore, active backend only), noise-filtered
 * on both endpoints.
 *
 * APPROXIMATE CLUSTERING: a true connected-component (transitive-closure)
 * clustering needs a recursive CTE, which Report Center forbids. We approximate:
 * for each undirected edge (score >= minScore, both endpoints reactive +
 * NOT_STUB + non-noise + in-window on dateoccured) the cluster_anchor is the
 * LEAST of the two faultids; tickets are grouped by that anchor. Two tickets
 * only land in the same cluster if they share a direct lowest-id neighbour, so
 * a long similarity chain can fragment into several anchors. Good enough to spot
 * recurring themes; not a guarantee of one row per real-world problem.
 *
 * Per cluster: anchor faultid, a representative Symptom, distinct ticket count,
 * distinct clients, total hours logged (ACTIONS.timetaken over the distinct
 * member tickets), average resolution hours, distinct resolver count, and
 * average edge score. Ranked by (ticket count × total hours) desc.
 */
export async function getRecurringProblemClusters(
  startdate?: string,
  enddate?: string,
  minScore = 0.85,
  limit = 25,
  searchMethod?: number,
): Promise<RecurringProblemClusters> {
  const { start, end } = resolveWindow(startdate, enddate, 365);
  const ex = exclusiveEnd(end);
  const top = Math.max(1, Math.trunc(limit));
  const ms = Number.isFinite(minScore) ? minScore : 0.85;
  const anchor = "case when v.FVSfaultid < v.FVSSimiliarfaultid then v.FVSfaultid else v.FVSSimiliarfaultid end";
  // Shared edge predicate: vector method (caller-pinned or just non-garbage),
  // score gate, both endpoints reactive + NOT_STUB + non-noise + in-window.
  const edgeWhere =
    `${vectorMethodFilter("v.fvsSearchMethod", searchMethod)} and v.FVSuse = 0 and v.FVSScore >= ${ms}` +
    ` and ${liveFault("fa")} and ${liveFault("fb")}` +
    ` and fa.RequestType in (1,3) and fb.RequestType in (1,3)` +
    ` and (fa.datecleared > fa.dateoccured or fa.datecleared is null or fa.datecleared < '1900-01-01')` +
    ` and (fb.datecleared > fb.dateoccured or fb.datecleared is null or fb.datecleared < '1900-01-01')` +
    ` and fa.dateoccured >= '${start}' and fa.dateoccured < '${ex}'` +
    ` and fb.dateoccured >= '${start}' and fb.dateoccured < '${ex}'` +
    ` and ${noiseFilter("fa")} and ${noiseFilter("fb")}`;
  const edgeJoins =
    `from FaultVectorScore v` +
    ` join faults fa on fa.faultid = v.FVSfaultid join requesttype rta on fa.RequestTypeNew = rta.RTid` +
    ` join faults fb on fb.faultid = v.FVSSimiliarfaultid join requesttype rtb on fb.RequestTypeNew = rtb.RTid`;

  // Distinct (anchor, member) so per-ticket aggregates don't fan out across
  // multiple edges sharing the same anchor; avg score comes from a separate
  // per-anchor edge aggregate.
  const sql = `select top ${top}
  mem.cluster_anchor,
  max(cast(f.Symptom as nvarchar(400))) as representative,
  count(*) as ticket_count,
  count(distinct f.areaint) as distinct_clients,
  cast(sum(coalesce(h.hrs, 0)) as decimal(12,2)) as total_hours,
  cast(avg(case when f.datecleared > f.dateoccured then datediff(minute, f.dateoccured, f.datecleared) / 60.0 end) as decimal(10,2)) as avg_resolution_hours,
  count(distinct f.clearwhoint) as distinct_resolvers,
  max(sc.avg_score) as avg_score
from (
  select ${anchor} as cluster_anchor, v.FVSfaultid as member ${edgeJoins} where ${edgeWhere}
  union
  select ${anchor} as cluster_anchor, v.FVSSimiliarfaultid as member ${edgeJoins} where ${edgeWhere}
) mem
join faults f on f.faultid = mem.member
left join (select faultid, sum(timetaken) as hrs from actions group by faultid) h on h.faultid = mem.member
join (
  select ${anchor} as cluster_anchor, cast(avg(v.FVSScore) as decimal(6,4)) as avg_score
  ${edgeJoins} where ${edgeWhere}
  group by ${anchor}
) sc on sc.cluster_anchor = mem.cluster_anchor
group by mem.cluster_anchor
order by count(*) * sum(coalesce(h.hrs, 0)) desc`;

  const rows = await reportRows(sql);
  const clusters: RecurringProblemCluster[] = rows.map((r) => ({
    anchorFaultId: num(r.cluster_anchor),
    representativeSummary: String(r.representative ?? ""),
    ticketCount: num(r.ticket_count),
    distinctClients: num(r.distinct_clients),
    totalHoursLogged: round2(num(r.total_hours)),
    avgResolutionHours: numOrNull(r.avg_resolution_hours),
    distinctResolvers: num(r.distinct_resolvers),
    avgScore: numOrNull(r.avg_score),
  }));
  return {
    window: { startdate: start, enddate: end, scope: "reactive" },
    minScore: ms,
    approximationNote:
      "Clustering is approximate: tickets are grouped by the lowest faultid among each similar pair (no transitive closure — Report Center forbids recursive CTEs), so a long similarity chain can fragment across anchors. Uses Halo's ticket embeddings (method 1), noise-filtered.",
    clusters,
  };
}

/**
 * Open tickets that are near-duplicates of another ticket — merge candidates /
 * double-logging detection. For each OPEN ticket (status not in 8/9, in scope,
 * non-noise) finds its single highest-scoring method-1 neighbour at or above
 * minScore (default 0.9 = near-duplicate) in either direction, and reports the
 * matched ticket's id / summary / state (open or closed) / score. Ordered by
 * score desc.
 *
 * Uses Halo's ticket embeddings (backend-agnostic; garbage NULL-method rows excluded), noise-filtered.
 */
export async function getDuplicateTickets(
  scope: TicketScope = "reactive",
  minScore = 0.9,
  limit = 50,
  searchMethod?: number,
): Promise<DuplicateTickets> {
  const top = Math.max(1, Math.trunc(limit));
  const ms = Number.isFinite(minScore) ? minScore : 0.9;
  const rtJoin = "";
  const reactive = scope === "reactive" ? "and o.RequestType in (1,3)" : "";
  // edgeWhere guards both union subqueries (each joins the matched ticket as fm).
  const edgeWhere = `${vectorMethodFilter("v.fvsSearchMethod", searchMethod)} and v.FVSuse = 0 and v.FVSScore >= ${ms} and ${liveFault("fm")}`;

  const sql = `select top ${top}
  o.faultid as open_ticket_id,
  cast(o.Symptom as nvarchar(300)) as open_summary,
  ao.aareadesc as client,
  datediff(day, o.dateoccured, getdate()) as age_days,
  m.match_id as matched_ticket_id,
  m.match_summary as matched_summary,
  m.match_state as matched_state,
  cast(m.score as decimal(6,4)) as score
from faults o
${rtJoin}
join area ao on ao.aarea = o.areaint
join (
  select open_id, match_id, score, match_summary, match_state,
         row_number() over (partition by open_id order by score desc, match_id asc) as rn
  from (
    select v.FVSfaultid as open_id, v.FVSSimiliarfaultid as match_id, v.FVSScore as score,
           cast(fm.Symptom as nvarchar(300)) as match_summary,
           case when fm.status in (8,9) then 'closed' else 'open' end as match_state
    from FaultVectorScore v join faults fm on fm.faultid = v.FVSSimiliarfaultid
    where ${edgeWhere}
    union all
    select v.FVSSimiliarfaultid as open_id, v.FVSfaultid as match_id, v.FVSScore as score,
           cast(fm.Symptom as nvarchar(300)) as match_summary,
           case when fm.status in (8,9) then 'closed' else 'open' end as match_state
    from FaultVectorScore v join faults fm on fm.faultid = v.FVSfaultid
    where ${edgeWhere}
  ) edges
) m on m.open_id = o.faultid and m.rn = 1
where ${liveFault("o")} and o.status not in (8,9) ${reactive} and ${noiseFilter("o")}
order by m.score desc`;

  const rows = await reportRows(sql);
  const duplicates: DuplicateTicketMatch[] = rows.map((r) => ({
    openTicketId: num(r.open_ticket_id),
    openSummary: String(r.open_summary ?? ""),
    client: String(r.client ?? ""),
    ageDays: num(r.age_days),
    matchedTicketId: num(r.matched_ticket_id),
    matchedSummary: String(r.matched_summary ?? ""),
    matchedState: String(r.matched_state ?? "") as "open" | "closed",
    score: numOrNull(r.score),
  }));
  return { scope, minScore: ms, duplicates };
}

/**
 * Clients who repeatedly log the SAME issue — chronic-pain / root-cause /
 * training targets. Counts high-similarity undirected pairs where BOTH tickets
 * belong to the same client (AREA) within the window (reactive + non-noise).
 * Per client: number of recurring pairs, distinct tickets involved, total hours
 * logged across those tickets. Ranked by pair count desc.
 *
 * Same-client recurrence is the signal here; cross-client similarity (a problem
 * affecting many customers) is what getRecurringProblemClusters surfaces instead.
 *
 * Uses Halo's ticket embeddings (backend-agnostic; garbage NULL-method rows excluded), noise-filtered.
 */
export async function getClientDejaVu(
  startdate?: string,
  enddate?: string,
  minScore = 0.85,
  limit = 50,
  searchMethod?: number,
): Promise<ClientDejaVu> {
  const { start, end } = resolveWindow(startdate, enddate, 365);
  const ex = exclusiveEnd(end);
  const top = Math.max(1, Math.trunc(limit));
  const ms = Number.isFinite(minScore) ? minScore : 0.85;
  // One row per same-client undirected pair (FVSfaultid < FVSSimiliarfaultid
  // dedupes direction). cross apply expands to the two member tickets so we can
  // count distinct tickets and sum their hours; hours are summed over distinct
  // (client, member) to avoid a ticket in several pairs being counted twice.
  const sql = `select top ${top}
  p.areaint as client_id,
  max(a.aareadesc) as client,
  max(p.pair_count) as recurring_pair_count,
  count(*) as distinct_tickets,
  cast(sum(coalesce(h.hrs, 0)) as decimal(12,2)) as total_hours
from (
  select areaint, member, max(pair_count) as pair_count from (
    select pr.areaint, t.member, pr.pair_count
    from (
      select fa.areaint, v.FVSfaultid as fa_id, v.FVSSimiliarfaultid as fb_id,
             count(*) over (partition by fa.areaint) as pair_count
      from FaultVectorScore v
      join faults fa on fa.faultid = v.FVSfaultid join requesttype rta on fa.RequestTypeNew = rta.RTid
      join faults fb on fb.faultid = v.FVSSimiliarfaultid join requesttype rtb on fb.RequestTypeNew = rtb.RTid
      where ${vectorMethodFilter("v.fvsSearchMethod", searchMethod)} and v.FVSuse = 0 and v.FVSScore >= ${ms} and v.FVSfaultid < v.FVSSimiliarfaultid
        and ${liveFault("fa")} and ${liveFault("fb")}
        and fa.areaint = fb.areaint
        and fa.RequestType in (1,3) and fb.RequestType in (1,3)
        and fa.dateoccured >= '${start}' and fa.dateoccured < '${ex}'
        and fb.dateoccured >= '${start}' and fb.dateoccured < '${ex}'
        and ${noiseFilter("fa")} and ${noiseFilter("fb")}
    ) pr
    cross apply (values (pr.fa_id), (pr.fb_id)) t(member)
  ) expanded
  group by areaint, member
) p
join area a on a.aarea = p.areaint
left join (select faultid, sum(timetaken) as hrs from actions group by faultid) h on h.faultid = p.member
group by p.areaint
order by max(p.pair_count) desc`;

  const rows = await reportRows(sql);
  const clients: ClientDejaVuRow[] = rows.map((r) => ({
    clientId: num(r.client_id),
    client: String(r.client ?? ""),
    recurringPairCount: num(r.recurring_pair_count),
    distinctTickets: num(r.distinct_tickets),
    totalHoursLogged: round2(num(r.total_hours)),
  }));
  return {
    window: { startdate: start, enddate: end, scope: "reactive" },
    minScore: ms,
    clients,
  };
}

/**
 * For a single ticket, surface its nearest RESOLVED neighbours so you can route
 * to whoever solved the same thing before, and predict likely effort / category.
 * Finds method-1 neighbours (either direction) at score >= 0.8 that are resolved
 * (status in 8/9, datecleared > dateoccured); returns the top 10 by score with
 * summary, score, resolver, resolution hours, category2, and CSAT — plus a
 * summary block: median predicted resolution hours, the most common category2,
 * and the resolvers who handled the most neighbours.
 *
 * Uses Halo's ticket embeddings (backend-agnostic; garbage NULL-method rows excluded). Per-ticket lookup, so it is
 * NOT noise-filtered — you asked about one specific ticket.
 */
export async function getSimilarTicketInsights(
  faultid: number,
  minScore = 0.8,
  searchMethod?: number,
): Promise<SimilarTicketInsights> {
  const id = Math.trunc(faultid);
  const ms = Number.isFinite(minScore) ? minScore : 0.8;
  const mf = vectorMethodFilter("v.fvsSearchMethod", searchMethod);
  const sql = `select top 10
  n.faultid,
  cast(f.Symptom as nvarchar(300)) as summary,
  cast(n.score as decimal(6,4)) as score,
  u.uname as resolver,
  f.clearwhoint as resolver_id,
  cast(case when f.datecleared > f.dateoccured then datediff(minute, f.dateoccured, f.datecleared) / 60.0 end as decimal(10,2)) as resolution_hours,
  f.category2 as category2,
  try_convert(float, nullif(f.faisatisfactionlevel, '')) as csat
from (
  select v.FVSSimiliarfaultid as faultid, v.FVSScore as score from FaultVectorScore v where ${mf} and v.FVSuse = 0 and v.FVSfaultid = ${id} and v.FVSScore >= ${ms}
  union all
  select v.FVSfaultid as faultid, v.FVSScore as score from FaultVectorScore v where ${mf} and v.FVSuse = 0 and v.FVSSimiliarfaultid = ${id} and v.FVSScore >= ${ms}
) n
join faults f on f.faultid = n.faultid
left join uname u on f.clearwhoint = u.unum
where ${liveFault("f")} and f.status in (8,9) and f.datecleared > f.dateoccured
order by n.score desc`;

  const rows = await reportRows(sql);
  const neighbours: SimilarTicketNeighbour[] = rows.map((r) => ({
    faultId: num(r.faultid),
    summary: String(r.summary ?? ""),
    score: numOrNull(r.score),
    resolverId: numOrNull(r.resolver_id),
    resolver: r.resolver ? String(r.resolver) : null,
    resolutionHours: numOrNull(r.resolution_hours),
    category2: r.category2 ? String(r.category2) : null,
    csat: numOrNull(r.csat),
  }));

  // Predicted resolution effort = median of neighbour resolution hours.
  const predictedResolutionHoursMedian = median(
    neighbours.map((n) => n.resolutionHours).filter((h): h is number => h != null),
  );
  // Predicted category = the most common non-empty category2 among neighbours.
  const catCounts = new Map<string, number>();
  for (const n of neighbours) {
    const c = (n.category2 ?? "").trim();
    if (c) catCounts.set(c, (catCounts.get(c) ?? 0) + 1);
  }
  let predictedCategory: string | null = null;
  let bestCat = 0;
  for (const [c, n] of catCounts) {
    if (n > bestCat) { bestCat = n; predictedCategory = c; }
  }
  // Suggested resolvers = the agents who handled the most neighbours, by count.
  const resolverCounts = new Map<number, { name: string; count: number }>();
  for (const n of neighbours) {
    if (n.resolverId == null || n.resolverId <= 0) continue;
    const b = resolverCounts.get(n.resolverId) ?? { name: n.resolver ?? "", count: 0 };
    b.count += 1;
    if (!b.name && n.resolver) b.name = n.resolver;
    resolverCounts.set(n.resolverId, b);
  }
  const suggestedResolvers = Array.from(resolverCounts.entries())
    .map(([agentId, b]) => ({ agentId, agent: b.name, neighbourCount: b.count }))
    .sort((a, b) => b.neighbourCount - a.neighbourCount);

  return {
    faultId: id,
    neighbours,
    summary: {
      neighbourCount: neighbours.length,
      predictedResolutionHoursMedian,
      predictedCategory,
      suggestedResolvers,
    },
  };
}

/**
 * Knowledge-base gap analysis from the ticket↔KB embedding matches
 * (FaultVectorScore where FVSuse=1, the KB-article side; FVSSimiliarfaultid is a
 * KBENTRY.id). For a window (default trailing 365 days) of reactive, non-stub,
 * noise-filtered tickets: KB coverage (how many tickets have a match at/above
 * `matchThreshold`), the most-matched KB articles, and the highest-effort
 * uncovered tickets — the articles worth writing first. Requires KB embeddings
 * to be enabled in Halo; returns zeroed coverage with no rows if absent.
 */
export async function getKnowledgeGaps(
  startdate?: string,
  enddate?: string,
  matchThreshold = 0.8,
  limit = 20,
  searchMethod?: number,
): Promise<KnowledgeGaps> {
  const { start, end } = resolveWindow(startdate, enddate, 365);
  const ex = exclusiveEnd(end);
  const th = Number.isFinite(matchThreshold) ? matchThreshold : 0.8;
  const top = Math.max(1, Math.trunc(limit));
  const base =
    `${liveFault("f")}` +
    ` and f.RequestType in (1,3)` +
    ` and (f.datecleared > f.dateoccured or f.datecleared is null or f.datecleared < '1900-01-01')` +
    ` and f.dateoccured >= '${start}' and f.dateoccured < '${ex}' and ${noiseFilter("f")}`;
  const kbJoin =
    `left join (select FVSfaultid, max(FVSScore) as best_kb from FaultVectorScore where ${vectorMethodFilter("fvsSearchMethod", searchMethod)} and FVSuse = 1 group by FVSfaultid) kb on kb.FVSfaultid = f.faultid`;

  const coverageSql = `select
  count(*) as tickets,
  sum(case when kb.best_kb >= ${th} then 1 else 0 end) as covered,
  cast(avg(kb.best_kb) as decimal(6,4)) as avg_best
from faults f
join requesttype rt on f.requesttypenew = rt.RTid
${kbJoin}
where ${base}`;

  const topKbSql = `select top ${top}
  k.id as kb_id,
  max(cast(k.description as nvarchar(160))) as title,
  count(distinct fvs.FVSfaultid) as tickets_matched,
  cast(avg(fvs.FVSScore) as decimal(6,4)) as avg_score
from FaultVectorScore fvs
join KBENTRY k on k.id = fvs.FVSSimiliarfaultid
join faults f on f.faultid = fvs.FVSfaultid
join requesttype rt on f.requesttypenew = rt.RTid
where ${vectorMethodFilter("fvs.fvsSearchMethod", searchMethod)} and fvs.FVSuse = 1 and fvs.FVSScore >= ${th} and ${base}
group by k.id
order by count(distinct fvs.FVSfaultid) desc`;

  const gapSql = `select top ${top}
  f.faultid,
  left(cast(f.Symptom as nvarchar(140)), 140) as summary,
  a.aareadesc as client,
  cast(coalesce(h.hrs, 0) as decimal(12,2)) as hours_logged,
  cast(kb.best_kb as decimal(6,4)) as best_kb
from faults f
join requesttype rt on f.requesttypenew = rt.RTid
left join area a on a.aarea = f.areaint
left join (select faultid, sum(timetaken) as hrs from actions group by faultid) h on h.faultid = f.faultid
${kbJoin}
where ${base} and (kb.best_kb is null or kb.best_kb < ${th})
order by coalesce(h.hrs, 0) desc`;

  const [covRows, kbRows, gapRows] = await Promise.all([
    reportRows(coverageSql),
    reportRows(topKbSql),
    reportRows(gapSql),
  ]);

  const cov = covRows[0] ?? {};
  const tickets = num(cov.tickets);
  const covered = num(cov.covered);
  return {
    window: { startdate: start, enddate: end, scope: "reactive" },
    matchThreshold: th,
    coverage: {
      tickets,
      withKbMatch: covered,
      coveragePct: rate(covered, tickets),
      avgBestScore: numOrNull(cov.avg_best),
    },
    topKbArticles: kbRows.map((r) => ({
      kbId: num(r.kb_id),
      title: String(r.title ?? "").trim(),
      ticketsMatched: num(r.tickets_matched),
      avgScore: numOrNull(r.avg_score),
    })),
    gapCandidates: gapRows.map((r) => ({
      faultId: num(r.faultid),
      summary: String(r.summary ?? "").trim(),
      client: String(r.client ?? ""),
      hoursLogged: round2(num(r.hours_logged)),
      bestKbScore: numOrNull(r.best_kb),
    })),
  };
}

// ---------- Ticket categorisation (AI-in-the-loop) ----------
//
// The MCP supplies the data + the write; the calling model does the matching.
// getTicketsToCategorize returns the controlled taxonomy + the scoped tickets
// (with their cheap AI summary); the model maps each summary to a category (or
// proposes a new one) and applies it with setTicketCategory. KEY off-by-one:
// API `category_1`/`categoryid_1` == DB `category2`/`categoryid2` == the primary
// categorisation (CATEGORYDETAIL CDType=2).

/**
 * Feed for the ticket categoriser. Scope with `onlyUncategorised` (default true),
 * a specific `category` (CDid or "A>B>C" path) to audit/re-categorise, or neither
 * + onlyUncategorised=false for everything; plus an optional dateoccured range and
 * reactive/all scope. Returns the controlled CDType=2 taxonomy and the matching
 * tickets with their AI summary (and a `summaryMissing` flag for ones that need a
 * fresh AI insight first). Stubs (closed-on-creation) are excluded.
 */
export async function getTicketsToCategorize(opts: {
  startdate?: string;
  enddate?: string;
  onlyUncategorised?: boolean;
  category?: string;
  scope?: TicketScope;
  limit?: number;
} = {}): Promise<TicketsToCategorize> {
  const onlyUncategorised = opts.onlyUncategorised ?? true;
  const scope = opts.scope ?? "reactive";
  const top = Math.max(1, Math.min(1000, Math.trunc(opts.limit ?? 100)));
  const join = scope === "reactive" ? "join requesttype rt on f.requesttypenew = rt.RTid" : "";

  const where: string[] = [
    liveFault("f"),
    NOT_STUB,
  ];
  if (scope === "reactive") where.push("f.RequestType in (1,3)");
  if (opts.startdate) where.push(`f.dateoccured >= '${opts.startdate}'`);
  if (opts.enddate) where.push(`f.dateoccured < '${exclusiveEnd(opts.enddate)}'`);
  if (opts.category != null && opts.category !== "") {
    const c = opts.category.trim();
    if (/^\d+$/.test(c)) where.push(`f.categoryid2 = ${c}`);
    else where.push(`cast(f.category2 as nvarchar(400)) = '${c.replace(/'/g, "''")}'`);
  } else if (onlyUncategorised) {
    where.push("nullif(ltrim(rtrim(cast(f.category2 as nvarchar(400)))), '') is null");
  }
  const whereSql = where.join(" and ");

  const ticketsSql = `select top ${top}
  f.faultid,
  left(cast(f.Symptom as nvarchar(120)), 120) as subject,
  a.aareadesc as client,
  cast(f.category2 as nvarchar(200)) as current_category,
  f.categoryid2 as current_category_id,
  left(convert(nvarchar(max), f.faigeneratedsummary), 400) as ai_summary,
  cast(f.faisuggestedcategory as nvarchar(120)) as ai_suggested_category
from faults f
${join}
left join area a on a.aarea = f.areaint
where ${whereSql}
order by f.dateoccured desc`;

  const countSql = `select count(*) as n from faults f ${join} where ${whereSql}`;
  const catSql = `select cd.CDid as id, cast(cd.CDCategoryName as nvarchar(200)) as name from CATEGORYDETAIL cd where cd.CDType = 2 order by cd.CDCategoryName offset 0 rows`;

  const [ticketRows, countRows, catRows] = await Promise.all([
    reportRows(ticketsSql),
    reportRows(countSql),
    reportRows(catSql),
  ]);

  const tickets: CategorizationTicket[] = ticketRows.map((r) => {
    const summary = r.ai_summary ? String(r.ai_summary).trim() : "";
    return {
      faultId: num(r.faultid),
      subject: String(r.subject ?? "").trim(),
      client: String(r.client ?? ""),
      currentCategory: r.current_category ? String(r.current_category) : null,
      currentCategoryId: r.current_category_id != null && String(r.current_category_id) !== "" ? num(r.current_category_id) : null,
      aiSummary: summary || null,
      aiSuggestedCategory: r.ai_suggested_category ? String(r.ai_suggested_category) : null,
      summaryMissing: summary.length === 0,
    };
  });

  return {
    filter: {
      startdate: opts.startdate,
      enddate: opts.enddate,
      onlyUncategorised,
      category: opts.category,
      scope,
    },
    categories: catRows.map((r) => ({ id: num(r.id), name: String(r.name ?? "").trim() })),
    totalMatching: num(countRows[0]?.n),
    returned: tickets.length,
    tickets,
  };
}

/**
 * Apply the primary category to a ticket. `categoryId` is the CATEGORYDETAIL CDid
 * (CDType=2); `categoryPath` is its "A>B>C" name (optional but recommended — Halo
 * stores both). Writes API `categoryid_1` + `category_1` (= DB categoryid2/category2).
 * This is a single-ticket write; bulk categorisation = the caller looping after
 * reviewing the proposed mapping.
 */
export async function setTicketCategory(
  ticketId: number,
  categoryId: number,
  categoryPath?: string,
): Promise<HaloTicket> {
  return updateTicket({
    id: ticketId,
    categoryid_1: categoryId,
    ...(categoryPath ? { category_1: categoryPath } : {}),
  });
}

/**
 * Create a HaloPSA category via POST /Category. `typeId` 1 = primary ticket
 * category (the kind tickets are tagged with; == DB CATEGORYDETAIL CDType 2),
 * 2 = closure, 4 = request-type. Name is the "A>B>C" path. Use to add genuinely
 * missing categories surfaced by the categoriser (e.g. "License Request",
 * "Noise>Auto-Reply"). The new CDid is returned for use with setTicketCategory.
 */
export async function createCategory(
  categoryName: string,
  typeId = 1,
  categoryGroupId?: number,
): Promise<HaloCategory> {
  const payload: Record<string, unknown> = {
    category_name: categoryName,
    value: categoryName,
    type_id: typeId,
    sla_id: -1,
    priority_id: -1,
    chargerate: -1,
    itilrequesttype: 0,
  };
  if (categoryGroupId != null) payload.category_group_id = categoryGroupId;
  const res = await call<HaloCategory | HaloCategory[]>("/Category", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return Array.isArray(res) ? res[0] : res;
}

// ---------- Noise-ticket analysis (stop low-value tickets at source) ----------

/** SQL fragment classifying a ticket's Symptom into a noise type. Only the
 *  explicit patterns count as noise — NOT a catch-all (most uncategorised
 *  tickets are real work). */
function noiseTypeSql(sym: string): string {
  return `case
  when ${sym} like 'Automatic reply%' or ${sym} like 'Automatische Antwort%' or ${sym} like '%out of office%' or ${sym} like '%auto-reply%' or ${sym} like '%automatic reply%' then 'Auto-Reply / Out-of-Office'
  when ${sym} like '%verification code%' or ${sym} like '%security code%' or ${sym} like '% is your %code%' or ${sym} like '%one-time pass%' then 'Verification / OTP'
  when ${sym} like '%newsletter%' or ${sym} like '%unsubscribe%' then 'Newsletter / Marketing'
  when ${sym} like 'test %' or ${sym} like '%test ticket%' or ${sym} like 'testing%' then 'Test'
  else 'Other' end`;
}

const NOISE_RECOMMENDATIONS: Record<string, string> = {
  "Auto-Reply / Out-of-Office":
    "Enable Halo's auto-reply / out-of-office detection on the inbound mailbox (Mailbox settings → reject or auto-close auto-replies) so OOO bounces never open tickets.",
  "Verification / OTP":
    "Route verification/OTP and security-code emails away from the ticket mailbox, or add an inbound rule to discard them — they're never actionable.",
  "Newsletter / Marketing":
    "Unsubscribe the ticket mailbox from vendor newsletters/marketing, or add a sender/subject inbound rule to discard them.",
  Test: "Internal test tickets — exclude from reporting and remind staff to use a sandbox/test type.",
  Other: "Review manually; matched a generic noise heuristic but no specific source rule.",
};

/**
 * Analyse noise tickets — low/no-value reactive tickets (auto-replies, OOO, OTP
 * emails, newsletters, tests) that still consume triage time — for a window
 * (defaults to trailing 365 days). Returns the noise share of reactive volume,
 * hours wasted, a breakdown by noise type with a source-fix recommendation each,
 * and a per-mailbox breakdown so you can see which inbound mailbox to harden.
 */
export async function getNoiseTicketAnalysis(
  startdate?: string,
  enddate?: string,
): Promise<NoiseTicketAnalysis> {
  const { start, end } = resolveWindow(startdate, enddate, 365);
  const ex = exclusiveEnd(end);
  const sym = "cast(f.Symptom as nvarchar(400))";
  const base =
    `${liveFault("f")}` +
    ` and f.RequestType in (1,3)` +
    ` and f.dateoccured >= '${start}' and f.dateoccured < '${ex}'`;
  const isNoise =
    `(${sym} like 'Automatic reply%' or ${sym} like 'Automatische Antwort%' or ${sym} like '%out of office%' or ${sym} like '%auto-reply%' or ${sym} like '%automatic reply%'` +
    ` or ${sym} like '%verification code%' or ${sym} like '%security code%' or ${sym} like '% is your %code%' or ${sym} like '%one-time pass%'` +
    ` or ${sym} like '%newsletter%' or ${sym} like '%unsubscribe%'` +
    ` or ${sym} like 'test %' or ${sym} like '%test ticket%' or ${sym} like 'testing%')`;

  const summarySql = `select
  count(*) as total_reactive,
  sum(case when ${isNoise} then 1 else 0 end) as total_noise,
  cast(sum(case when ${isNoise} then coalesce(h.hrs, 0) else 0 end) as decimal(12,2)) as noise_hours
from faults f
join requesttype rt on f.requesttypenew = rt.RTid
left join (select faultid, sum(timetaken) as hrs from actions group by faultid) h on h.faultid = f.faultid
where ${base}`;

  const byTypeSql = `select ${noiseTypeSql(sym)} as noise_type,
  count(*) as tickets,
  cast(sum(coalesce(h.hrs, 0)) as decimal(12,2)) as hours_wasted
from faults f
join requesttype rt on f.requesttypenew = rt.RTid
left join (select faultid, sum(timetaken) as hrs from actions group by faultid) h on h.faultid = f.faultid
where ${base} and ${isNoise}
group by ${noiseTypeSql(sym)}
order by count(*) desc
offset 0 rows`;

  const byMailboxSql = `select f.FMailBoxID as mailbox_id, count(*) as tickets
from faults f
join requesttype rt on f.requesttypenew = rt.RTid
where ${base} and ${isNoise}
group by f.FMailBoxID
order by count(*) desc
offset 0 rows`;

  const [sumRows, typeRows, mbRows] = await Promise.all([
    reportRows(summarySql),
    reportRows(byTypeSql),
    reportRows(byMailboxSql),
  ]);

  const s = sumRows[0] ?? {};
  const totalReactive = num(s.total_reactive);
  const totalNoise = num(s.total_noise);
  return {
    window: { startdate: start, enddate: end, scope: "reactive" },
    totalReactiveTickets: totalReactive,
    totalNoiseTickets: totalNoise,
    noiseSharePct: rate(totalNoise, totalReactive),
    totalHoursWasted: round2(num(s.noise_hours)),
    byType: typeRows.map((r) => {
      const t = String(r.noise_type ?? "Other");
      const tickets = num(r.tickets);
      return {
        type: t,
        tickets,
        hoursWasted: round2(num(r.hours_wasted)),
        sharePct: rate(tickets, totalNoise),
        recommendation: NOISE_RECOMMENDATIONS[t] ?? NOISE_RECOMMENDATIONS.Other,
      };
    }),
    byMailbox: mbRows.map((r) => ({ mailboxId: num(r.mailbox_id), tickets: num(r.tickets) })),
  };
}

/**
 * Trigger a fresh AI re-index (summary / suggestions) on a ticket — POST
 * /Tickets with `_re_index: true`. Best run on a worked/closed ticket so the
 * summary reflects the resolution. The response echoes `_re_index` on success,
 * but the new `faigeneratedsummary` is written asynchronously — wait a moment
 * and re-pull the ticket (e.g. via getTicketsToCategorize) to read it.
 */
export async function triggerTicketAiSummary(ticketId: number): Promise<unknown> {
  return call<unknown>("/Tickets", {
    method: "POST",
    body: JSON.stringify([{ id: ticketId, _re_index: true }]),
  });
}

// ---------- Project management / profitability / resourcing ----------
//
// Projects = FAULTS where REQUESTTYPE.RTIsProject=1 AND the main-project test
// (fmainprojectid IS NULL/0/=faultid). Time rolls up via ACTIONS.AProjectID =
// main project faultid (== FAULTS.FProjectTimeActual). Money links via
// FAULTS.fcontractid. Revenue has THREE sources, detected per project:
//   retainer  -> SUM(PREPAYHISTORY.PPAmount>0) on the contract (dominant model)
//   T&M       -> SUM(ACTIONS.ActionChargeAmount) over the project
//   else      -> fixed-fee/internal (lump invoice lines are often unlinked here)
// Cost = ACTIONS hours × the agent's hourly cost rate, taken from standard Halo
// cost fields only (no per-tenant custom fields): the cost-history rate in
// UnameCostTracking that was in effect when the work was actually done, falling
// back to the agent's current cost rate UNAME.ucostPrice. The work-done date is
// coalesce(Whe_, ActionArrivalDate, ActionDateCreated) — ActionDateCreated can
// be backdated, so Whe_/ActionArrivalDate (when the work happened) are preferred.
// Cost coverage is partial (only some agents have a cost rate set) — always
// surface costCoveragePct before trusting margin. NOTE: this assumes
// ucostPrice/uctCost is an HOURLY cost rate (the Halo standard). A tenant that
// instead stores an annual salary in that field will read inflated labour cost —
// effectiveRate (revenue/hours) is the rate-independent profitability proxy then.

const PROJECT_MAIN = "(p.fmainprojectid is null or p.fmainprojectid = 0 or p.fmainprojectid = p.faultid)";

/** Per-hour agent cost rate: cost-history rate effective when the work was done
 *  (UnameCostTracking), else the agent's current cost (UNAME.ucostPrice). */
const AGENT_HOURLY_COST =
  "coalesce(uct.uctCost, coalesce(try_convert(float, nullif(cast(u.ucostPrice as nvarchar(40)), '')), 0))";

/**
 * Per-project profitability with auto-detected billing model. For each main
 * project (default trailing — actually all active with hours), picks the revenue
 * source by model (retainer prepay top-ups → T&M charges → else unmapped),
 * computes hours (FProjectTimeActual), pay-type-adjusted labour cost with a
 * coverage %, effective rate, and gross margin (flagged reliable only when cost
 * coverage is high). Flags over-servicing (hours >> estimate). Sorted by hours.
 */
export async function getProjectProfitability(
  limit = 50,
  minHours = 1,
): Promise<ProjectProfitability> {
  const top = Math.max(1, Math.min(500, Math.trunc(limit)));
  const mh = Number.isFinite(minHours) ? minHours : 1;
  const sql = `select top ${top}
  p.faultid,
  left(cast(p.Symptom as nvarchar(90)), 90) as project,
  a.aareadesc as client,
  cast(p.FProjectTimeActual as decimal(12,2)) as hours,
  cast(p.estimate as decimal(10,2)) as est_hrs,
  cast(coalesce(pp.prepay_rev, 0) as decimal(12,2)) as prepay_rev,
  cast(coalesce(pp.purchased_hrs, 0) as decimal(12,2)) as purchased_hrs,
  cast(coalesce(con.consumed_hrs, 0) as decimal(12,2)) as consumed_hrs,
  cast(coalesce(act.billable_hours, 0) as decimal(12,2)) as billable_hrs,
  cast(coalesce(act.uncharged_hours, 0) as decimal(12,2)) as uncharged_hrs,
  cast(coalesce(act.prepay_recognised, 0) as decimal(14,2)) as prepay_recognised,
  cast(coalesce(rev.recognised, 0) as decimal(14,2)) as recognised_rev,
  cast(coalesce(act.tm_charge, 0) as decimal(12,2)) as tm_charge,
  cast(coalesce(act.labour_cost, 0) as decimal(12,2)) as labour_cost,
  cast(coalesce(act.costed_hours, 0) as decimal(12,2)) as costed_hours
from faults p
join requesttype rt on p.requesttypenew = rt.RTid
left join area a on a.aarea = p.areaint
left join (select PPContractID, sum(case when PPAmount > 0 then PPAmount else 0 end) as prepay_rev, sum(PPHours) as purchased_hrs from PREPAYHISTORY group by PPContractID) pp on pp.PPContractID = p.fcontractid
left join (select AContractId, sum(ActionPrePayHours) as consumed_hrs from actions group by AContractId) con on con.AContractId = p.fcontractid
left join (select proj, sum(net) as recognised from (select distinct ac.AProjectID as proj, ac.actioninvoicelineid as lineid, idt.IDNet_Amount as net from actions ac join INVOICEDETAIL idt on idt.IDid = ac.actioninvoicelineid where ac.actioninvoicelineid > 0 and ac.AProjectID > 0) d group by proj) rev on rev.proj = p.faultid
left join (
  select ac.AProjectID,
    sum(ac.ActionChargeAmount) as tm_charge,
    sum(coalesce(ac.adefprepayamount,0)) as prepay_recognised,
    sum(case when coalesce(ac.ActionCode,-1) + 1 > 0 then ac.timetaken else 0 end) as billable_hours,
    sum(case when coalesce(ac.ActionCode,-1) + 1 > 0 and coalesce(ac.ActionPrePayHours,0) = 0 and coalesce(ac.ActionChargeAmount,0) = 0 then ac.timetaken else 0 end) as uncharged_hours,
    sum(ac.timetaken * (${AGENT_HOURLY_COST})) as labour_cost,
    sum(case when (${AGENT_HOURLY_COST}) > 0 then ac.timetaken else 0 end) as costed_hours
  from actions ac
  join uname u on u.unum = ac.whoagentid
  left join UnameCostTracking uct on uct.uctAgentId = ac.whoagentid and coalesce(ac.Whe_, ac.ActionArrivalDate, ac.ActionDateCreated) >= uct.uctStartDate and coalesce(ac.Whe_, ac.ActionArrivalDate, ac.ActionDateCreated) < uct.uctEndDate
  group by ac.AProjectID
) act on act.AProjectID = p.faultid
where rt.RTIsProject = 1 and ${PROJECT_MAIN}
  and ${liveFault("p")}
  and p.FProjectTimeActual > ${mh}
order by p.FProjectTimeActual desc`;

  const [rows, currency] = await Promise.all([reportRows(sql), baseCurrency()]);
  const projects: ProjectProfitabilityRow[] = rows.map((r) => {
    const hours = num(r.hours);
    const billableHours = round2(num(r.billable_hrs));
    const prepay = num(r.prepay_rev);
    const purchased = round2(num(r.purchased_hrs));
    const consumed = round2(num(r.consumed_hrs));
    const tm = num(r.tm_charge);
    const labourCost = round2(num(r.labour_cost));
    const costedHours = num(r.costed_hours);
    const est = num(r.est_hrs);
    const estimateHours = est > 1 ? est : null; // <=1 is the 0.75 template placeholder
    const coverage = hours > 0 ? round2((costedHours / hours) * 100) : null;

    // Revenue = recognised, from DISTINCT linked invoice lines (the unified
    // recognition key covers BOTH T&M and prepay deferred-revenue, so no double
    // count); the prepay-DR slice (adefprepayamount) is broken out, T&M = the rest.
    const revenue = round2(num(r.recognised_rev));
    const prepayRecognised = round2(num(r.prepay_recognised));
    const tmRecognised = round2(Math.max(revenue - prepayRecognised, 0));
    let model: ProjectBillingModel;
    let source: string;
    if (prepayRecognised > 0 && tmRecognised > 0) {
      model = "mixed";
      source = "recognised invoice lines — both prepay deferred-revenue and T&M";
    } else if (prepayRecognised > 0) {
      model = "retainer";
      source = "recognised prepay deferred-revenue (adefprepayamount)";
    } else if (tmRecognised > 0) {
      model = "time-and-materials";
      source = "recognised T&M invoice lines";
    } else {
      model = "fixed-fee-or-internal";
      source = "no recognised invoice lines — fixed-fee (often unlinked) or internal";
    }
    const marginReliable = coverage != null && coverage >= 80;
    const grossMargin = revenue > 0 ? round2(revenue - labourCost) : null;
    const effectiveRate = revenue > 0 && hours > 0 ? round2(revenue / hours) : null;
    const soldRate = purchased > 0 && prepay > 0 ? round2(prepay / purchased) : null;
    // Billable hours that were neither deducted from the prepay block NOR billed
    // as a direct charge amount = genuinely uncharged labour. (Time can be billed
    // either by drawing down prepay OR via ActionChargeAmount, so subtracting only
    // prepay-consumed would wrongly count T&M-charged hours as a leak.)
    const unchargedHours = round2(num(r.uncharged_hrs));
    const rateForValue = soldRate ?? effectiveRate;
    const unchargedValue = rateForValue != null ? round2(unchargedHours * rateForValue) : 0;
    // Over-serviced = delivered beyond what was sold: vs the prepay block when there
    // is one (the refilled budget), else vs the stale estimate.
    const overServiced =
      purchased > 0 ? hours > purchased : estimateHours != null && hours > estimateHours * 1.5;
    return {
      projectId: num(r.faultid),
      project: String(r.project ?? "").trim(),
      client: String(r.client ?? ""),
      billingModel: model,
      revenue: round2(revenue),
      revenueSource: source,
      prepayRecognised,
      tmRecognised,
      hours,
      billableHours,
      estimateHours,
      prepayPurchasedHours: purchased,
      prepayConsumedHours: consumed,
      unchargedHours,
      unchargedValue,
      labourCost,
      costCoveragePct: coverage,
      effectiveRate,
      soldRate,
      grossMargin,
      grossMarginPct: grossMargin != null && revenue > 0 ? round2((grossMargin / revenue) * 100) : null,
      marginReliable,
      prepayRevenue: round2(prepay),
      tmCharge: round2(tm),
      overServiced,
    };
  });
  return {
    note:
      "revenue = RECOGNISED revenue from DISTINCT linked invoice lines (ACTIONS.actioninvoicelineid → INVOICEDETAIL.IDNet_Amount); this one key covers BOTH prepay deferred-revenue and T&M, so it is not double-counted. prepayRecognised (adefprepayamount) is the prepay-DR slice; tmRecognised is the rest. effectiveRate = revenue/delivered hours. Projects are refilled PREPAY BLOCKS, not fixed-fee: prepayPurchasedHours (PREPAYHISTORY top-ups) is the real budget — the estimate field is usually a stale placeholder; prepayRevenue is the cash collected (top-ups). For the deferred-revenue ACCOUNT BALANCE (collected vs recognised vs remaining/over-drawn) use getPrepayAccountBalance — it's a contract-level concept and prepay often spans multiple projects. unchargedHours = billable hours NEITHER drawn from prepay NOR billed via a charge amount (genuinely leaked labour). overServiced = delivered hours exceed the purchased block (or, with no prepay, 1.5x the estimate). Labour cost is PARTIAL — trust grossMargin only when marginReliable=true. Amounts in the home currency (see `currency`).",
    currency,
    projects,
  };
}

/**
 * Project portfolio health board: active main projects with % complete (child
 * tasks closed / total), rolled-up hours, estimate, age, and status. Optionally
 * include completed projects. Sorted by child-task count (biggest first).
 */
export async function getProjectPortfolio(
  includeCompleted = false,
  limit = 100,
): Promise<ProjectPortfolio> {
  const top = Math.max(1, Math.min(500, Math.trunc(limit)));
  const statusFilter = includeCompleted ? "" : "and p.status not in (8,9)";
  const sql = `select top ${top}
  p.faultid,
  left(cast(p.Symptom as nvarchar(90)), 90) as project,
  a.aareadesc as client,
  s.tstatusdesc as status,
  coalesce(ch.child_total, 0) as child_total,
  coalesce(ch.child_closed, 0) as child_closed,
  cast(p.FProjectTimeActual as decimal(12,2)) as hours,
  cast(p.estimate as decimal(10,2)) as est_hrs,
  datediff(day, p.FProjectStartDate, getdate()) as age_days
from faults p
join requesttype rt on p.requesttypenew = rt.RTid
left join area a on a.aarea = p.areaint
left join tstatus s on s.Tstatus = p.status
left join (
  select c.fmainprojectid as pid,
    count(*) as child_total,
    sum(case when c.status in (8,9) then 1 else 0 end) as child_closed
  from faults c where c.fmainprojectid > 0 and c.faultid <> c.fmainprojectid and ${liveFault("c")}
  group by c.fmainprojectid
) ch on ch.pid = p.faultid
where rt.RTIsProject = 1 and ${PROJECT_MAIN}
  and ${liveFault("p")} ${statusFilter}
order by coalesce(ch.child_total, 0) desc`;

  const rows = await reportRows(sql);
  return {
    projects: rows.map((r) => {
      const total = num(r.child_total);
      const closed = num(r.child_closed);
      const est = num(r.est_hrs);
      return {
        projectId: num(r.faultid),
        project: String(r.project ?? "").trim(),
        client: String(r.client ?? ""),
        status: String(r.status ?? ""),
        childTasks: total,
        tasksClosed: closed,
        percentComplete: total > 0 ? round2((closed / total) * 100) : null,
        hours: round2(num(r.hours)),
        estimateHours: est > 1 ? est : null,
        ageDays: numOrNull(r.age_days),
      };
    }),
  };
}

/**
 * Forward resource load per technician: booked appointment hours over the next
 * `weeks` (from APPOINTMENT start/end, excluding all-day and deleted) vs a flat
 * weekly capacity (`weeklyCapacityHours`, default 40 — no per-tenant custom
 * fields). scheduledHours counts only TICKET-LINKED appointments (APFaultid>0 =
 * client work); unlinked appointments are internal meetings, reported
 * separately. Utilisation is computed off ticket-linked hours. Flags
 * over-allocated / under-booked. Excludes bots and the Unassigned pseudo-agent.
 */
export async function getResourceForecast(
  weeks = 4,
  weeklyCapacityHours = 40,
): Promise<ResourceForecast> {
  const w = Math.max(1, Math.min(26, Math.trunc(weeks)));
  const weeklyTarget = weeklyCapacityHours > 0 ? weeklyCapacityHours : 40;
  const capacity = round2(weeklyTarget * w);
  const start = new Date().toISOString().slice(0, 10);
  const endD = new Date();
  endD.setUTCDate(endD.getUTCDate() + w * 7);
  const end = endD.toISOString().slice(0, 10);
  const sql = `select
  u.unum as agent_id,
  u.uname as agent,
  count(*) as appointments,
  cast(sum(case when ap.APFaultid > 0 then datediff(minute, ap.APStartDate, ap.APEndDate) / 60.0 else 0 end) as decimal(12,1)) as scheduled_hours,
  cast(sum(case when coalesce(ap.APFaultid,0) = 0 then datediff(minute, ap.APStartDate, ap.APEndDate) / 60.0 else 0 end) as decimal(12,1)) as internal_hours
from APPOINTMENT ap
join uname u on u.unum = ap.APunum
where coalesce(ap.APdeleted,0) = 0 and coalesce(ap.APAllDayEvent,0) = 0
  and ${realAgentFilter("u")}
  and ap.APStartDate >= '${start}' and ap.APStartDate < '${end}'
group by u.unum, u.uname
order by sum(case when ap.APFaultid > 0 then datediff(minute, ap.APStartDate, ap.APEndDate) / 60.0 else 0 end) desc
offset 0 rows`;

  const rows = await reportRows(sql);
  const technicians = rows.map((r) => {
    const scheduled = round2(num(r.scheduled_hours));
    const util = capacity > 0 ? round2((scheduled / capacity) * 100) : null;
    let status = "ok";
    if (util != null) {
      if (util > 100) status = "over-allocated";
      else if (util < 40) status = "under-booked";
    }
    return {
      agentId: num(r.agent_id),
      agent: String(r.agent ?? ""),
      scheduledHours: scheduled,
      internalHours: round2(num(r.internal_hours)),
      appointments: num(r.appointments),
      capacityHours: capacity,
      utilisationPct: util,
      status,
    };
  });
  return { startdate: start, weeks: w, technicians };
}

/** Count weekdays (Mon–Fri) in an inclusive [start, end] date window. */
function weekdaysBetween(start: string, end: string): number {
  const s = new Date(`${start}T00:00:00Z`);
  const e = new Date(`${end}T00:00:00Z`);
  if (e < s) return 0;
  let days = 0;
  for (const d = new Date(s); d <= e; d.setUTCDate(d.getUTCDate() + 1)) {
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) days++;
  }
  return days;
}

/**
 * Per-technician utilisation over a past window, combining three standard
 * sources: booked calendar time (APPOINTMENT), actually-logged work and its
 * billable share (worked = ACTIONS timetaken raw; billable = the billed-hour
 * buckets actionchargehours + actionnonchargehours + actionprepayhours, i.e.
 * invoiceable + agreement-covered + prepay-covered — all billable), and leave
 * (HOLIDAYS) which reduces capacity. Capacity = working weekdays × dailyCapacityHours,
 * minus each agent's leave hours. Returns per-agent and rolled-up:
 *   bookedUtil  = booked / net capacity  (calendar fill)
 *   workedUtil  = worked / net capacity  (effort actually logged)
 *   billableUtil= billable / net capacity (revenue-bearing utilisation)
 *   billability = billable / worked      (quality of the work mix)
 * Flags over-allocated (booked > 100%), under-utilised (worked below target),
 * and low-billability. Only agents with booked or worked hours are returned
 * (excludes bots and the Unassigned pseudo-agent).
 */
export async function getTechnicianUtilization(
  startdate?: string,
  enddate?: string,
  dailyCapacityHours = 8,
  targetUtilisationPct = 75,
): Promise<TechnicianUtilization> {
  const { start, end } = resolveWindow(startdate, enddate, 30);
  const dch = dailyCapacityHours > 0 ? dailyCapacityHours : 8;
  const target = targetUtilisationPct > 0 ? targetUtilisationPct : 75;
  const workingDays = weekdaysBetween(start, end);
  const grossCapacity = round2(workingDays * dch);
  const ex = exclusiveEnd(end);
  const sql = `select
  u.unum as agent_id,
  u.uname as agent,
  cast(coalesce(ap.booked,0) as decimal(14,2)) as booked_hrs,
  cast(coalesce(ap.internal,0) as decimal(14,2)) as internal_hrs,
  cast(coalesce(wk.worked,0) as decimal(14,2)) as worked_hrs,
  cast(coalesce(wk.reactive,0) as decimal(14,2)) as reactive_hrs,
  cast(coalesce(wk.project,0) as decimal(14,2)) as project_hrs,
  cast(coalesce(wk.problem,0) as decimal(14,2)) as problem_hrs,
  cast(coalesce(wk.admin,0) as decimal(14,2)) as admin_hrs,
  cast(coalesce(wk.billable,0) as decimal(14,2)) as billable_hrs,
  cast(coalesce(h.leave_hrs,0) as decimal(14,2)) as leave_hrs
from uname u
left join (select APunum,
    sum(case when APFaultid > 0 then datediff(minute, APStartDate, APEndDate)/60.0 else 0 end) as booked,
    sum(case when coalesce(APFaultid,0) = 0 then datediff(minute, APStartDate, APEndDate)/60.0 else 0 end) as internal
  from APPOINTMENT where coalesce(APdeleted,0)=0 and coalesce(APAllDayEvent,0)=0 and APStartDate >= '${start}' and APStartDate < '${ex}' group by APunum) ap on ap.APunum = u.unum
left join (select ac.whoagentid,
    sum(ac.timetaken) as worked,
    sum(coalesce(ac.actionchargehours,0) + coalesce(ac.actionnonchargehours,0) + coalesce(ac.actionprepayhours,0)) as billable,
    sum(case when f.RequestType in (1,3) then ac.timetaken else 0 end) as reactive,
    sum(case when f.RequestType in (22,23,24) then ac.timetaken else 0 end) as project,
    sum(case when f.RequestType = 4 then ac.timetaken else 0 end) as problem,
    sum(case when coalesce(f.RequestType,0) not in (1,3,4,22,23,24) then ac.timetaken else 0 end) as admin
  from actions ac left join faults f on f.faultid = ac.faultid
  where coalesce(ac.Whe_, ac.ActionArrivalDate, ac.ActionDateCreated) >= '${start}' and coalesce(ac.Whe_, ac.ActionArrivalDate, ac.ActionDateCreated) < '${ex}' group by ac.whoagentid) wk on wk.whoagentid = u.unum
left join (select HTechnicianID, sum(Hduration) as leave_hrs from HOLIDAYS where Hdate >= '${start}' and Hdate < '${ex}' group by HTechnicianID) h on h.HTechnicianID = u.unum
where ${realAgentFilter("u")} and (coalesce(ap.booked,0) > 0 or coalesce(wk.worked,0) > 0)
order by coalesce(wk.worked,0) desc
offset 0 rows`;

  const rows = await reportRows(sql);
  const tot = { capacity: 0, leave: 0, net: 0, booked: 0, internal: 0, worked: 0, billable: 0, reactive: 0, project: 0, problem: 0, admin: 0 };
  const technicians: TechnicianUtilizationRow[] = rows.map((r) => {
    const leave = round2(num(r.leave_hrs));
    const net = round2(Math.max(grossCapacity - leave, 0));
    const booked = round2(num(r.booked_hrs));
    const internal = round2(num(r.internal_hrs));
    const worked = round2(num(r.worked_hrs));
    const billable = round2(num(r.billable_hrs));
    const reactive = round2(num(r.reactive_hrs));
    const project = round2(num(r.project_hrs));
    const problem = round2(num(r.problem_hrs));
    const admin = round2(num(r.admin_hrs));
    const bookedUtil = net > 0 ? round2((booked / net) * 100) : null;
    const internalPct = net > 0 ? round2((internal / net) * 100) : null;
    const workedUtil = net > 0 ? round2((worked / net) * 100) : null;
    const billableUtil = net > 0 ? round2((billable / net) * 100) : null;
    const billability = worked > 0 ? round2((billable / worked) * 100) : null;
    const adminShare = worked > 0 ? round2((admin / worked) * 100) : null;
    tot.capacity += grossCapacity;
    tot.leave += leave;
    tot.net += net;
    tot.booked += booked;
    tot.internal += internal;
    tot.worked += worked;
    tot.billable += billable;
    tot.reactive += reactive;
    tot.project += project;
    tot.problem += problem;
    tot.admin += admin;
    let status = "ok";
    if (workedUtil != null && workedUtil < target * 0.5) status = "under-utilised";
    else if (workedUtil != null && workedUtil < target) status = "below-target";
    if (internalPct != null && internalPct >= 30) {
      status = status === "ok" ? "meeting-heavy" : `${status}, meeting-heavy`;
    }
    if (billability != null && billability < 50 && worked > 0) {
      status = status === "ok" ? "low-billability" : `${status}, low-billability`;
    }
    if (adminShare != null && adminShare >= 40 && worked > 0) {
      status = status === "ok" ? "admin-heavy" : `${status}, admin-heavy`;
    }
    return {
      agentId: num(r.agent_id),
      agent: String(r.agent ?? ""),
      capacityHours: grossCapacity,
      leaveHours: leave,
      netCapacityHours: net,
      bookedHours: booked,
      internalMeetingHours: internal,
      workedHours: worked,
      reactiveHours: reactive,
      projectHours: project,
      problemHours: problem,
      adminHours: admin,
      adminSharePct: adminShare,
      billableHours: billable,
      bookedUtilPct: bookedUtil,
      internalMeetingPct: internalPct,
      workedUtilPct: workedUtil,
      billableUtilPct: billableUtil,
      billabilityPct: billability,
      status,
    };
  });

  return {
    startdate: start,
    enddate: end,
    workingDays,
    dailyCapacityHours: dch,
    targetUtilisationPct: target,
    note:
      "Capacity = working weekdays in window × dailyCapacityHours, minus each agent's leave (HOLIDAYS). Booked = TICKET-LINKED appointment hours (APFaultid>0 = client work); internalMeetingHours = unlinked appointments (internal meetings). worked = ACTIONS timetaken (raw logged effort); billable = the billed-hour buckets actionchargehours (invoiceable) + actionnonchargehours (covered by an agreement) + actionprepayhours (prepay-covered) — all three are billable, just to different places. worked is SPLIT BY ITIL TYPE (FAULTS.requesttype): reactiveHours = Incident+Service-Request (1,3), projectHours = 22/23/24, problemHours = 4 (root-cause), adminHours = Advice/Other (21) + non-ticket time; the four sum to worked. adminSharePct (admin/worked) surfaces how much effort is going to admin/quick-time vs real delivery. billability (billable/worked) measures the work mix; billableUtil (billable/capacity) is the revenue-bearing utilisation. Note worked often exceeds ticket-linked booked because delivery time is logged without a matching calendar appointment. Flags: meeting-heavy (internal ≥30% of capacity), below-target/under-utilised, low-billability, admin-heavy (admin ≥40% of worked).",
    totals: {
      capacityHours: round2(tot.capacity),
      leaveHours: round2(tot.leave),
      netCapacityHours: round2(tot.net),
      bookedHours: round2(tot.booked),
      internalMeetingHours: round2(tot.internal),
      workedHours: round2(tot.worked),
      reactiveHours: round2(tot.reactive),
      projectHours: round2(tot.project),
      problemHours: round2(tot.problem),
      adminHours: round2(tot.admin),
      billableHours: round2(tot.billable),
      bookedUtilPct: tot.net > 0 ? round2((tot.booked / tot.net) * 100) : null,
      internalMeetingPct: tot.net > 0 ? round2((tot.internal / tot.net) * 100) : null,
      workedUtilPct: tot.net > 0 ? round2((tot.worked / tot.net) * 100) : null,
      billableUtilPct: tot.net > 0 ? round2((tot.billable / tot.net) * 100) : null,
      billabilityPct: tot.worked > 0 ? round2((tot.billable / tot.worked) * 100) : null,
    },
    technicians,
  };
}

/**
 * Recurring (managed-services) profitability: monthly recurring revenue vs the
 * support effort delivered for it, with best-effort labour cost / margin and the
 * techs who logged the time. Two grains (`groupBy`):
 *
 *  - "client" (default): the whole-client view some MSPs want — recurring
 *    revenue rolled up per client (marked-recurring invoice lines by IHaarea)
 *    vs ALL time logged on the client's tickets (ACTIONS.timetaken via faultid →
 *    FAULTS.areaint). activeContracts is surfaced for context.
 *  - "contract": the per-contract breakdown — recurring revenue per contract
 *    (the contract is stamped on each generated recurring invoice LINE,
 *    INVOICEDETAIL.IDCHID → CONTRACTHEADER.CHid) vs time logged against that
 *    contract (ACTIONS.AContractId). Revenue not tied to any contract is
 *    reported once as unattributedRevenueMonthly so the rows reconcile to MRR.
 *
 * All figures are for the latest COMPLETE calendar month — actual recurring
 * invoiced that month, never a TTM/12 average. Use getMrrSnapshot.recentMonths
 * for the trailing read.
 *
 * Labour is SPLIT BY ITIL TYPE (FAULTS.requesttype): the recurring fee covers
 * REACTIVE support (Incident 1 + Service Request 3), so the margin is read
 * against the reactive slice only — revenuePerReactiveHour (= revenue ÷ reactive
 * hours), grossMargin (= revenue − reactive labour cost). Project (22/23/24,
 * separately billed), Problem (4, root-cause) and admin/Advice-Other (21 + rest)
 * hours are reported alongside but excluded from the margin so they don't dilute
 * it. Cost uses the agent's stored rate (UnameCostTracking, else ucostPrice) and
 * is PARTIAL — grossMargin only when reactiveCostCoveragePct ≥ 80% (marginReliable);
 * else lead with revenuePerReactiveHour. Rate assumed HOURLY; annual-salary values
 * read inflated — inspect with exploreSchema if margins look off.
 */
export async function getRecurringContractProfitability(
  limit = 50,
  groupBy: "client" | "contract" = "client",
): Promise<RecurringContractProfitability> {
  const top = Math.max(1, Math.min(500, Math.trunc(limit)));
  // Latest COMPLETE calendar month — actual recurring invoiced that month, never
  // a TTM/12 average (which under-reports any tenant with <12 months of billing).
  // Consistent with getMrrSnapshot's headline; use getMrrSnapshot.recentMonths for
  // the trailing multi-window read.
  const head = latestCompleteMonth();
  const winStart = head.start;
  const winEnd = head.end;
  const recurWin = `${RECURRING_LINE} and ih.IHInvoice_Date >= '${winStart}' and ih.IHInvoice_Date < '${winEnd}'`;
  const workDate = "coalesce(ac.Whe_, ac.ActionArrivalDate, ac.ActionDateCreated)";
  const cost = AGENT_HOURLY_COST;
  const labWhere = `ac.timetaken > 0 and ${realAgentFilter("u")} and ${workDate} >= '${winStart}' and ${workDate} < '${winEnd}'`;
  // Labour split by ITIL type (FAULTS.requesttype, carried as f.RequestType):
  // reactive = Incident(1)+Service Request(3) is what the recurring fee covers;
  // project = 22/23/24 (separately billed); problem = 4 (root-cause); admin =
  // Advice/Other(21) + the rest. Cost/coverage/billable are computed on the
  // REACTIVE slice only, since that's what the agreement absorbs. Needs the
  // `ac`/`u`/`uct`/`f` aliases (the labour subqueries join FAULTS).
  const labCols =
    `sum(case when f.RequestType in (1,3) then ac.timetaken else 0 end) as reactive_hours,` +
    ` sum(case when f.RequestType in (22,23,24) then ac.timetaken else 0 end) as project_hours,` +
    ` sum(case when f.RequestType = 4 then ac.timetaken else 0 end) as problem_hours,` +
    ` sum(case when f.RequestType not in (1,3,4,22,23,24) then ac.timetaken else 0 end) as admin_hours,` +
    ` sum(ac.timetaken) as total_hours,` +
    ` sum(case when f.RequestType in (1,3) then coalesce(ac.actionchargehours,0) + coalesce(ac.actionnonchargehours,0) + coalesce(ac.actionprepayhours,0) else 0 end) as reactive_billable,` +
    ` sum(case when f.RequestType in (1,3) then ac.timetaken * ${cost} else 0 end) as reactive_cost,` +
    ` sum(case when f.RequestType in (1,3) and ${cost} > 0 then ac.timetaken else 0 end) as reactive_costed`;
  const uctJoin = `left join UnameCostTracking uct on uct.uctAgentId = ac.whoagentid and ${workDate} >= uct.uctStartDate and ${workDate} < uct.uctEndDate`;

  const byContract = groupBy === "contract";

  // Per-grain SQL. `gid` is the grouping key (client area, or contract CHid).
  const sql = byContract
    ? `select top ${top}
  ch.CHid as gid,
  ch.CHcontractRef as label,
  cast(coalesce(ch.chactive,0) as int) as contract_active,
  a.aarea as client_id,
  a.aareadesc as client,
  cast(rev.rev_net as decimal(14,2)) as rev_net,
  rev.invoices as invoices,
  cast(coalesce(lab.reactive_hours,0) as decimal(14,2)) as reactive_hours,
  cast(coalesce(lab.project_hours,0) as decimal(14,2)) as project_hours,
  cast(coalesce(lab.problem_hours,0) as decimal(14,2)) as problem_hours,
  cast(coalesce(lab.admin_hours,0) as decimal(14,2)) as admin_hours,
  cast(coalesce(lab.total_hours,0) as decimal(14,2)) as total_hours,
  cast(coalesce(lab.reactive_billable,0) as decimal(14,2)) as reactive_billable,
  cast(coalesce(lab.reactive_cost,0) as decimal(14,2)) as reactive_cost,
  cast(coalesce(lab.reactive_costed,0) as decimal(14,2)) as reactive_costed
from CONTRACTHEADER ch
join (
  select id.IDCHID as gid, sum(${RECURRING_LINE_AMT}) as rev_net, count(distinct id.IdIHid) as invoices
  from INVOICEDETAIL id join INVOICEHEADER ih on ih.IHid = id.IdIHid
  where ${recurWin} and coalesce(id.IDCHID,0) <> 0
  group by id.IDCHID
) rev on rev.gid = ch.CHid
left join (
  select ac.AContractId as gid, ${labCols}
  from actions ac join faults f on f.faultid = ac.faultid join uname u on u.unum = ac.whoagentid ${uctJoin}
  where ${labWhere} and coalesce(ac.AContractId,0) <> 0
  group by ac.AContractId
) lab on lab.gid = ch.CHid
left join area a on a.aarea = ch.CHarea
order by rev.rev_net desc`
    : `select top ${top}
  a.aarea as gid,
  a.aareadesc as client,
  cast(rev.rev_net as decimal(14,2)) as rev_net,
  rev.invoices as invoices,
  coalesce(con.active_contracts,0) as active_contracts,
  cast(coalesce(lab.reactive_hours,0) as decimal(14,2)) as reactive_hours,
  cast(coalesce(lab.project_hours,0) as decimal(14,2)) as project_hours,
  cast(coalesce(lab.problem_hours,0) as decimal(14,2)) as problem_hours,
  cast(coalesce(lab.admin_hours,0) as decimal(14,2)) as admin_hours,
  cast(coalesce(lab.total_hours,0) as decimal(14,2)) as total_hours,
  cast(coalesce(lab.reactive_billable,0) as decimal(14,2)) as reactive_billable,
  cast(coalesce(lab.reactive_cost,0) as decimal(14,2)) as reactive_cost,
  cast(coalesce(lab.reactive_costed,0) as decimal(14,2)) as reactive_costed
from area a
join (
  select ih.IHaarea as gid, sum(${RECURRING_LINE_AMT}) as rev_net, count(distinct id.IdIHid) as invoices
  from INVOICEHEADER ih join INVOICEDETAIL id on id.IdIHid = ih.IHid
  where ${recurWin}
  group by ih.IHaarea
) rev on rev.gid = a.aarea
left join (
  select f.areaint as gid, ${labCols}
  from actions ac join faults f on f.faultid = ac.faultid join uname u on u.unum = ac.whoagentid ${uctJoin}
  where ${labWhere}
  group by f.areaint
) lab on lab.gid = a.aarea
left join (
  select CHarea as gid, count(*) as active_contracts from CONTRACTHEADER where coalesce(chactive,0) = 1 group by CHarea
) con on con.gid = a.aarea
order by rev.rev_net desc`;

  // topTechs = who delivered the REACTIVE (managed-services) support.
  const techSql = byContract
    ? `select ac.AContractId as gid, ac.whoagentid as agent_id, max(u.uname) as agent,
  cast(sum(ac.timetaken) as decimal(14,2)) as hours, cast(sum(ac.timetaken * ${cost}) as decimal(14,2)) as cost
from actions ac join faults f on f.faultid = ac.faultid join uname u on u.unum = ac.whoagentid ${uctJoin}
where ${labWhere} and coalesce(ac.AContractId,0) <> 0 and f.RequestType in (1,3)
group by ac.AContractId, ac.whoagentid
order by sum(ac.timetaken) desc
offset 0 rows`
    : `select f.areaint as gid, ac.whoagentid as agent_id, max(u.uname) as agent,
  cast(sum(ac.timetaken) as decimal(14,2)) as hours, cast(sum(ac.timetaken * ${cost}) as decimal(14,2)) as cost
from actions ac join faults f on f.faultid = ac.faultid join uname u on u.unum = ac.whoagentid ${uctJoin}
where ${labWhere} and f.RequestType in (1,3)
group by f.areaint, ac.whoagentid
order by sum(ac.timetaken) desc
offset 0 rows`;

  // Recurring revenue not tied to any contract — only meaningful per-contract.
  const unattributedSql = `select cast(coalesce(sum(${RECURRING_LINE_AMT}),0) as decimal(14,2)) as net
from INVOICEDETAIL id join INVOICEHEADER ih on ih.IHid = id.IdIHid
where ${recurWin} and coalesce(id.IDCHID,0) = 0`;

  const [rows, techRows, currency, unattributedRows] = await Promise.all([
    reportRows(sql),
    reportRows(techSql),
    baseCurrency(),
    byContract ? reportRows(unattributedSql) : Promise.resolve([]),
  ]);

  const techByGid = new Map<number, RecurringContractTech[]>();
  for (const t of techRows) {
    const gid = num(t.gid);
    const arr = techByGid.get(gid) ?? [];
    arr.push({
      agentId: num(t.agent_id),
      agent: String(t.agent ?? ""),
      reactiveHoursMonthly: round2(num(t.hours)),
      reactiveCostMonthly: round2(num(t.cost)),
    });
    techByGid.set(gid, arr);
  }

  const resultRows = rows.map((r) => {
    const gid = num(r.gid);
    const winRev = num(r.rev_net);
    const revenue = round2(winRev);
    const reactiveHours = num(r.reactive_hours);
    const reactiveBillable = num(r.reactive_billable);
    const reactiveCost = round2(num(r.reactive_cost));
    const reactiveCosted = num(r.reactive_costed);
    const coverage = reactiveHours > 0 ? round2((reactiveCosted / reactiveHours) * 100) : null;
    const marginReliable = coverage != null && coverage >= 80;
    const revenuePerReactiveHour = reactiveHours > 0 ? round2(winRev / reactiveHours) : null;
    const reactiveBillableSharePct = reactiveHours > 0 ? round2((reactiveBillable / reactiveHours) * 100) : null;
    const grossMargin = round2(revenue - reactiveCost);
    const grossMarginPct = revenue > 0 ? round2((grossMargin / revenue) * 100) : null;

    const flags: string[] = [];
    if (reactiveHours === 0) flags.push("no-reactive-support");
    if (marginReliable && grossMargin < 0) flags.push("negative-margin");
    else if (marginReliable && grossMarginPct != null && grossMarginPct < 20) flags.push("thin-margin");
    if (coverage != null && coverage < 80) flags.push("low-cost-coverage");
    if (revenuePerReactiveHour != null && revenuePerReactiveHour < 75) flags.push("low-revenue-per-reactive-hour");

    const topTechs = (techByGid.get(gid) ?? [])
      .sort((a, b) => b.reactiveHoursMonthly - a.reactiveHoursMonthly)
      .slice(0, 6);

    const row: RecurringContractProfitabilityRow = {
      clientId: byContract ? num(r.client_id) : gid,
      client: String(r.client ?? ""),
      recurringRevenueMonthly: revenue,
      recurringInvoices: num(r.invoices),
      reactiveHoursMonthly: round2(reactiveHours),
      projectHoursMonthly: round2(num(r.project_hours)),
      problemHoursMonthly: round2(num(r.problem_hours)),
      adminHoursMonthly: round2(num(r.admin_hours)),
      totalHoursMonthly: round2(num(r.total_hours)),
      reactiveBillableSharePct,
      revenuePerReactiveHour,
      reactiveLabourCostMonthly: reactiveCost,
      grossMarginMonthly: marginReliable ? grossMargin : null,
      grossMarginPct: marginReliable ? grossMarginPct : null,
      reactiveCostCoveragePct: coverage,
      marginReliable,
      topTechs,
      flags,
    };
    if (byContract) {
      row.contractId = gid;
      row.contractRef = String(r.label ?? "").trim();
      row.contractActive = num(r.contract_active) === 1;
    } else {
      row.activeContracts = num(r.active_contracts);
    }
    return row;
  });

  return {
    grain: groupBy,
    month: head.label,
    currency,
    unattributedRevenueMonthly: byContract
      ? round2(num(unattributedRows[0]?.net))
      : null,
    note:
      (byContract
        ? "Per-CONTRACT recurring profitability. Revenue is tied to each contract via the generated recurring invoice LINE (INVOICEDETAIL.IDCHID → CONTRACTHEADER.CHid); labour is time logged against that contract (ACTIONS.AContractId). unattributedRevenueMonthly is recurring revenue on lines with no contract id (so rows reconcile to total MRR). "
        : "Per-CLIENT recurring profitability (whole-client view; call with groupBy='contract' for the per-contract breakdown). Revenue is the client's recurring-invoice net; support effort is ALL time logged on the client's tickets; activeContracts is context. ") +
      "All figures are for the latest COMPLETE calendar month (`month`) — actual marked-recurring invoice lines (idrecurringinvoiceid < -1), NEVER a TTM/12 average; for the trailing multi-window read use getMrrSnapshot.recentMonths. Non-monthly cadence: a quarterly/annual contract only shows revenue in its billing month, so judge those across months, not on one. LABOUR IS SPLIT BY ITIL TYPE (FAULTS.requesttype): reactiveHoursMonthly = Incident+Service-Request (1,3) — the support the recurring fee actually covers; projectHoursMonthly (22/23/24, separately billed), problemHoursMonthly (4, root-cause), adminHoursMonthly (Advice/Other 21 + rest) are reported but kept OUT of the margin. revenuePerReactiveHour (recurring ÷ reactive hours) is the RELIABLE managed-services margin proxy — low = lots of covered support per dollar of fee (margin risk), high = light-touch; no agent-cost data needed. reactiveLabourCostMonthly / grossMargin use the agent's stored rate (UnameCostTracking, else UNAME.ucostPrice) but are PARTIAL: most agents have no cost on file (see reactiveCostCoveragePct), so grossMargin is only populated when marginReliable (≥80% coverage) — otherwise lead with revenuePerReactiveHour. Rate assumed HOURLY; annual salaries there read inflated — check with exploreSchema. topTechs = who delivered the most reactive support. Flags: no-reactive-support (fee with ~0 covered support — licensing-only or under-served), negative-margin / thin-margin (reliable only), low-cost-coverage, low-revenue-per-reactive-hour (<75/hr heuristic). Amounts in the home currency (see currency).",
    rows: resultRows,
  };
}

/**
 * Prepay (deferred-revenue) account balance per contract — the contract-level
 * ledger behind the retainer model. PREPAYHISTORY is split by sign rather than
 * net-summed: positive rows = refills (cash invoiced + hours bought); negative
 * rows = hours leaving the block, classified by note into expired (note marks
 * expiry) vs manual deduction (everything else — manual / off-the-books
 * consumption or write-offs). Logged action draw-down (ACTIONS.ActionPrePayHours)
 * is separate and adds to those. remainingHours = refills − consumed − manual −
 * expired (negative = over-drawn); deferredBalance = collected − recognised
 * (ACTIONS.adefprepayamount). Status flags over-drawn, untouched (paid but
 * barely used) and low-balance. Grain is the contract
 * because only a minority carry an explicit project link and many span
 * multiple projects — a client may hold several prepay contracts.
 * Answers questions like "which clients have a negative prepay balance" or
 * "who has untouched prepay". Sorted lowest remaining first (over-drawn on top).
 */
export async function getPrepayAccountBalance(limit = 500): Promise<PrepayAccountBalance> {
  const top = Math.max(1, Math.min(2000, Math.trunc(limit)));
  const sql = `select
  ch.CHid as contract_id,
  a.aareadesc as client,
  cast(coalesce(a.aisinactive,0) as int) as client_inactive,
  cast(coalesce(ch.chactive,0) as int) as active,
  cast(pp.refill_amt as decimal(14,2)) as collected,
  cast(pp.refill_hrs as decimal(12,2)) as purchased_hrs,
  cast(coalesce(act.consumed,0) as decimal(12,2)) as consumed_hrs,
  cast(pp.manual_hrs as decimal(12,2)) as manual_hrs,
  cast(pp.expired_hrs as decimal(12,2)) as expired_hrs,
  cast(coalesce(act.recognised,0) as decimal(14,2)) as recognised,
  coalesce(act.projects,0) as projects_on_contract,
  convert(varchar(10), pp.last_topup, 23) as last_topup
from CONTRACTHEADER ch
join (
  select PPContractID,
    sum(case when pphours > 0 then pphours else 0 end) as refill_hrs,
    sum(case when pphours > 0 then PPAmount else 0 end) as refill_amt,
    -sum(case when pphours < 0 and lower(cast(ppDesc as nvarchar(400))) like '%expir%' then pphours else 0 end) as expired_hrs,
    -sum(case when pphours < 0 and lower(cast(ppDesc as nvarchar(400))) not like '%expir%' then pphours else 0 end) as manual_hrs,
    max(case when pphours > 0 then ppdate else null end) as last_topup
  from PREPAYHISTORY where PPContractID > 0 group by PPContractID
) pp on pp.PPContractID = ch.CHid
left join area a on a.aarea = ch.CHarea
left join (select AContractId, sum(coalesce(ActionPrePayHours,0)) as consumed, sum(coalesce(adefprepayamount,0)) as recognised, count(distinct case when AProjectID > 0 then AProjectID end) as projects from actions group by AContractId) act on act.AContractId = ch.CHid
order by pp.refill_hrs - pp.expired_hrs - pp.manual_hrs - coalesce(act.consumed,0)
offset 0 rows fetch next ${top} rows only`;

  const [rows, currency] = await Promise.all([reportRows(sql), baseCurrency()]);
  const accounts: PrepayAccountRow[] = rows.map((r) => {
    const collected = round2(num(r.collected));
    const purchased = round2(num(r.purchased_hrs)); // gross refill hours
    const consumed = round2(num(r.consumed_hrs)); // logged via actions
    const manualDeduction = round2(num(r.manual_hrs)); // negative PREPAYHISTORY rows (manual / off-the-books)
    const expired = round2(num(r.expired_hrs)); // negative rows the note marks expired (lost)
    const recognised = round2(num(r.recognised));
    // Refills minus everything that left the block: action consumption, manual
    // deductions, and expiry. Negatives are separate from action consumption
    // (action draw-down never writes a negative PREPAYHISTORY row), so they add.
    const used = round2(consumed + manualDeduction);
    const remaining = round2(purchased - used - expired);
    const deferred = round2(collected - recognised);
    const overDrawn = remaining < -0.5;
    const untouched = purchased > 0.5 && used <= purchased * 0.02;
    let status = "healthy";
    if (overDrawn) status = "over-drawn";
    else if (untouched) status = "untouched";
    else if (purchased > 0 && remaining <= purchased * 0.1) status = "low-balance";
    return {
      contractId: num(r.contract_id),
      client: String(r.client ?? ""),
      clientActive: num(r.client_inactive) === 0,
      active: num(r.active) === 1,
      collectedAmount: collected,
      purchasedHours: purchased,
      consumedHours: consumed,
      manualDeductionHours: manualDeduction,
      expiredHours: expired,
      remainingHours: remaining,
      recognisedAmount: recognised,
      deferredBalance: deferred,
      blendedRate: purchased > 0 ? round2(collected / purchased) : null,
      projectsOnContract: num(r.projects_on_contract),
      lastTopUp: r.last_topup ? String(r.last_topup) : null,
      status,
      overDrawn,
      untouched,
    };
  });
  return {
    note:
      "Per-contract prepay (deferred-revenue) account. PREPAYHISTORY rows are split by sign, NOT net-summed: purchasedHours/collectedAmount = positive refills only (top-ups invoiced); manualDeductionHours = negative rows (manual / off-the-books consumption or write-offs); expiredHours = negative rows whose note marks them expired (lost time). consumedHours = logged action draw-down (ACTIONS.ActionPrePayHours) — separate from the manual negatives, so they add. remainingHours = purchased − consumed − manualDeduction − expired (negative = over-drawn). recognisedAmount = ACTIONS.adefprepayamount; deferredBalance = collected − recognised (negative = recognised beyond cash collected). status: over-drawn / untouched (paid but ~unused) / low-balance / healthy. A high manualDeductionHours vs consumedHours means time is being taken off the block manually rather than via logged work. clientActive (AREA.aisinactive) flags churned clients still holding a balance. Grain is the contract — a client may hold several. Amounts in the home currency (see `currency`).",
    currency,
    accounts,
  };
}

export { HaloApiError };