/**
 * Strip HTML tags and decode common entities for plain-text representation.
 *
 * Pragmatic, not bulletproof — covers the cases we hit logging Outlook
 * messages to Halo (style/script removal, <br>/<p> → newlines, basic
 * entity decode). Not a security boundary; never feed the output back
 * into HTML.
 */
export function htmlToText(html: string): string {
  if (!html) return "";
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>\s*<p[^>]*>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Strip Outlook/Word-specific noise from an email body before sending it to
 * Halo. The raw HTML Office.js returns includes MSO conditional comments,
 * `<o:p>&nbsp;</o:p>` paragraph markers, `class="MsoNormal"` paragraphs with
 * Word's default 12pt margins, and `mso-*` style declarations. Halo renders
 * the result literally — the visible effect is huge vertical gaps between
 * paragraphs and "blown out" email view layouts.
 *
 * What we strip (the bits MSP recipients never want to see):
 *   - MSO conditional comments  `<!--[if gte mso 9]>...<![endif]-->`
 *   - Office XML namespaces     `<o:*>`, `<v:*>`, `<w:*>`, `<x:*>` tags
 *   - MSO-prefixed style props  `mso-margin-top-alt: auto; ...`
 *   - Word stylesheet classes   `class="MsoNormal"`, `MsoListParagraph`, etc.
 *   - Runs of empty paragraphs  collapsed to a single empty paragraph
 *
 * What we keep:
 *   - All real content, real markup, and non-MSO inline styles. Real font
 *     choices, colours and quoted threads survive intact.
 *
 * Idempotent — running it twice on the same input gives the same output.
 */
export function sanitizeOutlookHtml(html: string): string {
  if (!html) return "";

  let out = html;

  // Conditional comments first — they often contain massive `<xml>` blocks
  // of Office metadata that other replacements would have to walk through.
  out = out.replace(/<!--\[if[\s\S]*?<!\[endif\]-->/gi, "");

  // Office namespace tags. Keep any text between open and close (rare in
  // practice — `<o:p>` is almost always empty or holds `&nbsp;`).
  out = out.replace(/<\/?[ovwx]:[a-z][^>]*>/gi, "");

  // `mso-*` properties inside style attributes — most renderers ignore them,
  // but Halo's stored copy bloats by ~30% from them alone. Drop the property
  // and its value, leaving any siblings intact.
  out = out.replace(/(\s*)mso-[a-z-]+\s*:[^;"']*(?:;|(?=["']))/gi, "");

  // `class="MsoNormal"` (and friends) reference a Word stylesheet that's
  // never present, so the class adds nothing visually but the matching
  // paragraph still inherits Word's default 12pt before/after margin.
  // Stripping the class drops the margin and the spacing collapses to the
  // recipient's CSS defaults.
  out = out.replace(/\s*class=(?:"|')Mso[^"']*(?:"|')/g, "");

  // Empty `style=""` left behind by the mso-* pass.
  out = out.replace(/\s*style=(?:"|')\s*(?:"|')/g, "");

  // Collapse runs of empty paragraphs (Outlook adds these as "press Enter
  // again for visual space"). Three or more becomes one; two becomes one.
  out = out.replace(
    /(?:<p[^>]*>(?:\s|&nbsp;| )*<\/p>\s*){2,}/gi,
    "<p>&nbsp;</p>",
  );

  // Same pattern for `<div>` — Outlook desktop's "new mail" format uses
  // `<div>` blocks rather than `<p>` for paragraphs, so the empty-block runs
  // look like `<div>&nbsp;</div><div>&nbsp;</div><div><br></div>` etc. Match
  // against any of `&nbsp;` / whitespace / `<br>` content inside the div.
  out = out.replace(
    /(?:<div[^>]*>(?:\s|&nbsp;|<br\s*\/?>)*<\/div>\s*){2,}/gi,
    "<div>&nbsp;</div>",
  );

  // Collapse runs of `<br>` to at most two. One `<br>` is a legitimate line
  // break, two reads as a paragraph-style blank line — anything more is
  // Outlook compounding "press Enter" presses from the sender (very common
  // in forwarded threads). Preserves intentional spacing, drops bloat.
  out = out.replace(/(?:<br\s*\/?>\s*){3,}/gi, "<br><br>");

  return out;
}

/**
 * Return only the topmost portion of an email body — the new content the user
 * actually wrote / received, with the quoted history below it cut off. The
 * separator itself is dropped so the slice ends cleanly.
 *
 * This is the convention Halo's native email service uses internally: `note`
 * gets just the topmost reply, `emailbody`/`emailbody_html` keep the full
 * thread including the separator. Best-effort and known to misfire on
 * non-standard threads — when no separator is found, returns the input
 * unchanged (i.e., the whole body is the topmost reply, which is correct
 * for a clean unforwarded mail).
 *
 * Separators are tried in priority order, first match wins. Apply this AFTER
 * sanitizeOutlookHtml so the patterns aren't masked by `class="MsoNormal"`
 * wrappers or `<o:p>` noise.
 */
export function extractTopReply(html: string): string {
  if (!html) return "";

  // Priority list — most-specific markers first.
  // Each entry is a regex; we cut at the first match's index.
  const separators: RegExp[] = [
    // Outlook desktop (modern, on-send): explicit "your typing ends here" marker.
    /<div\s+id=["']appendonsend["'][^>]*>/i,
    // Outlook classic — older Outlook reply wrapper.
    /<div\s+id=["']OLK_SRC_BODY_SECTION["'][^>]*>/i,
    // Outlook reply divider — desktop adds this around the header block on reply.
    /<div\s+id=["']divRplyFwdMsg["'][^>]*>/i,
    // Gmail quoted reply container.
    /<div\s+class=["'][^"']*\bgmail_quote\b[^"']*["'][^>]*>/i,
    // Apple Mail / various: blockquote with cite type wraps quoted history.
    /<blockquote[^>]*type=["']cite["'][^>]*>/i,
    // Plain-text "Original Message" marker (English + most common Western EU).
    /-{2,}\s*(?:Original\s+Message|Message\s+d['’]origine|Ursprüngliche\s+Nachricht|Mensaje\s+original|Messaggio\s+originale|Mensagem\s+original)\s*-{2,}/i,
    // HR followed by an English header block — some replies use this shape.
    /<hr[^>]*>\s*(?:<div[^>]*>|<p[^>]*>)?\s*(?:<b>|<strong>)?\s*From\s*:/i,
    // Header block on its own ("From: ...<br>Sent: ..."). Locale-aware on the
    // first label so French/German/Spanish/Italian/Portuguese forwards match.
    // Looks for the label followed by ':' then within ~200 chars a Sent/To/Subject
    // companion label — minimises false positives on the literal word "From".
    // Allow any characters in the gap (including `<br>` and other inline tags)
    // since header blocks routinely use `<br>` between lines; the lazy quantifier
    // bounds how far the match can wander.
    /(?:From|De|Da|Von|Inviato\s+da)\s*:[\s\S]{0,200}?(?:Sent|Envoyé|Enviado|Gesendet|Inviato|Verzonden)\s*:/i,
  ];

  let bestIdx = -1;
  for (const re of separators) {
    const m = re.exec(html);
    if (m && m.index >= 0 && (bestIdx === -1 || m.index < bestIdx)) {
      bestIdx = m.index;
    }
  }

  if (bestIdx === -1) return html;

  // Cuts may land in the middle of a wrapping block (e.g., the separator is
  // `From:` inside `<p>From: ...</p>` — slicing at "From:" leaves an orphan
  // `<p>`). Loop trim: drop trailing empty blocks, drop trailing orphan
  // openers, repeat until stable. Converges in 1–2 iterations.
  let top = html.slice(0, bestIdx);
  const trailingJunk =
    /(?:\s|&nbsp;|<br\s*\/?>|<p[^>]*>(?:\s|&nbsp;|<br\s*\/?>)*<\/p>|<div[^>]*>(?:\s|&nbsp;|<br\s*\/?>)*<\/div>)+$/i;
  const trailingOrphanOpener = /<(?:p|div|span)\b[^>]*>\s*$/i;
  for (let i = 0; i < 4; i++) {
    const before = top;
    top = top.replace(trailingJunk, "");
    top = top.replace(trailingOrphanOpener, "");
    if (top === before) break;
  }
  return top;
}

