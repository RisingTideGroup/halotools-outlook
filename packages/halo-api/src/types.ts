// Minimal shapes for the HaloPSA endpoints we use.

export interface HaloUser {
  id: number;
  name: string;
  emailaddress?: string;
  client_id?: number;
  client_name?: string;
  site_id?: number;
  site_name?: string;
  inactive?: boolean;
  phonenumber?: string;
  mobile_number?: string;
  jobtitle?: string;
  tags?: Array<{ value: string }>;
}

export interface HaloClient {
  id: number;
  name: string;
  inactive?: boolean;
  client_email_address_domain?: string;
  accountmanager_name?: string;
  accountmanager_id?: number;
  /** Default site Halo associates new users with. Required to create a contact. */
  main_site_id?: number;
  main_site_name?: string;
  tags?: Array<{ value: string }>;
}

export interface CreateContactPayload {
  name: string;
  emailaddress: string;
  client_id?: number;
  phonenumber?: string;
  site_id?: number;
}

export interface HaloTicketType {
  id: number;
  name: string;
  /** Surface where this type is usable: "tickets" / "opps" / "projects" (plural). */
  use: string;
  inactive?: boolean;
  /** Whether agents are allowed to pick this type when creating. False = hidden from the agent picker. */
  agentscanselect?: boolean;
  enduserscanselect?: boolean;
  anonymouscanselect?: boolean;
  /** Visible at all in any picker. Some types are flagged invisible without being inactive. */
  visible?: boolean;
  /** Per-type email subject tag overrides from /api/TicketType/{id}. When set,
   *  Halo stamps this type's tickets with these tags instead of the system-wide
   *  email_start_tag / email_end_tag from /api/Control. Empty string = use system default. */
  email_start_tag_override?: string;
  email_end_tag_override?: string;
}

/** Tenant-wide email and UI settings from GET /api/Control.
 *  The endpoint returns hundreds of keys; we type the ones we use. */
export interface HaloControl {
  /** Prefix Halo stamps before the ticket ID in email subjects, e.g. "[Ticket #". */
  email_start_tag?: string;
  /** Suffix after the ticket ID, e.g. "]". */
  email_end_tag?: string;
  [k: string]: unknown;
}

export interface HaloStatus {
  id: number;
  name: string;
  /** Status category code (0 = regular, 1 = order, 2 = item, 3 = special). NOT a label string. */
  type?: number;
  /** Hex colour Halo assigns to the status — what we render on the pill. */
  colour?: string;
  /** SLA behaviour: "removehold" | "hold" | "none". Useful as a heuristic for closed-ness. */
  slaaction?: string;
  inactive?: boolean;
}

/** Charge rate code — what Halo applies as the billing rate for time on an
 *  action. Pulled from ClientCache.lookups where lookupid === 17. id 0 is
 *  the conventional "No Charge" entry. */
export interface HaloChargeRate {
  /** Used as chargerate_id on action/ticket payloads. 0 == No Charge. */
  id: number;
  name: string;
  /** Hex display color from Halo's lookup config. */
  colour?: string;
}

export interface HaloAgent {
  id: number;
  name: string;
  email?: string;
  inactive?: boolean;
  /** HTML signature configured on the agent's Halo profile. May be empty/null
   *  for agents who haven't set one. When present and an exact substring of an
   *  outbound email body, the add-in strips it from note_html so the action's
   *  short-form note isn't dominated by the signature block. */
  signature?: string;
  /** Free-text job title shown next to the agent's name. */
  jobtitle?: string;
  /** Hex color the agent picked for themselves; used as an accent in their
   *  Halo UI. We display it as the avatar/border color in the add-in header
   *  so the surface feels continuous with Halo. */
  colour?: string;
}

/** Subset of GET /api/ClientCache we actually consume. The full response is
 *  ~3MB and includes agents, mailboxes, templates, address book, control
 *  flags, etc. We bootstrap once per session from this single endpoint
 *  rather than making per-feature calls (listAgents, etc.). */
export interface HaloClientCache {
  /** The signed-in agent's full record — same shape as GET /api/agent/me. */
  agent: HaloAgent;
  /** All agents in the tenant. Replaces listAgents() for pickers / Assign to. */
  agents: HaloAgent[];
  /** Inbound/outbound email integrations. NOTE: these are NOT the same as
   *  Halo's "sales mailboxes" — that's a separate concept exposed via
   *  /api/SalesMailbox. Useful for display only. */
  mailboxes: HaloMailbox[];
  /** All ticket types — same shape as /api/TicketType. Includes tickets,
   *  opportunities, and projects (filter via ticketTypesForAgentCreate). */
  tickettypes: HaloTicketType[];
  /** Halo's lookup tables. Big mixed list (thousands of entries). Filter
   *  by `lookupid` to find a specific category, e.g. 17 == Charge Rates.
   *  Use getChargeRates() rather than indexing directly. */
  lookups: HaloLookup[];
  /** Tenant-wide config flags. Subset typed here; access via getControl(). */
  control: HaloControlFlags;
}

export interface HaloMailbox {
  id: number;
  name: string;
  smtpaddress?: string;
  azureemail?: string;
  display_address?: string;
  enabled?: boolean;
  /** Inbound parse method. 0 = outbound-only (Halo does NOT ingest mail sent
   *  here), non-zero = parses inbound. Used to decide whether sending a reply
   *  to this address would be double-logged by native intake. */
  inbound_method?: number;
}

/** A row from ClientCache.lookups. lookupid groups rows into categories
 *  (17 == Charge Rate Names, see ClientCache content). custom2 commonly
 *  holds a hex color, but the field's meaning varies by category. */
export interface HaloLookup {
  lookupid: number;
  id: number;
  name: string;
  custom1?: string;
  custom2?: string;
  [k: string]: unknown;
}

/** A "Sales Mailbox" group from /api/SalesMailbox/:id?includedetails=true.
 *  Each group bundles N individual sales mailbox configs (one per agent
 *  with a shared/sales mailbox setup). */
export interface HaloSalesMailboxGroup {
  id: number;
  name: string;
  /** Per-agent mailbox configs inside this group. Populated only when the
   *  request includes includedetails=true. */
  mailboxes?: HaloSalesMailbox[];
}

/** Per-agent sales mailbox config — the ID we want for `sales_mailbox_override_id`
 *  on action payloads. Matched against the signed-in agent's email via either
 *  `name` (the mailbox address itself) or `linked_agent_email`. */
export interface HaloSalesMailbox {
  /** THE id used as `sales_mailbox_override_id` on action payloads. */
  id: number;
  smid?: number;
  /** Usually the mailbox's own email address, e.g. "agent@company.com". */
  name?: string;
  linked_agent?: number;
  linked_agent_name?: string;
  linked_agent_email?: string;
  enableautomatching?: boolean;
  match_type?: number;
}

/** Tenant-wide config and branding pulled from ClientCache.control. The full
 *  block has hundreds of keys; we type only the ones we surface in the UI. */
export interface HaloControlFlags {
  /** "Halo PSA" — the product name shown in their tenant. */
  appname?: string;
  /** The tenant's licensed company name, e.g. "Rising Tide Group". */
  license_name?: string;
  /** Primary brand color hex, e.g. "#053553". Used as Fluent accent so the
   *  add-in matches the Halo UI the agent is used to. */
  app_colour?: string;
  /** Navigation/header color hex; usually equals app_colour but can differ. */
  nav_colour?: string;
  /** Tenant slug (e.g. "risingtide") and Halo URL alias. */
  tenant_id?: string;
  tenantalias?: string;
}

export interface HaloPriority {
  /** Halo's GUID identifier. NOT the value you compare to ticket.priority_id. */
  id: string;
  name: string;
  /** Numeric priority ID — THIS is what ticket.priority_id references. */
  priorityid: number;
  colour?: string;
  inactive?: boolean;
  /**
   * SLA scoping (Halo's response uses `slaid`, no underscore). A priority
   * without slaid is global; otherwise it only applies to tickets on that SLA.
   */
  slaid?: number;
}

export interface HaloTicket {
  id: number;
  summary: string;
  details?: string;
  status_id: number;
  statusname?: string;
  client_id?: number;
  client_name?: string;
  user_id?: number;
  user_name?: string;
  // Halo's REST shape for the assigned agent is inconsistent across versions:
  // some tenants return agent_id/agent_name, others agentname or assignedagent_*,
  // and the nested includedetails response uses `agent: { id, name }`.
  agent_id?: number;
  agent_name?: string;
  agentname?: string;
  assignedagent_id?: number;
  assignedagent_name?: string;
  agent?: { id?: number; name?: string };
  priority_id?: number;
  priorityname?: string;
  sla_id?: number;
  tickettype_id?: number;
  category_1?: string;
  dateoccurred?: string;
  dateopened?: string;
  /** ISO datetime. Halo's actual field name is `targetdate` (no underscore). */
  targetdate?: string;
  /** Some Halo versions expose a hard deadline separately. Empty/zero-date when unset. */
  deadlinedate?: string;
  customfields?: Array<{ name: string; value: unknown }>;
}

export interface HaloAction {
  id: number;
  ticket_id: number;
  outcome: string;
  note: string;
  who?: string;
  datetime?: string;
  actionnumber?: number;
}

export interface HaloAttachmentInline {
  filename: string;
  data_base64: string;
  contenttype?: string;
  isimage?: boolean;
}

export interface CreateActionPayload {
  ticket_id: number;
  outcome: string;
  note: string;
  hiddenfromuser?: boolean;
  /** Literal Halo column that drives the Email-tab visibility filter:
   *  the tab shows actions where `emailto IS NOT NULL AND actionhide <> 1`.
   *  Always set this explicitly — Halo doesn't reliably default it from
   *  `hiddenfromuser`. 0 = visible, 1 = hidden. */
  actionhide?: number;
  attachments?: HaloAttachmentInline[];
  emailfrom?: string;
  emailfromname?: string;
  emailsubject?: string;
  /** Decimal hours spent on this action (e.g., 0.25 for 15 minutes). */
  timetaken?: number;
  /** Charge rate id from ClientCache.lookups (lookupid 17). 0 == No Charge. */
  chargerate?: number;
  /** RFC 5322 Message-ID of the source email — Halo threads on this natively. */
  internetmessageid?: string;
  /** Parent's Message-ID from the In-Reply-To header. */
  inreplyto?: string;
  /** Space-separated ancestor Message-IDs from the References header. */
  references?: string;
  /** Exchange EWS ItemId of the source email (Office.context.mailbox.item.itemId).
   *  Halo's native email intake stamps this on every action it ingests so the
   *  action has a back-reference to the original message in the mailbox. Setting
   *  it from the add-in matches that behavior: "Open in Outlook" links work,
   *  Halo dedupes against re-logged emails, and reply-from-Halo flows can
   *  thread back to the source message. */
  mailentryid?: string;
  /** "I" for inbound (received from customer), "O" for outbound (sent by
   *  agent). Halo uses this to render the action with the right icon/color
   *  and to determine threading direction. */
  emaildirection?: "I" | "O";
  /** Always 2 ("delivered/recorded") for actions logged by the add-in. This
   *  is the guard that stops Halo from queuing the action for actual send —
   *  we're recording an email that already happened, not asking Halo to send
   *  one on our behalf. */
  email_status?: number;
  /** Plain-text recipients (semicolon-separated, matches native intake format). */
  emailto?: string;
  /** Plain-text CC recipients. */
  emailcc?: string;
  /** Sender email address (literal RFC From: header value, not display name). */
  emailfromaddress?: string;
  /** Full original email body (plain text), including quoted thread. Halo's
   *  native intake fills this on every action; matches that behavior. */
  emailbody?: string;
  /** Full original email body (HTML), including quoted thread. */
  emailbody_html?: string;
  /** For outbound mail: overrides the From: address shown in Halo when
   *  different from the mailbox default. Pair with from_mailbox_id: -2. */
  from_address_override?: string;
  /** -2 signals "use sales mailbox / overridden from address" on outbound
   *  actions. The native sales-mailbox flow stamps this; we match it. */
  from_mailbox_id?: number;
  /** Per-agent sales mailbox setup id resolved from /api/SalesMailbox.
   *  Omit when the tenant doesn't have sales mailbox functionality or the
   *  agent has no mailbox configured — Halo falls back to tenant defaults. */
  sales_mailbox_override_id?: number;
  /** Halo customer ("user") this action is on — sets the action to be from-customer. */
  user_id?: number;
  /** Some Halo versions require this explicit field instead of (or alongside) user_id. */
  actionby_user_id?: number;
  /** Agent (employee) attribution. Set on outbound mail so the action shows
   *  as agent-originated; omit on inbound so Halo treats it as customer-from. */
  agent_id?: number;
  /** Always 0 — Halo doesn't need the resolved outcome id on POST. */
  outcome_id?: number;
  /** Flag that drives Halo's "Updated by User" automation triggers.
   *  true on inbound (customer posted), false on outbound (agent posted). */
  _isuserupdate?: boolean;
  /** HTML body of the new content (no quoted history). Paired with `note`
   *  which carries the plain-text equivalent — Halo requires both. */
  note_html?: string;
  /** Canonical email subject — replaces legacy `emailsubject`. */
  emailsubjectnew?: string;
  /** Display address of the Halo mailbox that received the email, formatted
   *  `"Display Name" <email>`. Sourced from the ticket record's mailbox info. */
  emailtonew?: string;
  /** ISO datetime without trailing Z, e.g. "2026-06-07T20:28:41.657".
   *  Inbound: when the email was received. Outbound: when the email was sent. */
  dateemailed?: string;
  /** Outlook importance class: "low" | "normal" | "high". */
  emailimportance?: string;
  /** Display name of the author Halo shows on the action's timeline entry. */
  who?: string;
  /** Halo agent id of the author. Use -1 on inbound — sender is not an agent. */
  who_agentid?: number;
  /** Author type discriminator: 1 = agent (outbound), 2 = user (inbound). */
  who_type?: number;
}

export interface CreateTicketPayload {
  summary: string;
  details: string;
  client_id?: number;
  user_id?: number;
  site_id?: number;
  tickettype_id?: number;
  agent_id?: number;
  priority_id?: number;
  category_1?: string;
  attachments?: HaloAttachmentInline[];
  customfields?: Array<{ name: string; value: string | number | boolean }>;
  /** Email source fields — when present, Halo creates the initial action as an email
   *  and stamps internetmessageid on it, enabling native RFC-based threading. */
  emailfrom?: string;
  emailfromname?: string;
  emailsubject?: string;
  internetmessageid?: string;
  inreplyto?: string;
  references?: string;
  /** Exchange EWS ItemId of the source email (Office.context.mailbox.item.itemId).
   *  Stamped on the initial action so the ticket-from-email path matches Halo's
   *  native intake behavior. See CreateActionPayload.mailentryid for details. */
  mailentryid?: string;
  /** See CreateActionPayload.emaildirection. */
  emaildirection?: "I" | "O";
  /** See CreateActionPayload.email_status. Always 2 from the add-in. */
  email_status?: number;
  emailto?: string;
  emailcc?: string;
  emailfromaddress?: string;
  emailbody?: string;
  emailbody_html?: string;
  from_address_override?: string;
  from_mailbox_id?: number;
  sales_mailbox_override_id?: number;
  /** Halo control flags to bypass server-side validation prompts.
   *  _novalidate skips required-custom-field enforcement (so the add-in
   *  can create from email without forcing the agent to fill in fields
   *  configured as required on the chosen ticket type); _forcereassign
   *  suppresses the "are you sure?" dialog when Halo would normally
   *  prompt about reassignment. Together they mirror what Halo's own
   *  email intake does — silent create, no popups. */
  _novalidate?: boolean;
  _forcereassign?: boolean;
  // ---- Initial-action email fields (mirror of CreateActionPayload) ----
  outcome_id?: number;
  _isuserupdate?: boolean;
  /** Plain-text body of the initial action. Pair with note_html which carries
   *  the HTML. `details` remains the ticket-body field on the ticket itself. */
  note?: string;
  note_html?: string;
  emailsubjectnew?: string;
  emailtonew?: string;
  dateemailed?: string;
  emailimportance?: string;
  who?: string;
  who_agentid?: number;
  who_type?: number;
}

/** Partial update payload for an existing ticket. Halo accepts mutated fields only. */
export interface UpdateTicketPayload {
  id: number;
  status_id?: number;
  agent_id?: number;
  priority_id?: number;
  customfields?: Array<{ name: string; value: string | number | boolean }>;
  /** ISO datetime for the ticket target / due date. Halo expects this exact field name on writes. */
  targetdate?: string;
  /** Category fields. NOTE the off-by-one: API `category_1` == DB `category2` == the
   *  PRIMARY categorisation (CATEGORYDETAIL CDType=2). `categoryid_1` takes the CDid. */
  category_1?: string;
  categoryid_1?: number;
  category_2?: string;
  categoryid_2?: number;
  category_3?: string;
  categoryid_3?: number;
  category_4?: string;
  categoryid_4?: number;
}

/**
 * Knowledge base article shape from /KBArticle.
 * Body lives in `faq_answer` on most tenants; some older tenants surface it under `details`.
 * Callers should try faq_answer first, then fall back to details.
 */
export interface HaloKbArticle {
  id: number;
  name: string;
  faq_answer?: string;
  details?: string;
  tags?: Array<{ value: string }>;
}

/**
 * Saved canned-text entry from /CannedText.
 * - text: plain-text body (often older imports)
 * - html: rich-HTML body (what we insert into compose)
 * - group_id: foreign key to /Lookup?lookupid=45 (canned-text groups)
 * - restriction_type: 0 = open, 2 = agent-restricted, 3 = department-restricted
 */
export interface HaloCannedText {
  id: number;
  guid?: string;
  name: string;
  group_id: number;
  text?: string;
  html?: string;
  restriction_type?: number;
  is_favourite?: boolean;
  entity?: number;
}

/** Lookup entry from /Lookup?lookupid=45 — Halo's canned-text group list. */
export interface HaloCannedTextGroup {
  id: number;
  name: string;
  /** 0 = Tickets/email type, 1 = Chat. We default new groups to 0. */
  valueint1?: number;
  sequence?: number;
}

/**
 * CRM note attached to a client, site, or user. The same /CRMNote endpoint is
 * used regardless of scope — caller picks the *_id field to filter / write.
 */
export interface HaloCRMNote {
  id: number;
  client_id?: number;
  site_id?: number;
  user_id?: number;
  datetime: string;
  who_agentid?: number;
  subject?: string;
  note: string;
  /** Decimal hours, e.g. 0.0333 = 2 minutes. */
  timetaken?: number;
  hide_time_taken?: boolean;
  satisfaction?: string;
  add_to_calendar?: boolean;
  /** Halo auto-creates a ticket from some notes; this is the resulting ticket id. */
  ticketid?: number;
}

export interface CreateCRMNotePayload {
  /** Exactly one of these three scopes should be set. */
  client_id?: number | string;
  site_id?: number | string;
  user_id?: number | string;
  subject: string;
  note: string;
  /** Decimal hours. */
  timetaken?: number;
  hide_time_taken?: boolean;
  add_to_calendar?: boolean;
}

/**
 * Activity feed item from /Feed. Aggregates actions, notes, status changes, and
 * other events across the entities related to the queried scope (client/site/user).
 */
export interface HaloFeedItem {
  id: number;
  datetime: string;
  /** Halo's internal type discriminator; varies by tenant. 0 = action in our test tenant. */
  entitytype: number;
  agent_id?: number;
  user_id?: number;
  note?: string;
  outcome?: string;
  /** Display details about the actor who triggered the feed item. */
  who_name?: string;
  who_initials?: string;
  who_imgpath?: string;
  who_colour?: string;
  who_type?: number;
  /** Generic pointers to whatever entity the feed item references. */
  content_id1?: number;
  content_id2?: number;
}

export interface HaloFeedResponse {
  record_count: number;
  feed: HaloFeedItem[];
}

export interface CreateCannedTextPayload {
  name: string;
  text: string;
  html: string;
  group_id?: number;
  /** Default 0 (open). 2 restricts to listed agents, 3 to listed departments. */
  restriction_type?: number;
}

// ---------- Analytics surface (KPI tools) ----------

/**
 * Recurring invoice (contract). Source for MRR.
 * - `revenue` is net (use this for MRR); `total` is gross including tax.
 * - `period` is an integer enum — see periodToMonthlyFactor for the mapping.
 * - `disabled: true` = paused / cancelled, exclude from MRR.
 */
export interface HaloRecurringInvoice {
  id: number;
  client_id?: number;
  client_name?: string;
  revenue?: number;
  total?: number;
  /** Cadence (STDREQUEST.StdPeriod): 1=weekly, 2=monthly, 3=yearly, 4=quarterly,
   *  7=3-yearly, 8=2-yearly, 9=4-yearly, else 5-yearly. See periodToMonthlyFactor. */
  period?: number;
  disabled?: boolean;
  contract_id?: number;
}

/**
 * Single timesheet row — one agent × one day. Source for utilization.
 * Halo's /Timesheet endpoint returns a FLAT array (not a wrapped object),
 * unlike almost every other list endpoint — see listTimesheets.
 */
export interface HaloTimesheet {
  id?: number;
  agent_id?: number;
  date?: string;
  chargeable_hours?: number;
  target_hours?: number;
  actual_hours?: number;
}

/** Per-client contract (separate concept from RecurringInvoice in Halo). */
export interface HaloContract {
  id: number;
  client_id?: number;
  client_name?: string;
  name?: string;
  status?: string;
  active?: boolean;
  inactive?: boolean;
  startdate?: string;
  enddate?: string;
}

/**
 * Sales opportunity. Halo represents opportunities as a kind of ticket with
 * `tickettype.use === "opps"`, so list responses are still ticket-shaped.
 */
export interface HaloOpportunity {
  id: number;
  summary?: string;
  client_id?: number;
  client_name?: string;
  status_id?: number;
  statusname?: string;
  oppvalue?: number;
  oppstatus?: string;
  dateoccurred?: string;
}

/** MRR snapshot returned by getMrrSnapshot. */
export interface MrrSnapshot {
  /** Headline MRR = recurring invoiced in the latest COMPLETE calendar month
   *  (actual marked-recurring invoice lines, not a TTM/12 average). */
  mrr: number;
  /** The calendar month (YYYY-MM) the headline mrr is read from. */
  mrrMonth: string;
  /** Recurring billings by month, latest first: the in-progress month (partial)
   *  plus trailing complete months — for the multi-window read. */
  recentMonths: { month: string; recurring: number; invoices: number; partial: boolean }[];
  /** distinct recurring streams that billed in the headline month. */
  recurringStreams: number;
  /** Per-client recurring for the headline month, sorted by monthlyRevenue desc. */
  byClient: { clientId: number; client: string; invoices: number; monthlyRevenue: number; pctOfMrr: number | null }[];
  /** Share of MRR from the single biggest client (concentration risk). */
  topClientPct: number | null;
  presentation: string;
}

/** Utilization snapshot returned by getTechnicianUtilizationSnapshot. */
export interface UtilizationSnapshot {
  startdate: string;
  enddate: string;
  totalChargeableHours: number;
  totalTargetHours: number;
  utilizationRate: number | null;
  perAgent: { agent_id: number; agent_name?: string; chargeable: number; target: number; rate: number | null }[];
}

/** Combined "give me the dashboard" KPI result. */
export interface MspKpis {
  mrr: number;
  activeAgentCount: number;
  activeUserCount: number;
  revenuePerTech: number;
  mrrPerSeat: number;
  utilization?: UtilizationSnapshot;
  /** Top clients by MRR (the raw rows behind the headline) — for drill-down. */
  mrrByClient: MrrSnapshot["byClient"];
  presentation: string;
}

// ---------- Service-delivery KPIs (SQL-backed) ----------

/** Which tickets a service-delivery query counts.
 *  - `reactive`: excludes projects + opportunities (REQUESTTYPE.RTIsProject / RTIsOpportunity).
 *  - `all`: every non-deleted, non-merged ticket regardless of type. */
export type TicketScope = "reactive" | "all";

/** Window + scope echoed back on every service-delivery snapshot. */
export interface ServiceWindow {
  startdate: string;
  enddate: string;
  scope: TicketScope;
  clientId?: number;
}

/** SLA attainment pair. `attainmentPct` = met / (met + breached) × 100; null when no
 *  ticket in the cohort had an SLA target (Halo state '' = no SLA applies). */
export interface SlaAttainment {
  met: number;
  breached: number;
  attainmentPct: number | null;
}

/** CSAT block. `ai` is the AI-derived satisfaction (faisatisfactionlevel, ~1–10) — the
 *  only signal with real coverage in most tenants. `native` is the built-in survey score
 *  (SatisfactionLevel), usually sparse until CSAT surveys are rolled out. */
export interface CsatBlock {
  ai: { avg: number | null; responses: number; scale: string };
  native: { avg: number | null; responses: number };
}

/** One-shot service-desk health snapshot for a window.
 *  Cohorts (documented because they differ by metric):
 *   - inflow / firstResponseSla / csat are measured on tickets CREATED in the window.
 *   - outflow / resolutionSla / meanTimeToResolveHours / firstTimeFix are measured on
 *     tickets RESOLVED (cleared) in the window.
 *   - openBacklogNow / breachingNow are point-in-time (as of query time). */
export interface ServiceDeskHealth {
  window: ServiceWindow;
  inflow: number;
  outflow: number;
  netBacklogChange: number;
  openBacklogNow: number;
  breachingNow: number;
  resolvedCohort: number;
  firstResponseSla: SlaAttainment;
  resolutionSla: SlaAttainment;
  meanTimeToResolveHours: number | null;
  firstTimeFixCount: number;
  firstTimeFixRate: number | null;
  csat: CsatBlock;
}

/** Per-technician performance row (resolved-in-window cohort, grouped by the agent who
 *  closed the ticket). `hoursLogged` / `hoursBillable` come from ACTIONS authored by the
 *  agent in the window across all ticket types, so they reflect total effort, not just the
 *  reactive tickets counted in `resolved`. */
export interface TechnicianScorecardRow {
  agentId: number;
  agent: string;
  resolved: number;
  meanTimeToResolveHours: number | null;
  resolutionSla: SlaAttainment;
  firstResponseSla: SlaAttainment;
  firstTimeFixCount: number;
  firstTimeFixRate: number | null;
  aiCsatAvg: number | null;
  csatResponses: number;
  hoursLogged: number;
  hoursBillable: number;
  /** hoursLogged split by ITIL type (FAULTS.requesttype): reactive =
   *  Incident+Service Request (1,3), project = 22/23/24, problem = 4,
   *  admin = Advice/Other (21) + non-ticket time. hoursReactive matches the
   *  scorecard's default reactive ticket scope. */
  hoursReactive: number;
  hoursProject: number;
  hoursProblem: number;
  hoursAdmin: number;
}

export interface TechnicianScorecard {
  window: ServiceWindow;
  technicians: TechnicianScorecardRow[];
}

/** Per-client service-health row. Surfaces at-risk accounts (high volume + low SLA / CSAT). */
export interface ClientHealthRow {
  clientId: number;
  client: string;
  created: number;
  resolved: number;
  openNow: number;
  resolutionSla: SlaAttainment;
  firstResponseSla: SlaAttainment;
  meanTimeToResolveHours: number | null;
  aiCsatAvg: number | null;
  csatResponses: number;
}

export interface ClientHealthScorecard {
  window: ServiceWindow;
  clients: ClientHealthRow[];
}

/** Ticket-categorisation insight: coverage + top categories + recurring-problem
 *  candidates. Surfaces broken taxonomies (high uncategorised share) and the
 *  high-volume/high-effort categories worth a KB article or automation. */
export interface CategoryInsights {
  window: ServiceWindow;
  totalTickets: number;
  uncategorisedTickets: number;
  uncategorisedPct: number | null;
  topByVolume: { category: string; tickets: number; hours: number }[];
  topByHours: { category: string; tickets: number; hours: number }[];
  /** Named categories ranked by tickets × hours — the automation / KB targets. */
  recurringProblemCandidates: { category: string; tickets: number; hours: number; effortScore: number }[];
}

/** Per-technician leading risk signals for coaching vs disengagement. All rates
 *  are heuristic flags, not verdicts — read alongside throughput and context
 *  (e.g. a tech who logs no time can look idle while busy). */
export interface TechnicianRiskRow {
  agentId: number;
  agent: string;
  resolved: number;
  zeroTimeCloses: number;
  zeroTimeCloseRate: number | null;
  slaBreaches: number;
  resolutionSlaBreachRate: number | null;
  aiCsatAvg: number | null;
  openOwned: number;
  staleOwned: number;
  staleOwnedRate: number | null;
  avgOpenAgeDays: number | null;
  // Time-entry discipline (real-time logging). Lag = entry-created minus work-date
  // (ACTIONS.ActionDateCreated - Whe_). lateEditedEntries clears the automation
  // window by only counting edits >1 day after creation.
  timeEntries: number;
  avgEntryLagHours: number | null;
  pctLoggedRealtime: number | null;
  lateEditedEntries: number;
  /** Heuristic flags raised for this tech (e.g. high-zero-time-closes, low-sla, stale-backlog, low-csat, late-time-entry). */
  flags: string[];
}

export interface TechnicianRiskSignals {
  window: ServiceWindow;
  note: string;
  technicians: TechnicianRiskRow[];
}

/** Point-in-time open-ticket backlog with aging + SLA-at-risk counts. */
export interface TicketBacklog {
  scope: TicketScope;
  clientId?: number;
  openTotal: number;
  breachedNow: number;
  dueWithin24h: number;
  aging: {
    lessThan1Day: number;
    oneToThreeDays: number;
    threeToSevenDays: number;
    sevenToThirtyDays: number;
    overThirtyDays: number;
  };
  oldest: {
    ticketId: number;
    client: string;
    agent: string | null;
    status: string;
    priority: number;
    ageDays: number;
    fixSlaState: string;
    firstResponseState: string;
  }[];
}

// ---------- Similarity / embeddings (FaultVectorScore, method 1) ----------

/** One approximate recurring-problem cluster — a group of similar reactive
 *  tickets sharing a lowest-faultid anchor. `avgResolutionHours` is the mean
 *  wall-clock resolve time over resolved members; `distinctResolvers` is a
 *  handling-consistency signal (many resolvers for one recurring problem =
 *  knowledge not captured). */
export interface RecurringProblemCluster {
  anchorFaultId: number;
  representativeSummary: string;
  ticketCount: number;
  distinctClients: number;
  totalHoursLogged: number;
  avgResolutionHours: number | null;
  distinctResolvers: number;
  avgScore: number | null;
}

export interface RecurringProblemClusters {
  window: ServiceWindow;
  minScore: number;
  /** Notes that clustering is an anchor approximation, not transitive closure. */
  approximationNote: string;
  clusters: RecurringProblemCluster[];
}

/** An open ticket and its highest-scoring near-duplicate neighbour (merge /
 *  double-logging candidate). `matchedState` says whether the match is still
 *  open or already closed. */
export interface DuplicateTicketMatch {
  openTicketId: number;
  openSummary: string;
  client: string;
  ageDays: number;
  matchedTicketId: number;
  matchedSummary: string;
  matchedState: "open" | "closed";
  score: number | null;
}

export interface DuplicateTickets {
  scope: TicketScope;
  minScore: number;
  duplicates: DuplicateTicketMatch[];
}

/** A client who repeatedly logs the same issue. `recurringPairCount` is the
 *  number of high-similarity same-client ticket pairs; `distinctTickets` the
 *  tickets those pairs span. */
export interface ClientDejaVuRow {
  clientId: number;
  client: string;
  recurringPairCount: number;
  distinctTickets: number;
  totalHoursLogged: number;
}

export interface ClientDejaVu {
  window: ServiceWindow;
  minScore: number;
  clients: ClientDejaVuRow[];
}

/** One resolved neighbour of a target ticket. */
export interface SimilarTicketNeighbour {
  faultId: number;
  summary: string;
  score: number | null;
  resolverId: number | null;
  resolver: string | null;
  resolutionHours: number | null;
  category2: string | null;
  csat: number | null;
}

/** Per-ticket nearest-resolved-neighbour insight: the neighbours plus a
 *  prediction block (median effort, most-common category, top resolvers). */
export interface SimilarTicketInsights {
  faultId: number;
  neighbours: SimilarTicketNeighbour[];
  summary: {
    neighbourCount: number;
    predictedResolutionHoursMedian: number | null;
    predictedCategory: string | null;
    suggestedResolvers: { agentId: number; agent: string; neighbourCount: number }[];
  };
}

/** Knowledge-base gap analysis from the ticket↔KB embedding matches
 *  (FaultVectorScore.FVSuse=1). Surfaces how much of the reactive ticket volume
 *  has a matching KB article, the most-matched articles, and the highest-effort
 *  tickets with no KB match (= the articles worth writing first). */
export interface KnowledgeGaps {
  window: ServiceWindow;
  matchThreshold: number;
  coverage: {
    tickets: number;
    withKbMatch: number;
    coveragePct: number | null;
    avgBestScore: number | null;
  };
  /** KB articles ranked by how many tickets match them — the workhorse articles. */
  topKbArticles: { kbId: number; title: string; ticketsMatched: number; avgScore: number | null }[];
  /** Uncovered tickets (no KB match at/above threshold) ranked by hours logged. */
  gapCandidates: {
    faultId: number;
    summary: string;
    client: string;
    hoursLogged: number;
    bestKbScore: number | null;
  }[];
}

/** One ticket awaiting categorisation, with the cheap AI summary the model
 *  matches against the controlled category list. */
export interface CategorizationTicket {
  faultId: number;
  subject: string;
  client: string;
  currentCategory: string | null;
  currentCategoryId: number | null;
  aiSummary: string | null;
  aiSuggestedCategory: string | null;
  summaryMissing: boolean;
}

/** Feed for the AI ticket-categoriser: the controlled taxonomy plus the scoped
 *  set of tickets (with summaries) to categorise. The model matches each
 *  summary to `categories` (or proposes a new one), then applies via
 *  setTicketCategory. */
export interface TicketsToCategorize {
  filter: {
    startdate?: string;
    enddate?: string;
    onlyUncategorised: boolean;
    category?: string;
    scope: TicketScope;
  };
  /** Controlled primary-category taxonomy (CATEGORYDETAIL CDType=2): id = CDid (the
   *  value to write as categoryid_1), name = the "A>B>C" path. */
  categories: { id: number; name: string }[];
  totalMatching: number;
  returned: number;
  tickets: CategorizationTicket[];
}

/** A HaloPSA category (from /Category). type_id 1 = primary ticket category
 *  (== DB CATEGORYDETAIL CDType 2), 2 = closure, 4 = request-type category. */
export interface HaloCategory {
  id: number;
  category_name: string;
  value?: string;
  type_id: number;
  category_group_id?: number;
  guid?: string;
}

/** Noise-ticket analysis: low/no-value tickets (auto-replies, OOO, OTP emails,
 *  newsletters, tests) that consume triage time, grouped so you can stop them at
 *  source. */
export interface NoiseTicketAnalysis {
  window: { startdate: string; enddate: string; scope: TicketScope };
  totalReactiveTickets: number;
  totalNoiseTickets: number;
  noiseSharePct: number | null;
  totalHoursWasted: number;
  byType: {
    type: string;
    tickets: number;
    hoursWasted: number;
    sharePct: number | null;
    recommendation: string;
  }[];
  byMailbox: { mailboxId: number; tickets: number }[];
}

// ---------- Project management / profitability / resourcing ----------

export type ProjectBillingModel = "retainer" | "time-and-materials" | "mixed" | "fixed-fee-or-internal";

/** Per-project profitability with auto-detected billing model. Revenue source is
 *  chosen per project: prepay top-ups (retainer) → ACTIONS charge (T&M) → else
 *  unmapped. Cost is pay-type-adjusted ucostPrice and is PARTIAL — always read
 *  costCoveragePct before trusting margin. */
export interface ProjectProfitabilityRow {
  projectId: number;
  project: string;
  client: string;
  billingModel: ProjectBillingModel;
  /** recognised revenue = distinct linked invoice lines (T&M + prepay-DR) */
  revenue: number;
  revenueSource: string;
  /** prepay deferred-revenue recognised on this project (ACTIONS.adefprepayamount) */
  prepayRecognised: number;
  /** pure time-and-materials recognised (revenue − prepayRecognised) */
  tmRecognised: number;
  hours: number;
  billableHours: number;
  estimateHours: number | null;
  prepayPurchasedHours: number;
  prepayConsumedHours: number;
  /** billable hours that were neither drawn from the prepay block nor billed as
   *  a direct charge amount (ActionPrePayHours=0 AND ActionChargeAmount=0) —
   *  genuinely uncharged labour. */
  unchargedHours: number;
  unchargedValue: number;
  labourCost: number;
  costCoveragePct: number | null;
  /** revenue / delivered hours */
  effectiveRate: number | null;
  /** prepay top-ups / prepay hours purchased (the sold blended rate) */
  soldRate: number | null;
  grossMargin: number | null;
  grossMarginPct: number | null;
  marginReliable: boolean;
  prepayRevenue: number;
  tmCharge: number;
  /** delivered hours exceed the prepay block purchased (or, with no prepay, the estimate) */
  overServiced: boolean;
}

export interface ProjectProfitability {
  note: string;
  currency: string;
  projects: ProjectProfitabilityRow[];
}

/** Prepay (deferred-revenue) account balance for one contract. The prepay
 *  account is a contract-level ledger: cash collected via PREPAYHISTORY top-ups
 *  vs hours consumed / revenue recognised on ACTIONS. */
export interface PrepayAccountRow {
  contractId: number;
  client: string;
  /** the client account is active (AREA.aisinactive = 0) */
  clientActive: boolean;
  active: boolean;
  /** cash invoiced into the block (PREPAYHISTORY.PPAmount) */
  collectedAmount: number;
  /** net hours added to the block (PREPAYHISTORY.pphours; can be net of adjustments) */
  purchasedHours: number;
  /** hours drawn down (ACTIONS.ActionPrePayHours) */
  consumedHours: number;
  /** hours removed via negative PREPAYHISTORY rows that aren't expiry — manual / off-the-books consumption or write-offs */
  manualDeductionHours: number;
  /** hours lost to expiry (negative PREPAYHISTORY rows whose note marks them expired) */
  expiredHours: number;
  /** purchasedHours − consumedHours − manualDeductionHours − expiredHours; negative = over-drawn */
  remainingHours: number;
  /** prepay revenue recognised as consumed (ACTIONS.adefprepayamount) */
  recognisedAmount: number;
  /** collectedAmount − recognisedAmount = unearned deferred revenue still on the books (negative = recognised beyond cash collected) */
  deferredBalance: number;
  /** collectedAmount / purchasedHours (blended sold rate) */
  blendedRate: number | null;
  projectsOnContract: number;
  lastTopUp: string | null;
  /** healthy | low-balance | over-drawn | untouched */
  status: string;
  overDrawn: boolean;
  untouched: boolean;
}

export interface PrepayAccountBalance {
  note: string;
  currency: string;
  accounts: PrepayAccountRow[];
}

/** A technician who logged REACTIVE (Incident/Service-Request) support time
 *  against a client's managed-services work. */
export interface RecurringContractTech {
  agentId: number;
  agent: string;
  reactiveHoursMonthly: number;
  /** best-effort agent cost; 0 when the agent has no cost on file */
  reactiveCostMonthly: number;
}

/** Recurring (managed-services) profitability for one grouping — either a whole
 *  client (grain='client') or a single contract (grain='contract'). The contract
 *  is carried per generated recurring invoice line (INVOICEDETAIL.IDCHID), so
 *  per-contract revenue is real; client grain rolls those up. Labour is split by
 *  ITIL type (FAULTS.requesttype): the recurring fee covers REACTIVE support
 *  (Incident 1 + Service Request 3), so the margin is read against that slice;
 *  project (22/23/24) and admin (Advice/Other 21 + rest) are reported separately
 *  and kept OUT of the margin. */
export interface RecurringContractProfitabilityRow {
  /** present when grain='contract' */
  contractId?: number;
  contractRef?: string;
  contractActive?: boolean;
  clientId: number;
  client: string;
  /** present when grain='client' — count of the client's active contracts */
  activeContracts?: number;
  /** recurring revenue actually invoiced in the latest complete month */
  recurringRevenueMonthly: number;
  recurringInvoices: number;
  /** logged hours that month, split by ITIL type (FAULTS.requesttype) */
  reactiveHoursMonthly: number;
  projectHoursMonthly: number;
  problemHoursMonthly: number;
  adminHoursMonthly: number;
  totalHoursMonthly: number;
  /** billable share of REACTIVE hours (the three billable buckets) */
  reactiveBillableSharePct: number | null;
  /** recurring revenue ÷ reactive support hours — the managed-services margin
   *  proxy (low = lots of covered support for the fee), no agent-cost data needed */
  revenuePerReactiveHour: number | null;
  /** best-effort cost of the REACTIVE labour only; partial — see reactiveCostCoveragePct */
  reactiveLabourCostMonthly: number;
  /** recurring revenue − reactive labour cost; null unless cost coverage is high
   *  enough to trust (marginReliable) */
  grossMarginMonthly: number | null;
  grossMarginPct: number | null;
  /** share of REACTIVE hours that had a costed agent */
  reactiveCostCoveragePct: number | null;
  marginReliable: boolean;
  topTechs: RecurringContractTech[];
  flags: string[];
}

export interface RecurringContractProfitability {
  grain: "client" | "contract";
  /** the latest complete calendar month (YYYY-MM) all figures are read from */
  month: string;
  currency: string;
  /** monthly recurring revenue NOT tied to any contract (grain='contract' only;
   *  null for grain='client'). Lets the per-contract rows reconcile to total MRR. */
  unattributedRevenueMonthly: number | null;
  note: string;
  rows: RecurringContractProfitabilityRow[];
}

/** One project in the portfolio health board. */
export interface ProjectPortfolioRow {
  projectId: number;
  project: string;
  client: string;
  status: string;
  childTasks: number;
  tasksClosed: number;
  percentComplete: number | null;
  hours: number;
  estimateHours: number | null;
  ageDays: number | null;
}

export interface ProjectPortfolio {
  projects: ProjectPortfolioRow[];
}

/** Per-agent forward resource load: booked appointment hours vs weekly target.
 *  scheduledHours counts only ticket-linked appointments (client work);
 *  internalHours are unlinked appointments (internal meetings). */
export interface ResourceForecastRow {
  agentId: number;
  agent: string;
  scheduledHours: number;
  internalHours: number;
  appointments: number;
  capacityHours: number | null;
  utilisationPct: number | null;
  status: string;
}

export interface ResourceForecast {
  startdate: string;
  weeks: number;
  technicians: ResourceForecastRow[];
}

/** Per-agent utilisation over a past window: booked (calendar) vs worked
 *  (logged) vs billable, against leave-adjusted capacity. */
export interface TechnicianUtilizationRow {
  agentId: number;
  agent: string;
  capacityHours: number;
  leaveHours: number;
  netCapacityHours: number;
  /** ticket-linked appointment hours (client work booked on the calendar) */
  bookedHours: number;
  /** unlinked appointment hours (internal meetings) */
  internalMeetingHours: number;
  workedHours: number;
  /** workedHours split by ITIL type (FAULTS.requesttype): reactive =
   *  Incident+Service Request (1,3), project = 22/23/24, problem = 4,
   *  admin = Advice/Other (21) + non-ticket time. Sums to workedHours. */
  reactiveHours: number;
  projectHours: number;
  problemHours: number;
  adminHours: number;
  /** admin hours / worked hours — the share going to admin/Advice-Other/non-ticket */
  adminSharePct: number | null;
  billableHours: number;
  /** ticket-linked booked hours / net capacity */
  bookedUtilPct: number | null;
  /** internal meeting hours / net capacity */
  internalMeetingPct: number | null;
  /** logged work hours / net capacity */
  workedUtilPct: number | null;
  /** billable hours / net capacity (the revenue-bearing utilisation) */
  billableUtilPct: number | null;
  /** billable hours / worked hours (quality of the work mix) */
  billabilityPct: number | null;
  status: string;
}

export interface TechnicianUtilization {
  startdate: string;
  enddate: string;
  workingDays: number;
  dailyCapacityHours: number;
  targetUtilisationPct: number;
  note: string;
  totals: {
    capacityHours: number;
    leaveHours: number;
    netCapacityHours: number;
    bookedHours: number;
    internalMeetingHours: number;
    workedHours: number;
    reactiveHours: number;
    projectHours: number;
    problemHours: number;
    adminHours: number;
    billableHours: number;
    bookedUtilPct: number | null;
    internalMeetingPct: number | null;
    workedUtilPct: number | null;
    billableUtilPct: number | null;
    billabilityPct: number | null;
  };
  technicians: TechnicianUtilizationRow[];
}
