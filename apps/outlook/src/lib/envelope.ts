// Email envelope footer — the header rows (direction/date, From, To, Cc,
// Subject) appended BELOW the message body when an email is logged to Halo.
//
// Why append, not prepend: Halo's ticket list and action previews show the
// first characters of `note`, so the message itself must stay on top. The
// envelope trails behind a thin rule.
//
// Why a <table> with inline styles: Halo's note renderer strips classes and
// some style attributes inconsistently between versions. A plain bordered-0
// table with inline colours degrades to readable "Label  Value" rows even when
// every style is dropped. Mirrored in ES5 inside
// apps/outlook/public/launchevent.js (buildEnvelopeHtml/Text) — keep in sync.

import { escapeHtml } from "./html";
import type { EmailAddress, EmailContext } from "./office";

const LABEL_STYLE =
  "padding:2px 10px 2px 0;color:#707070;font-weight:600;white-space:nowrap;vertical-align:top;";
const VALUE_STYLE = "padding:2px 0;color:#242424;vertical-align:top;word-break:break-word;";
const TABLE_STYLE =
  "border-collapse:collapse;font-family:Segoe UI,Helvetica,Arial,sans-serif;font-size:12px;line-height:16px;color:#242424;";
const RULE_HTML = '<hr style="border:none;border-top:1px solid #e0e0e0;margin:12px 0 8px 0;">';
const RULE_TEXT = "\n\n----------------------------------------\n";

/** "Mark Miller <mark@example.com>" — or just the address when no name. */
export function formatAddress(a: EmailAddress): string {
  const name = (a.name ?? "").trim();
  const email = (a.email ?? "").trim();
  if (!email) return name;
  if (!name || name.toLowerCase() === email.toLowerCase()) return email;
  return `${name} <${email}>`;
}

/** Semicolon-joined list of formatted addresses. */
export function formatAddressList(list: EmailAddress[]): string {
  return list.map(formatAddress).filter(Boolean).join("; ");
}

/** Bare addresses joined with "; " — the shape Halo's emailto / emailcc take. */
export function joinAddresses(list: EmailAddress[]): string {
  return list.map((a) => (a.email ?? "").trim()).filter(Boolean).join("; ");
}

/** "Thu, Jul 9 2026 2:58 PM" — locale-aware, no seconds. */
export function formatEnvelopeDate(d: Date | string | undefined): string {
  const dt = d instanceof Date ? d : d ? new Date(d) : new Date();
  if (Number.isNaN(dt.getTime())) return "";
  try {
    return dt.toLocaleString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return dt.toISOString();
  }
}

export function directionLabel(ctx: Pick<EmailContext, "direction">): "Inbound" | "Outbound" {
  return ctx.direction === "outgoing" ? "Outbound" : "Inbound";
}

interface EnvelopeRow {
  label: string;
  value: string;
}

function rows(ctx: EmailContext): EnvelopeRow[] {
  const out: EnvelopeRow[] = [];
  const when = formatEnvelopeDate(ctx.receivedAt);
  out.push({ label: "Email", value: when ? `${directionLabel(ctx)} · ${when}` : directionLabel(ctx) });
  const from = formatAddress(ctx.from ?? { name: ctx.senderName, email: ctx.senderEmail });
  if (from) out.push({ label: "From", value: from });
  const to = formatAddressList(ctx.to ?? []);
  if (to) out.push({ label: "To", value: to });
  const cc = formatAddressList(ctx.cc ?? []);
  if (cc) out.push({ label: "Cc", value: cc });
  if (ctx.subject) out.push({ label: "Subject", value: ctx.subject });
  return out;
}

/** The envelope block on its own (no leading rule). All values escaped. */
export function buildEnvelopeHtml(ctx: EmailContext): string {
  const body = rows(ctx)
    .map(
      (r) =>
        `<tr><td style="${LABEL_STYLE}">${escapeHtml(r.label)}</td>` +
        `<td style="${VALUE_STYLE}">${escapeHtml(r.value)}</td></tr>`,
    )
    .join("");
  return `<table border="0" cellpadding="0" cellspacing="0" style="${TABLE_STYLE}">${body}</table>`;
}

/** Plain-text equivalent of buildEnvelopeHtml — one "Label: value" per line. */
export function buildEnvelopeText(ctx: EmailContext): string {
  return rows(ctx)
    .map((r) => `${r.label}: ${r.value}`)
    .join("\n");
}

/** Body first, thin rule, then the envelope. Empty body still gets the envelope.
 *  Outlook's body.getAsync(Html) hands back a whole document; if the body still
 *  carries its `</body>` wrapper the footer goes inside it, not after `</html>`
 *  where a document-mode renderer could drop it. */
export function appendEnvelopeHtml(bodyHtml: string, ctx: EmailContext): string {
  const body = bodyHtml ?? "";
  const footer = `${RULE_HTML}${buildEnvelopeHtml(ctx)}`;
  const close = body.search(/<\/body\s*>/i);
  if (close >= 0) return `${body.slice(0, close)}${footer}${body.slice(close)}`;
  return `${body}${footer}`;
}

/** Plain-text twin of appendEnvelopeHtml. */
export function appendEnvelopeText(bodyText: string, ctx: EmailContext): string {
  return `${(bodyText ?? "").replace(/\s+$/, "")}${RULE_TEXT}${buildEnvelopeText(ctx)}`;
}
