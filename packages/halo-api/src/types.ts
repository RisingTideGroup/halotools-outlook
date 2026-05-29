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

export interface HaloAgent {
  id: number;
  name: string;
  email?: string;
  inactive?: boolean;
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
  attachments?: HaloAttachmentInline[];
  emailfrom?: string;
  emailfromname?: string;
  emailsubject?: string;
  /** Decimal hours spent on this action (e.g., 0.25 for 15 minutes). */
  time_taken?: number;
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
  /** Halo customer ("user") this action is on — sets the action to be from-customer. */
  user_id?: number;
  /** Some Halo versions require this explicit field instead of (or alongside) user_id. */
  actionby_user_id?: number;
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
