import { getAccessToken, refresh, NotAuthenticatedError } from "./auth";
import { getConfig, getTokens } from "./config";
import { storage } from "./storage";
import type {
  HaloClient,
  HaloUser,
  HaloTicket,
  HaloAction,
  HaloTicketType,
  HaloStatus,
  HaloAgent,
  HaloClientCache,
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
} from "./types";

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

  // 401 → one retry after forced refresh.
  if (res.status === 401 && !retried) {
    const tokens = getTokens();
    if (tokens) {
      await refresh(tokens.refreshToken);
      return call<T>(path, init, true);
    }
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
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
 * (hundreds of entries) that this is fast and avoids hitting the API on every keystroke. */
let _cannedTextCache: HaloCannedText[] | undefined;

export async function listCannedText(force = false): Promise<HaloCannedText[]> {
  if (_cannedTextCache && !force) return _cannedTextCache;
  const q = new URLSearchParams({
    showall: "true",
    entity: "0",
    access_control_level: "2",
  });
  const res = await call<HaloCannedText[] | { canned_texts: HaloCannedText[] }>(
    `/CannedText?${q}`,
  );
  _cannedTextCache = Array.isArray(res) ? res : (res.canned_texts ?? []);
  return _cannedTextCache;
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

/** Halo stores canned-text groups in the shared /Lookup table under lookupid=45. */
let _cannedTextGroupsCache: HaloCannedTextGroup[] | undefined;

export async function listCannedTextGroups(force = false): Promise<HaloCannedTextGroup[]> {
  if (_cannedTextGroupsCache && !force) return _cannedTextGroupsCache;
  const q = new URLSearchParams({
    lookupid: "45",
    showallcodes: "true",
    access_control_level: "2",
  });
  const res = await call<HaloCannedTextGroup[]>(`/Lookup?${q}`);
  // valueint1=0 is the Tickets/email type; 1 is Chat. Keep Tickets only — the
  // Outlook plug-in is composing email, not chat.
  _cannedTextGroupsCache = (Array.isArray(res) ? res : []).filter(
    (g) => g.valueint1 == null || g.valueint1 === 0,
  );
  return _cannedTextGroupsCache;
}

export async function createCannedText(
  payload: CreateCannedTextPayload,
): Promise<HaloCannedText> {
  const res = await call<HaloCannedText[]>("/CannedText", {
    method: "POST",
    body: JSON.stringify([payload]),
  });
  // Invalidate cache so the new entry appears in the next search.
  _cannedTextCache = undefined;
  return res[0];
}

export async function createCannedTextGroup(name: string): Promise<HaloCannedTextGroup> {
  const res = await call<HaloCannedTextGroup[]>("/Lookup", {
    method: "POST",
    body: JSON.stringify([{ lookupid: 45, name, valueint1: 0 }]),
  });
  _cannedTextGroupsCache = undefined;
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

let _ticketTypesCache: HaloTicketType[] | undefined;
let _agentsCache: HaloAgent[] | undefined;
let _statusesCache: HaloStatus[] | undefined;
let _prioritiesCache: HaloPriority[] | undefined;

export async function listTicketTypes(force = false): Promise<HaloTicketType[]> {
  if (_ticketTypesCache && !force) return _ticketTypesCache;
  // Prefer the list ClientCache already loaded — it's the same set Halo's own
  // UI uses, and we've already paid the round-trip on app bootstrap. Falls
  // through to /api/TicketType with the same flags Halo's UI sends when
  // ClientCache isn't loaded yet (older tenants, refresh path).
  const cached = getCachedClientCache();
  if (cached?.tickettypes && Array.isArray(cached.tickettypes)) {
    _ticketTypesCache = cached.tickettypes.filter((t) => !t.inactive);
    return _ticketTypesCache;
  }
  const res = await call<{ tickettypes: HaloTicketType[] } | HaloTicketType[]>(
    "/TicketType?showall=true&showinactive=false&include_defaults=true",
  );
  _ticketTypesCache = (Array.isArray(res) ? res : res.tickettypes).filter((t) => !t.inactive);
  return _ticketTypesCache;
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
  if (_agentsCache && !force) return _agentsCache;
  const res = await call<{ agents: HaloAgent[] } | HaloAgent[]>(
    "/Agent?includeinactive=false",
  );
  _agentsCache = (Array.isArray(res) ? res : res.agents).filter((a) => !a.inactive);
  return _agentsCache;
}

export async function listStatuses(force = false): Promise<HaloStatus[]> {
  if (_statusesCache && !force) return _statusesCache;
  const res = await call<{ statuses: HaloStatus[] } | HaloStatus[]>(
    "/Status?includeinactive=false",
  );
  _statusesCache = (Array.isArray(res) ? res : res.statuses).filter((s) => !s.inactive);
  return _statusesCache;
}

export async function listPriorities(force = false): Promise<HaloPriority[]> {
  if (_prioritiesCache && !force) return _prioritiesCache;
  const res = await call<{ priorities: HaloPriority[] } | HaloPriority[]>(
    "/Priority?includeinactive=false",
  );
  _prioritiesCache = (Array.isArray(res) ? res : res.priorities).filter((p) => !p.inactive);
  return _prioritiesCache;
}

export function clearReferenceCache() {
  _ticketTypesCache = undefined;
  _agentsCache = undefined;
  _statusesCache = undefined;
  _prioritiesCache = undefined;
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

export { HaloApiError };
