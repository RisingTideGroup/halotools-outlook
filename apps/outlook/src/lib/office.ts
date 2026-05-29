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
          contentType: att.contentType,
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

/** Get the email address of the current Outlook user. */
export function getCurrentUserEmail(): string | undefined {
  return Office.context.mailbox.userProfile?.emailAddress;
}

/** Extract the domain part from an email address (lowercased). */
export function domainOf(email: string): string {
  const at = email.lastIndexOf("@");
  return at >= 0 ? email.slice(at + 1).toLowerCase() : "";
}

// ---------- helpers ----------

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
