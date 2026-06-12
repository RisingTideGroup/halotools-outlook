// Promise wrappers + helpers around Office.context.mailbox.item.
//
// Read-surface only for v1 (mailRead context). Compose surface would need separate helpers.

import {
  setStorage,
  roamingSettingsStorage,
  localStorageStorage,
} from "@iusehalo/halo-api";

/**
 * Install the storage adapter @iusehalo/halo-api uses for tenant config + tokens.
 * Picks Office.context.roamingSettings when running inside Outlook (so settings
 * roam with the mailbox), falls back to localStorage for `npm run dev` outside Outlook.
 *
 * Call this once on bootstrap — before any halo-api function runs — from each
 * Vite entry point (task pane, compose, setup wizard).
 */
export function installStorageAdapter(): void {
  const hasOffice =
    typeof Office !== "undefined" && Office.context && Office.context.roamingSettings;
  if (hasOffice) {
    setStorage(
      roamingSettingsStorage(
        Office.context.roamingSettings,
        Office.AsyncResultStatus.Succeeded,
      ),
    );
  } else {
    setStorage(localStorageStorage());
  }
}

export interface EmailContext {
  /** Direction relative to the signed-in user. "outgoing" means we sent it
   * (viewing a Sent Items message); "incoming" means we received it. */
  direction: "incoming" | "outgoing";
  /** The literal sender of the message per RFC 5322 — what goes into
   * Halo Action `emailfrom`. For outgoing this is the agent. */
  senderEmail: string;
  senderName: string;
  /** The other party in the conversation — used for contact / company /
   * ticket lookups. For incoming this is the same as senderEmail; for
   * outgoing this is the first non-self recipient. */
  customerEmail: string;
  customerName: string;
  subject: string;
  conversationId: string;
  /** RFC 5322 Message-ID of the current message, with angle brackets stripped. */
  internetMessageId: string;
  /** Parent's Message-ID from the In-Reply-To header, angle brackets stripped. */
  inReplyTo?: string;
  /** Ancestor Message-IDs from the References header, angle brackets stripped. */
  references: string[];
  itemId: string;
  receivedAt: Date;
}

export interface FetchedAttachment {
  /** Filename (sanitized for Halo) */
  filename: string;
  contentType: string;
  /** Base64-encoded file content */
  base64: string;
  size: number;
  isInline: boolean;
}

export function isOfficeReady(): boolean {
  return typeof Office !== "undefined" && !!Office.context?.mailbox?.item;
}

export function awaitOffice(): Promise<void> {
  return new Promise((resolve) => {
    Office.onReady(() => resolve());
  });
}

/** Pull metadata from the currently selected message in the read pane.
 *
 * Direction-aware: compares the sender against the signed-in mailbox so that
 * Sent Items / Drafts surface the recipient as the "customer" for lookups,
 * while inbox messages surface the sender. Without this, viewing a Sent
 * Items message would resolve the agent's own email against findUserByEmail
 * and show an empty contact card with no related tickets. */
export async function getCurrentEmailContext(): Promise<EmailContext | undefined> {
  const item = Office.context.mailbox.item;
  if (!item || item.itemType !== Office.MailboxEnums.ItemType.Message) return undefined;

  const msg = item as Office.MessageRead;
  const from = msg.from;
  if (!from) return undefined;

  const headers = await getInReplyToAndReferences(msg);

  const selfEmail = (Office.context.mailbox.userProfile?.emailAddress ?? "").toLowerCase();
  const senderEmail = from.emailAddress ?? "";
  const isOutgoing = !!selfEmail && senderEmail.toLowerCase() === selfEmail;

  // Counterparty: who we want to look up as the "customer". For outgoing
  // mail, the first non-self recipient in To: — falls through to CC: if To:
  // is empty or only contains the user themselves. For incoming, the sender.
  let customerEmail = senderEmail;
  let customerName = from.displayName ?? "";
  if (isOutgoing) {
    const recipients = [...(msg.to ?? []), ...(msg.cc ?? [])];
    const counterparty = recipients.find(
      (r) => r.emailAddress && r.emailAddress.toLowerCase() !== selfEmail,
    );
    if (counterparty) {
      customerEmail = counterparty.emailAddress;
      customerName = counterparty.displayName || counterparty.emailAddress;
    }
  }

  return {
    direction: isOutgoing ? "outgoing" : "incoming",
    senderEmail,
    senderName: from.displayName ?? "",
    customerEmail,
    customerName,
    subject: item.subject ?? "",
    conversationId: msg.conversationId,
    internetMessageId: stripAngleBrackets(msg.internetMessageId),
    inReplyTo: headers.inReplyTo,
    references: headers.references,
    itemId: item.itemId,
    receivedAt: msg.dateTimeCreated,
  };
}

/**
 * Read In-Reply-To and References headers from the current message.
 * Requires Mailbox 1.8+ (getInternetHeadersAsync). On older versions or any
 * failure we resolve to empty so callers can degrade gracefully.
 */
function getInReplyToAndReferences(
  msg: Office.MessageRead,
): Promise<{ inReplyTo?: string; references: string[] }> {
  return new Promise((resolve) => {
    const getter = (
      msg as unknown as {
        getAllInternetHeadersAsync?: (
          cb: (r: Office.AsyncResult<string>) => void,
        ) => void;
      }
    ).getAllInternetHeadersAsync;
    if (typeof getter !== "function") {
      resolve({ references: [] });
      return;
    }
    try {
      getter.call(msg, (result: Office.AsyncResult<string>) => {
        if (result.status !== Office.AsyncResultStatus.Succeeded) {
          resolve({ references: [] });
          return;
        }
        resolve(parseThreadingHeaders(result.value));
      });
    } catch {
      resolve({ references: [] });
    }
  });
}

function parseThreadingHeaders(raw: string): { inReplyTo?: string; references: string[] } {
  // RFC 5322 headers come as a single CRLF-joined blob. Folded values (lines
  // starting with whitespace) belong to the previous header — unfold first.
  const unfolded = raw.replace(/\r\n[ \t]+/g, " ");
  const lines = unfolded.split(/\r?\n/);
  let inReplyToLine = "";
  let referencesLine = "";
  for (const line of lines) {
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const name = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (name === "in-reply-to" && !inReplyToLine) inReplyToLine = value;
    else if (name === "references" && !referencesLine) referencesLine = value;
  }
  const inReplyToIds = extractMessageIds(inReplyToLine);
  const referenceIds = extractMessageIds(referencesLine);
  return {
    inReplyTo: inReplyToIds[0],
    references: referenceIds,
  };
}

function extractMessageIds(value: string): string[] {
  if (!value) return [];
  // Pull out anything that looks like a Message-ID. Most clients format these
  // as <local@domain>; some legacy senders omit the angle brackets.
  const bracketed = value.match(/<[^<>\s]+>/g);
  if (bracketed && bracketed.length) {
    return bracketed.map(stripAngleBrackets).filter(Boolean);
  }
  return value
    .split(/\s+/)
    .map((t) => stripAngleBrackets(t))
    .filter(Boolean);
}

function stripAngleBrackets(id: string | undefined): string {
  if (!id) return "";
  return id.trim().replace(/^<|>$/g, "");
}

/** Get the message body as plain text (default) or HTML. Async. */
export function getBody(format: "text" | "html" = "text"): Promise<string> {
  return new Promise((resolve, reject) => {
    Office.context.mailbox.item?.body.getAsync(
      format === "html" ? Office.CoercionType.Html : Office.CoercionType.Text,
      (result) => {
        if (result.status === Office.AsyncResultStatus.Succeeded) resolve(result.value);
        else reject(new Error(result.error?.message ?? "Failed to read body"));
      },
    );
  });
}

/** List attachments on the current message (metadata only). */
export function listAttachments(): Office.AttachmentDetails[] {
  const item = Office.context.mailbox.item as Office.MessageRead | undefined;
  return item?.attachments ?? [];
}

/** Fetch the content of a single attachment as base64. */
function fetchAttachmentContent(att: Office.AttachmentDetails): Promise<FetchedAttachment> {
  return new Promise((resolve, reject) => {
    Office.context.mailbox.item?.getAttachmentContentAsync(
      att.id,
      { asyncContext: att },
      (result) => {
        if (result.status !== Office.AsyncResultStatus.Succeeded) {
          reject(new Error(result.error?.message ?? `Failed to read attachment ${att.name}`));
          return;
        }
        const c = result.value;
        // Office returns one of: Base64, Eml, ICalendar, Url.
        // We only handle Base64 for v1 — others surface as a per-attachment error.
        if (c.format !== Office.MailboxEnums.AttachmentContentFormat.Base64) {
          reject(
            new Error(
              `Attachment "${att.name}" is ${c.format} — only base64 attachments are supported in v1.`,
            ),
          );
          return;
        }
        resolve({
          filename: sanitizeFilename(att.name),
          contentType: contentTypeFor(att),
          base64: c.content,
          size: att.size,
          isInline: att.isInline,
        });
      },
    );
  });
}

/**
 * Fetch all attachments as base64.
 * Inline images (signatures, embedded screenshots) are skipped by default to avoid noise.
 * Returns partial results on individual failures.
 */
export async function fetchAllAttachments(
  includeInline = false,
): Promise<{ attachments: FetchedAttachment[]; errors: string[] }> {
  const meta = listAttachments().filter((a) => includeInline || !a.isInline);
  const attachments: FetchedAttachment[] = [];
  const errors: string[] = [];
  for (const m of meta) {
    try {
      attachments.push(await fetchAttachmentContent(m));
    } catch (e) {
      errors.push((e as Error).message);
    }
  }
  return { attachments, errors };
}

/**
 * Replace cid: image references in an HTML body with inline base64 data URIs
 * so that Halo (and any other consumer) can render them without access to the
 * original MIME structure.
 *
 * Outlook embeds images (signature logos, pasted screenshots, etc.) as inline
 * MIME parts referenced by Content-ID. The HTML body contains src="cid:…"
 * attributes that are meaningless once extracted from the email. This function
 * resolves each one and substitutes a self-contained data URI. References with
 * no matching attachment are left unchanged so the rest of the body is never
 * broken by a single missing image.
 *
 * Two resolution paths:
 *  1. Synchronous — item.attachments (works in classic desktop Outlook Win/Mac).
 *  2. REST fallback — getCallbackTokenAsync + Outlook REST API, required for OWA
 *     and New Outlook for Windows where inline attachments are not surfaced
 *     through the synchronous property.
 */
export async function resolveInlineCidImages(html: string): Promise<string> {
  const cids = new Set<string>();
  const cidRe = /src="cid:([^"]+)"/gi;
  let m: RegExpExecArray | null;
  while ((m = cidRe.exec(html)) !== null) {
    cids.add(m[1]);
  }
  if (cids.size === 0) return html;

  // Normalise CID strings: strip angle brackets, lowercase.
  // Office.js sometimes returns "<image002.png@01DC...>" while the HTML has no brackets.
  const normalise = (id: string) => id.replace(/^<|>$/g, "").toLowerCase();

  // Path 1: synchronous attachment list — available in classic desktop Outlook.
  // OWA and New Outlook return [] here even for emails with inline images;
  // in that case we fall through to the REST path below.
  const attsWithCid = listAttachments().filter((a) => !!a.contentId);

  let cidMap: Map<string, string>;

  if (attsWithCid.length > 0) {
    const resolved = await Promise.all(
      [...cids].map(async (cid): Promise<[string, string | null]> => {
        const att = attsWithCid.find(
          (a) => normalise(a.contentId!) === normalise(cid),
        );
        if (!att) return [normalise(cid), null];
        try {
          const fetched = await fetchAttachmentContent(att);
          return [normalise(cid), `data:${fetched.contentType};base64,${fetched.base64}`];
        } catch {
          return [normalise(cid), null];
        }
      }),
    );
    cidMap = new Map(resolved.filter((r): r is [string, string] => r[1] !== null));
  } else {
    // Path 2: OWA / New Outlook for Windows — item.attachments is empty even
    // when the email has inline images. Fetch via Outlook REST API instead.
    cidMap = await fetchCidMapViaRest(normalise);
  }

  if (cidMap.size === 0) return html;

  // Keys in cidMap are always normalised; direct lookup avoids repeated iteration.
  return html.replace(/src="cid:([^"]+)"/gi, (match, cid: string) => {
    const dataUri = cidMap.get(normalise(cid));
    return dataUri ? `src="${dataUri}"` : match;
  });
}

/** Get the email address of the current Outlook user. */
export function getCurrentUserEmail(): string | undefined {
  return Office.context.mailbox.userProfile?.emailAddress;
}

/** Read the importance class of the current message — "low" | "normal" | "high".
 *  Requires Mailbox 1.10+. Falls back to "normal" on older hosts or when the
 *  property isn't surfaced. */
export function getItemImportance(): string {
  try {
    const imp = (Office.context.mailbox.item as unknown as { importance?: string })
      .importance;
    if (typeof imp === "string" && imp) return imp.toLowerCase();
  } catch {
    /* swallow */
  }
  return "normal";
}

/** Format a Date / ISO string as Halo's `dateemailed` shape:
 *  `YYYY-MM-DDTHH:mm:ss.SSS` — toISOString output minus the trailing Z.
 *  Returns the current time when input is undefined. */
export function formatHaloDate(d: Date | string | undefined): string {
  const dt = d instanceof Date ? d : (d ? new Date(d) : new Date());
  return dt.toISOString().replace(/Z$/, "");
}

/** Extract the domain part from an email address (lowercased). */
export function domainOf(email: string): string {
  const at = email.lastIndexOf("@");
  return at >= 0 ? email.slice(at + 1).toLowerCase() : "";
}

// ---------- helpers ----------

/** Wrap getCallbackTokenAsync (REST mode) in a Promise. */
function getCallbackToken(): Promise<string> {
  return new Promise((resolve, reject) => {
    Office.context.mailbox.getCallbackTokenAsync({ isRest: true }, (result) => {
      if (result.status === Office.AsyncResultStatus.Succeeded) {
        resolve(result.value);
      } else {
        reject(new Error(result.error?.message ?? "Failed to get callback token"));
      }
    });
  });
}

/** Outlook REST API / Graph attachment shape.
 *  REST v2 uses PascalCase; Graph (which REST now proxies) uses camelCase. */
interface RestAttachment {
  "@odata.type": string;
  Id?: string;
  id?: string;
  ContentType?: string;
  contentType?: string;
  IsInline?: boolean;
  isInline?: boolean;
  ContentId?: string | null;
  contentId?: string | null;
  ContentBytes?: string;
  contentBytes?: string;
}

/**
 * Fetch inline attachment content via the Outlook REST API.
 * Used as a fallback for OWA and New Outlook for Windows, where item.attachments
 * does not surface inline images. The callback token is scoped to the current
 * user's mailbox (ReadItem level), short-lived, and never stored.
 */
async function fetchCidMapViaRest(
  normalise: (id: string) => string,
): Promise<Map<string, string>> {
  try {
    const token = await getCallbackToken();
    const restUrl = Office.context.mailbox.restUrl;
    if (!restUrl) return new Map();

    // itemRestId is the REST-encoded item ID — different base64 variant from the EWS itemId.
    const itemRestId = (
      Office.context.mailbox.item as unknown as { itemRestId?: string }
    ).itemRestId;
    if (!itemRestId) return new Map();

    const listRes = await fetch(
      `${restUrl}/v2.0/me/messages/${encodeURIComponent(itemRestId)}/attachments`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!listRes.ok) return new Map();

    const { value: atts } = (await listRes.json()) as { value: RestAttachment[] };

    const inlineAtts = atts.filter(
      (a) =>
        (a.IsInline ?? a.isInline) === true &&
        !!(a.ContentId ?? a.contentId) &&
        (a["@odata.type"] ?? "").toLowerCase().includes("fileattachment"),
    );
    if (inlineAtts.length === 0) return new Map();

    const cidMap = new Map<string, string>();

    await Promise.all(
      inlineAtts.map(async (att) => {
        const contentId = att.ContentId ?? att.contentId;
        const id = att.Id ?? att.id;
        const contentType = att.ContentType ?? att.contentType ?? "application/octet-stream";
        let contentBytes = att.ContentBytes ?? att.contentBytes;

        // Some REST responses omit ContentBytes on the list endpoint — fetch individually.
        if (!contentBytes && id) {
          const attRes = await fetch(
            `${restUrl}/v2.0/me/messages/${encodeURIComponent(itemRestId)}/attachments/${id}`,
            { headers: { Authorization: `Bearer ${token}` } },
          );
          if (attRes.ok) {
            const d = (await attRes.json()) as RestAttachment;
            contentBytes = d.ContentBytes ?? d.contentBytes;
          }
        }

        if (contentBytes && contentId) {
          cidMap.set(normalise(contentId), `data:${contentType};base64,${contentBytes}`);
        }
      }),
    );

    return cidMap;
  } catch {
    return new Map();
  }
}

/** Derive a MIME type from the attachment filename extension.
 *  Office.AttachmentDetails.contentType is deprecated in newer @types/office-js;
 *  this covers the common cases and falls back to the deprecated field (via cast)
 *  for anything not listed, rather than losing the type information entirely. */
function contentTypeFor(att: Office.AttachmentDetails): string {
  const ext = att.name.split(".").pop()?.toLowerCase() ?? "";
  const byExt: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    svg: "image/svg+xml",
    webp: "image/webp",
    bmp: "image/bmp",
    tif: "image/tiff",
    tiff: "image/tiff",
    ico: "image/x-icon",
    pdf: "application/pdf",
    txt: "text/plain",
    csv: "text/csv",
    doc: "application/msword",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xls: "application/vnd.ms-excel",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    zip: "application/zip",
    eml: "message/rfc822",
  };
  return byExt[ext]
    ?? (att as unknown as Record<string, string>).contentType
    ?? "application/octet-stream";
}

function sanitizeFilename(name: string): string {
  return name
    .replace(/[\/\\?<>:*|"]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

// ---------- Compose-surface helpers ----------
//
// These only work when the task pane is mounted under a mailCompose runtime.
// Each is guarded so a misuse from the read surface fails fast with a clear error
// rather than triggering an opaque Office.js exception.

/** True when the current item exposes the compose-mode recipient fields. */
function isComposeItem(): boolean {
  const item = Office.context?.mailbox?.item as Office.MessageCompose | undefined;
  return !!item && typeof (item as Office.MessageCompose).to?.getAsync === "function";
}

function getAsyncRecipients(
  field: Office.Recipients,
): Promise<Office.EmailAddressDetails[]> {
  return new Promise((resolve, reject) => {
    field.getAsync((result) => {
      if (result.status === Office.AsyncResultStatus.Succeeded) resolve(result.value);
      else reject(new Error(result.error?.message ?? "Failed to read recipients"));
    });
  });
}

/**
 * Read To / Cc / Bcc on the current compose item.
 * Returns lowercased email addresses (display names stripped) for stable downstream lookup.
 */
export async function getRecipients(): Promise<{
  to: string[];
  cc: string[];
  bcc: string[];
}> {
  if (!isComposeItem()) {
    throw new Error("getRecipients is only available in the compose surface");
  }
  const item = Office.context.mailbox.item as Office.MessageCompose;
  const [to, cc, bcc] = await Promise.all([
    getAsyncRecipients(item.to),
    getAsyncRecipients(item.cc),
    getAsyncRecipients(item.bcc),
  ]);
  const flat = (arr: Office.EmailAddressDetails[]) =>
    arr.map((r) => r.emailAddress).filter(Boolean);
  return { to: flat(to), cc: flat(cc), bcc: flat(bcc) };
}

/** Insert an HTML fragment at the cursor in the compose body. */
export function insertIntoBody(html: string): Promise<void> {
  if (!isComposeItem()) {
    return Promise.reject(
      new Error("insertIntoBody is only available in the compose surface"),
    );
  }
  return new Promise((resolve, reject) => {
    Office.context.mailbox.item?.body.setSelectedDataAsync(
      html,
      { coercionType: Office.CoercionType.Html },
      (result) => {
        if (result.status === Office.AsyncResultStatus.Succeeded) resolve();
        else reject(new Error(result.error?.message ?? "Failed to insert content"));
      },
    );
  });
}

/**
 * Open an external URL in a real browser window. Tries Outlook's
 * openBrowserWindow first (the supported way out of a task pane), then a
 * regular window.open. Returns true on success.
 *
 * Some Outlook hosts (notably new Outlook on Windows) throw a synchronous
 * exception from openBrowserWindow even *after* the tab has been opened. We
 * therefore commit to the Office API when it's available: call it, swallow
 * any throw, return true. Falling through to window.open in that case opens
 * a second tab — which is what users saw before this guard.
 *
 * NEVER navigates the task pane itself. If the Office API is missing and
 * window.open is blocked, the function returns false and the caller decides
 * how to surface that (toast, clipboard copy). Replacing the task pane's URL
 * with a third-party page turns the pane into a broken iframe.
 */
export function openExternalUrl(url: string): boolean {
  if (Office.context?.ui?.openBrowserWindow) {
    try {
      Office.context.ui.openBrowserWindow(url);
    } catch {
      /* swallow — host can throw after success */
    }
    return true;
  }
  try {
    return !!window.open(url, "_blank", "noopener,noreferrer");
  } catch {
    return false;
  }
}

/** Save the in-progress compose draft and return its server-side itemId. */
export function saveDraft(): Promise<string> {
  if (!isComposeItem()) {
    return Promise.reject(new Error("saveDraft is only available in the compose surface"));
  }
  return new Promise((resolve, reject) => {
    (Office.context.mailbox.item as Office.MessageCompose).saveAsync((result) => {
      if (result.status === Office.AsyncResultStatus.Succeeded) resolve(result.value);
      else reject(new Error(result.error?.message ?? "Failed to save draft"));
    });
  });
}

/** Read the current compose body. */
export function getComposeBody(format: "text" | "html" = "html"): Promise<string> {
  if (!isComposeItem()) {
    return Promise.reject(
      new Error("getComposeBody is only available in the compose surface"),
    );
  }
  return new Promise((resolve, reject) => {
    Office.context.mailbox.item?.body.getAsync(
      format === "html" ? Office.CoercionType.Html : Office.CoercionType.Text,
      (result) => {
        if (result.status === Office.AsyncResultStatus.Succeeded) resolve(result.value);
        else reject(new Error(result.error?.message ?? "Failed to read body"));
      },
    );
  });
}

/** Read the compose subject (best-effort; returns empty string if unavailable). */
export function getComposeSubject(): Promise<string> {
  if (!isComposeItem()) return Promise.resolve("");
  return new Promise((resolve) => {
    const item = Office.context.mailbox.item as Office.MessageCompose;
    item.subject.getAsync((result) => {
      if (result.status === Office.AsyncResultStatus.Succeeded) resolve(result.value ?? "");
      else resolve("");
    });
  });
}
