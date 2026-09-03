/* eslint-disable */
// Outlook on-send handler for the Halo plugin.
//
// Registered as `onMessageSendHandler` in the manifest's runtimes.actions and
// hooked to autoRunEvents[].messageSending. Lives in its own short-lived
// runtime served from the same origin (tools.iusehalo.com) as the task pane.
//
// Contract:
// - Outlook calls onMessageSendHandler(event) the moment the user clicks Send.
// - We have ~5 minutes to call event.completed() or the send is cancelled.
// - We always allow the send to proceed; Halo append failure is non-fatal.
//
// Diagnostics: every stage appends to a localStorage log ("halo.diagLog.v1")
// which the task pane's Settings → Diagnostics panel reads and polls. We use
// localStorage (not roamingSettings) because roamingSettings is loaded once
// per runtime and never refreshed — so the task pane couldn't see entries
// the launch-event runtime wrote after the task pane opened. localStorage
// is synchronous and shared across all same-origin runtimes.
// Stays in lock-step with apps/outlook/src/lib/diagnostics.ts (same key,
// same entry shape).

(function () {
  var TOKENS_KEY = "halo.tokens.v1";
  var CONFIG_KEY = "halo.tenantConfig.v1";
  var TICKET_PROP = "haloLogTicketId";
  // Stage props written by the compose pane. PENDING_CREATE_PROP is JSON
  // {summary, ticketTypeId} — when present, we POST /api/Ticket first,
  // then append the action to the new ticket. TIMER + CHARGE_RATE feed
  // timetaken (decimal hours) and chargerate on the action.
  var PENDING_CREATE_PROP = "haloLogPendingCreate";
  var TIMER_TIME_PROP = "haloComposeTimeSeconds";
  var CHARGE_RATE_PROP = "haloComposeChargeRateId";
  var DIAG_LOG_KEY = "halo.diagLog.v1";
  var DEFAULTS_KEY = "halo.defaults.v1";
  var CONTROL_SNAPSHOT_KEY = "halo.controlSnapshot.v1";
  var MAILBOX_SNAPSHOT_KEY = "halo.mailboxSnapshot.v1";
  // Shorter per-request budget for the auto-lookup path so that two sequential
  // calls (user search → ticket list) still finish well inside SAFETY_MS.
  var AUTO_LOOKUP_FETCH_MS = 1500;
  var MAX_ENTRIES = 200;
  var MAX_MESSAGE_LEN = 500;
  var MAX_BYTES = 64000;

  // Outer safety: must fire BEFORE Outlook's own "taking longer than expected"
  // prompt — which the office-js issue tracker confirms appears at 5 seconds
  // on Outlook on the web (issue #3180). Anything ≥5s means the user sees
  // Outlook's generic dialog instead of our diagnostic errorMessage.
  var SAFETY_MS = 4000;
  // Per-fetch budget — token refresh and Action POST. AbortController turns a
  // hung CORS preflight into a real catchable error. Kept under SAFETY_MS so
  // a network failure surfaces through our .catch path, not the outer safety.
  var FETCH_TIMEOUT_MS = 3000;

  function getRoaming() {
    try { return Office.context.roamingSettings; } catch (e) { return null; }
  }

  function getTokens() {
    var rs = getRoaming();
    return rs ? rs.get(TOKENS_KEY) : undefined;
  }

  function getConfig() {
    var rs = getRoaming();
    return rs ? rs.get(CONFIG_KEY) : undefined;
  }

  function getDefaults() {
    try {
      var rs = getRoaming();
      return (rs && rs.get(DEFAULTS_KEY)) || {};
    } catch (e) { return {}; }
  }

  function domainOf(email) {
    var at = email.lastIndexOf("@");
    return at >= 0 ? email.slice(at + 1).toLowerCase() : "";
  }

  // Resolve To: recipients to a single open Halo ticket, or null when there
  // are zero or multiple matches (ambiguous — don't auto-log).
  // Strategy: search for a Halo user by email, fall back to client by domain,
  // then list open tickets for the found entity. Fan out in parallel across
  // recipients; dedupe results. Returns Promise<number|null>.
  function autoFindTicketForRecipients(toEmails) {
    if (!toEmails || toEmails.length === 0) return Promise.resolve(null);
    return getAccessToken().then(function (token) {
      var cfg = getConfig();
      var hdrs = { "Authorization": "Bearer " + token, "Accept": "application/json" };

      // Cap at 3 recipients to stay within the time budget.
      var limited = toEmails.slice(0, 3);

      return Promise.all(limited.map(function (email) {
        var domain = domainOf(email);

        // 1. User lookup by email.
        return fetchWithTimeout(
          cfg.haloBaseUrl + "/api/Users?search=" + encodeURIComponent(email) + "&pageinate=false",
          { headers: hdrs },
          AUTO_LOOKUP_FETCH_MS
        ).then(function (r) {
          return r.ok ? r.json() : [];
        }).then(function (json) {
          var users = Array.isArray(json) ? json : ((json && json.users) || []);
          var user = null;
          for (var i = 0; i < users.length; i++) {
            if (users[i].emailaddress &&
                users[i].emailaddress.toLowerCase() === email.toLowerCase()) {
              user = users[i];
              break;
            }
          }

          // 2a. User found → query open tickets by user_id.
          if (user && user.id) {
            return fetchWithTimeout(
              cfg.haloBaseUrl + "/api/Tickets?user_id=" + user.id +
                "&open_only=true&pageinate=false&includedetails=true",
              { headers: hdrs },
              AUTO_LOOKUP_FETCH_MS
            ).then(function (r) {
              return r.ok ? r.json() : [];
            }).then(function (json) {
              return Array.isArray(json) ? json : ((json && json.tickets) || []);
            });
          }

          // 2b. No user → client search by domain.
          if (!domain) return [];
          return fetchWithTimeout(
            cfg.haloBaseUrl + "/api/Client?search=" + encodeURIComponent(domain) +
              "&pageinate=false",
            { headers: hdrs },
            AUTO_LOOKUP_FETCH_MS
          ).then(function (r) {
            return r.ok ? r.json() : [];
          }).then(function (json) {
            var clients = Array.isArray(json) ? json : ((json && json.clients) || []);
            // Prefer a client whose emaildomain matches; fall back to first result.
            var client = null;
            for (var i = 0; i < clients.length; i++) {
              if (clients[i].emaildomain &&
                  domain.indexOf(clients[i].emaildomain.toLowerCase()) >= 0) {
                client = clients[i];
                break;
              }
            }
            if (!client && clients.length > 0) client = clients[0];
            if (!client) return [];

            return fetchWithTimeout(
              cfg.haloBaseUrl + "/api/Tickets?client_id=" + client.id +
                "&open_only=true&pageinate=false&includedetails=true",
              { headers: hdrs },
              AUTO_LOOKUP_FETCH_MS
            ).then(function (r) {
              return r.ok ? r.json() : [];
            }).then(function (json) {
              return Array.isArray(json) ? json : ((json && json.tickets) || []);
            });
          });
        }).catch(function () { return []; });
      }));
    }).then(function (ticketArrays) {
      var seen = {};
      var tickets = [];
      for (var i = 0; i < ticketArrays.length; i++) {
        var arr = ticketArrays[i] || [];
        for (var j = 0; j < arr.length; j++) {
          var t = arr[j];
          if (t && typeof t.id === "number" && !seen[t.id]) {
            seen[t.id] = true;
            tickets.push(t);
          }
        }
      }
      logEvent("info", "auto-lookup complete", { found: tickets.length });
      return tickets.length === 1 ? tickets[0].id : null;
    }).catch(function (err) {
      logEvent("warn", "auto-lookup error: " + (err && err.message ? err.message : String(err)));
      return null;
    });
  }

  // Append a diagnostic entry to the shared cross-runtime log. Synchronous —
  // no fire-and-forget races, so even an entry written immediately before
  // event.completed() is durable.
  function logEvent(level, message, data) {
    try {
      var raw = window.localStorage.getItem(DIAG_LOG_KEY);
      var arr = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(arr)) arr = [];
      var entry = {
        ts: new Date().toISOString(),
        level: level,
        source: "on-send",
        message: message && message.length > MAX_MESSAGE_LEN
          ? message.slice(0, MAX_MESSAGE_LEN) + "…"
          : message,
      };
      if (data) entry.data = data;
      arr.push(entry);
      if (arr.length > MAX_ENTRIES) arr = arr.slice(-MAX_ENTRIES);
      while (arr.length > 1 && JSON.stringify(arr).length > MAX_BYTES) {
        arr = arr.slice(1);
      }
      window.localStorage.setItem(DIAG_LOG_KEY, JSON.stringify(arr));
    } catch (e) {
      // Logging must never throw into the handler path.
    }
    // Mirror to console for the dev-tools window if it happens to be open.
    try { console.log("[halo-on-send]", level, message, data || ""); } catch (e) {}
  }

  // Module-load breadcrumb. If the diagnostics panel never shows this entry
  // after a send attempt, the launch-event runtime itself didn't load — that
  // narrows the problem to manifest registration / Outlook activation rules
  // rather than anything inside the handler.
  logEvent("info", "launchevent.js module loaded");

  // Signal to Office.js that the add-in has finished its load sequence.
  // Without this, Office.js stays in a partial-init state and the iframe's
  // own dispatcher throws "Office.js has not fully loaded" when Outlook fires
  // the messageSending event — meaning our (correctly-registered) handler is
  // never invoked and the Smart Alerts progress dialog hangs forever.
  // Microsoft's smart-alerts-onmessagesend sample calls Office.onReady() at
  // the top of launchevent.js for exactly this reason.
  // Calling with no callback is sufficient — it's the signal that flips the
  // internal isReady gate, not the awaiting that matters.
  if (typeof Office !== "undefined" && typeof Office.onReady === "function") {
    try {
      Office.onReady();
      logEvent("info", "Office.onReady() called");
    } catch (e) {
      logEvent("error", "Office.onReady() threw: " + (e && e.message ? e.message : String(e)));
    }
  } else {
    logEvent("error", "Office or Office.onReady unavailable at module load");
  }

  // Wrap fetch with an AbortController-driven timeout. Rejects with a tagged
  // error if the request runs longer than ms — covers hung CORS preflights.
  function fetchWithTimeout(url, init, ms) {
    var ctrl = (typeof AbortController !== "undefined") ? new AbortController() : null;
    var initWithSignal = Object.assign({}, init || {});
    if (ctrl) initWithSignal.signal = ctrl.signal;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, ms);
    return fetch(url, initWithSignal).then(
      function (r) { clearTimeout(timer); return r; },
      function (e) {
        clearTimeout(timer);
        var msg = (e && e.name === "AbortError")
          ? ("Halo request timed out after " + ms + "ms (network/CORS)")
          : ("fetch failed: " + (e && e.message ? e.message : String(e)));
        throw new Error(msg);
      },
    );
  }

  function getAccessToken() {
    var tokens = getTokens();
    var cfg = getConfig();
    if (!tokens || !cfg) return Promise.reject(new Error("Not authenticated (no tokens/config in roamingSettings)"));
    if (Date.now() < tokens.expiresAt - 60000) return Promise.resolve(tokens.accessToken);

    logEvent("info", "refreshing access token");
    var body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: tokens.refreshToken,
      client_id: cfg.clientId,
    });
    return fetchWithTimeout(cfg.haloBaseUrl + "/auth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body,
    }, FETCH_TIMEOUT_MS)
      .then(function (r) {
        if (!r.ok) throw new Error("Token refresh failed " + r.status);
        return r.json();
      })
      .then(function (json) {
        var fresh = {
          accessToken: json.access_token,
          refreshToken: json.refresh_token || tokens.refreshToken,
          expiresAt: Date.now() + json.expires_in * 1000,
          scope: json.scope,
        };
        var rs = getRoaming();
        if (rs) {
          rs.set(TOKENS_KEY, fresh);
          rs.saveAsync(function () {});
        }
        return fresh.accessToken;
      });
  }

  function loadCustomProps() {
    return new Promise(function (resolve, reject) {
      Office.context.mailbox.item.loadCustomPropertiesAsync(function (r) {
        if (r.status !== Office.AsyncResultStatus.Succeeded) {
          reject(new Error("custom props load failed: " + (r.error && r.error.message)));
          return;
        }
        resolve(r.value);
      });
    });
  }

  function readBody() {
    return new Promise(function (resolve, reject) {
      Office.context.mailbox.item.body.getAsync(Office.CoercionType.Html, function (r) {
        if (r.status !== Office.AsyncResultStatus.Succeeded) {
          reject(new Error("body read failed: " + (r.error && r.error.message)));
          return;
        }
        resolve(r.value);
      });
    });
  }

  function readSubject() {
    return new Promise(function (resolve) {
      Office.context.mailbox.item.subject.getAsync(function (r) {
        if (r.status !== Office.AsyncResultStatus.Succeeded) { resolve(""); return; }
        resolve(r.value || "");
      });
    });
  }

  function readRecipientsField(field) {
    return new Promise(function (resolve) {
      try {
        field.getAsync(function (r) {
          if (r.status !== Office.AsyncResultStatus.Succeeded) { resolve([]); return; }
          resolve((r.value || []).map(function (e) { return e.emailAddress; }).filter(Boolean));
        });
      } catch (e) {
        resolve([]);
      }
    });
  }

  // Read the control snapshot the task pane wrote after loading /api/Control.
  // Synchronous, never throws — falls through to {} when not yet written.
  function getControlSnapshot() {
    try {
      var raw = window.localStorage.getItem(CONTROL_SNAPSHOT_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (e) { return {}; }
  }

  // Inbound Halo intake mailbox addresses (lowercased) the task pane stashed
  // from ClientCache. Returns [] when unavailable. Used to avoid double-logging:
  // if a reply goes to one of these, Halo's native intake will log it itself.
  function getMailboxSnapshot() {
    try {
      var raw = window.localStorage.getItem(MAILBOX_SNAPSHOT_KEY);
      var arr = raw ? JSON.parse(raw) : [];
      return Object.prototype.toString.call(arr) === "[object Array]" ? arr : [];
    } catch (e) { return []; }
  }

  // True when any recipient address is a Halo intake mailbox.
  function recipientsHitHaloMailbox(toList, ccList) {
    var intake = getMailboxSnapshot();
    if (!intake.length) return false;
    var recips = (toList || []).concat(ccList || []);
    for (var i = 0; i < recips.length; i++) {
      if (intake.indexOf(String(recips[i]).trim().toLowerCase()) >= 0) return true;
    }
    return false;
  }

  // Try to extract a Halo ticket ID from an email subject using the configured
  // email start/end tags (e.g. "[" and "]" wrapping the ticket number).
  // Reads from the control snapshot — returns a number or null.
  function extractTicketIdFromSubject(subject) {
    if (!subject) return null;
    var snap = getControlSnapshot();
    var start = snap.email_start_tag;
    var end = snap.email_end_tag;
    if (!start || !end) return null;
    var escStart = start.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    var escEnd   = end.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    var m = new RegExp(escStart + "(\\d+)" + escEnd).exec(subject);
    return m ? Number(m[1]) : null;
  }

  // Read the agent snapshot the task pane wrote after its ClientCache load.
  // Synchronous, never throws — falls through to {} when the task pane has
  // never opened or ClientCache hasn't resolved yet. Used for agent_id
  // attribution and signature stripping on outbound mail.
  function getAgentSnapshot() {
    try {
      var raw = window.localStorage.getItem("halo.agentSnapshot.v1");
      return raw ? JSON.parse(raw) : {};
    } catch (e) {
      return {};
    }
  }

  // Strip a known signature from an HTML body via exact substring match.
  // Falls through to the original body when sig is empty or not present
  // verbatim — false-positive stripping is worse than leaving the sig in.
  function stripSignature(html, sig) {
    if (!sig || !html) return html;
    var i = html.indexOf(sig);
    if (i === -1) return html;
    return html.slice(0, i) + html.slice(i + sig.length);
  }

  // Strip the quoted/forwarded portion from an Outlook HTML reply body so
  // only the agent's new text is logged to Halo. Handles the three most
  // common quoting patterns:
  //   • Outlook desktop/OWA: <div id="divRplyFwdMsg"> (+ preceding <hr>)
  //   • Generic / iOS Mail:  <blockquote> wrapping the quoted thread
  //   • Gmail:               <div class="gmail_quote">
  // Falls back to the original html on any error — never blocks the send.
  function stripQuotedContent(html) {
    if (!html) return html;
    try {
      var parser = new DOMParser();
      var doc = parser.parseFromString(html, "text/html");
      var body = doc.body;

      // Outlook reply/forward separator.
      var rplyDiv = doc.getElementById("divRplyFwdMsg");
      if (rplyDiv && rplyDiv.parentNode) {
        var children = Array.from(rplyDiv.parentNode.childNodes);
        var idx = children.indexOf(rplyDiv);
        // Pull in a leading <hr> if present so we don't leave a dangling rule.
        var start = (idx > 0 && children[idx - 1].nodeName === "HR") ? idx - 1 : idx;
        children.slice(start).forEach(function (n) {
          if (n.parentNode) n.parentNode.removeChild(n);
        });
      }

      // Blockquote-style quoting (iOS Mail, many web clients).
      Array.from(body.querySelectorAll("blockquote")).forEach(function (el) {
        if (el.parentNode) el.parentNode.removeChild(el);
      });

      // Gmail quote wrapper.
      Array.from(body.querySelectorAll("div.gmail_quote")).forEach(function (el) {
        if (el.parentNode) el.parentNode.removeChild(el);
      });

      return body.innerHTML.trim();
    } catch (e) {
      return html;
    }
  }

  // Minimal HTML → plain text for emailbody field. Same approach as the
  // task pane's htmlToText helper but inline in ES5 for the launchevent
  // runtime.
  // Mirrors sanitizeOutlookHtml in apps/outlook/src/lib/html.ts — see the
  // doc comment there for what each pass strips and why. Duplicated here
  // because the launch-event runtime is vanilla JS and can't import the
  // shared lib. Keep the two in sync if either is touched.
  function sanitizeOutlookHtml(html) {
    if (!html) return "";
    var out = html;
    out = out.replace(/<!--\[if[\s\S]*?<!\[endif\]-->/gi, "");
    out = out.replace(/<\/?[ovwx]:[a-z][^>]*>/gi, "");
    out = out.replace(/(\s*)mso-[a-z-]+\s*:[^;"']*(?:;|(?=["']))/gi, "");
    out = out.replace(/\s*class=(?:"|')Mso[^"']*(?:"|')/g, "");
    out = out.replace(/\s*style=(?:"|')\s*(?:"|')/g, "");
    out = out.replace(
      /(?:<p[^>]*>(?:\s|&nbsp;| )*<\/p>\s*){2,}/gi,
      "<p>&nbsp;</p>",
    );
    out = out.replace(
      /(?:<div[^>]*>(?:\s|&nbsp;|<br\s*\/?>)*<\/div>\s*){2,}/gi,
      "<div>&nbsp;</div>",
    );
    out = out.replace(/(?:<br\s*\/?>\s*){3,}/gi, "<br><br>");
    return out;
  }

  // Mirrors extractTopReply in apps/outlook/src/lib/html.ts — keep in sync.
  // Returns only the topmost portion of an email body (above the first quoted-
  // reply separator). The separator itself is dropped; trailing empty
  // paragraphs / orphan opening tags from a mid-block cut are trimmed.
  function extractTopReply(html) {
    if (!html) return "";
    var separators = [
      /<div\s+id=["']appendonsend["'][^>]*>/i,
      /<div\s+id=["']OLK_SRC_BODY_SECTION["'][^>]*>/i,
      /<div\s+id=["']divRplyFwdMsg["'][^>]*>/i,
      /<div\s+class=["'][^"']*\bgmail_quote\b[^"']*["'][^>]*>/i,
      /<blockquote[^>]*type=["']cite["'][^>]*>/i,
      /-{2,}\s*(?:Original\s+Message|Message\s+d['’]origine|Ursprüngliche\s+Nachricht|Mensaje\s+original|Messaggio\s+originale|Mensagem\s+original)\s*-{2,}/i,
      /<hr[^>]*>\s*(?:<div[^>]*>|<p[^>]*>)?\s*(?:<b>|<strong>)?\s*From\s*:/i,
      /(?:From|De|Da|Von|Inviato\s+da)\s*:[\s\S]{0,200}?(?:Sent|Envoyé|Enviado|Gesendet|Inviato|Verzonden)\s*:/i,
    ];
    var bestIdx = -1;
    for (var i = 0; i < separators.length; i++) {
      var m = separators[i].exec(html);
      if (m && m.index >= 0 && (bestIdx === -1 || m.index < bestIdx)) bestIdx = m.index;
    }
    if (bestIdx === -1) return html;
    var top = html.slice(0, bestIdx);
    var trailingJunk =
      /(?:\s|&nbsp;|<br\s*\/?>|<p[^>]*>(?:\s|&nbsp;|<br\s*\/?>)*<\/p>|<div[^>]*>(?:\s|&nbsp;|<br\s*\/?>)*<\/div>)+$/i;
    var trailingOrphanOpener = /<(?:p|div|span)\b[^>]*>\s*$/i;
    for (var j = 0; j < 4; j++) {
      var before = top;
      top = top.replace(trailingJunk, "");
      top = top.replace(trailingOrphanOpener, "");
      if (top === before) break;
    }
    return top;
  }

  // Mirror of formatHaloDate + getItemImportance in apps/outlook/src/lib/office.ts —
  // keep in sync if either is touched.
  function formatHaloDate(d) {
    var dt = d ? new Date(d) : new Date();
    return dt.toISOString().replace(/Z$/, "");
  }
  function getItemImportance() {
    try {
      var imp = Office.context.mailbox.item && Office.context.mailbox.item.importance;
      if (typeof imp === "string" && imp) return imp.toLowerCase();
    } catch (e) { /* swallow */ }
    return "normal";
  }

  function htmlToText(html) {
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
   * Create a ticket from the compose draft + email metadata, return its id.
   * Used by the on-send create-then-append path when the compose pane
   * staged a haloLogPendingCreate payload instead of a ticket id.
   *
   * Stamps the same email metadata as native intake (emaildirection: "O",
   * email_status: 2, emailbody_html, mailentryid, etc.) so the resulting
   * ticket looks identical to one Halo's own intake would have created.
   * Validation flags (_novalidate, _forcereassign) bypass required-custom-
   * field prompts.
   */
  function createTicketFromPending(pending, data) {
    return getAccessToken().then(function (token) {
      var cfg = getConfig();
      var agent = getAgentSnapshot();
      var senderEmail = "";
      var senderName = "";
      var mailentryid = "";
      try {
        senderEmail = Office.context.mailbox.userProfile.emailAddress || "";
        senderName = Office.context.mailbox.userProfile.displayName || "";
      } catch (e) { /* swallow */ }
      try { mailentryid = Office.context.mailbox.item.itemId || ""; } catch (e) { /* swallow */ }

      // Sanitize once and reuse — details + emailbody_html both want the
      // cleaned HTML, htmlToText runs over the cleaned version too.
      var cleanedBody = sanitizeOutlookHtml(data.body || "");
      // Native-intake convention: details (= note for the auto-created action)
      // gets only the topmost reply; emailbody_html below keeps the full body
      // including the quoted thread.
      var detailsHtml = extractTopReply(cleanedBody);
      var detailsPlain = htmlToText(detailsHtml);

      var payload = [{
        summary: pending.summary,
        details: detailsHtml,
        tickettype_id: pending.ticketTypeId,
        emailfrom: senderName || senderEmail,
        emailfromname: senderName,
        emailfromaddress: senderEmail,
        // On-send is always outbound: emailto is the recipient (customer).
        emailto: (data.to || []).join("; "),
        emailcc: (data.cc || []).join("; "),
        // Canonical Halo subject — replaces legacy emailsubject.
        emailsubjectnew: data.subject,
        emailimportance: getItemImportance(),
        dateemailed: formatHaloDate(new Date()),
        outcome_id: 0,
        // Outbound by construction (on-send fires while the agent is sending).
        _isuserupdate: false,
        // Halo's note (plaintext) + note_html (HTML) convention. Both required.
        note: detailsPlain,
        note_html: detailsHtml,
        // Action-author triplet — agent attribution on outbound.
        who: agent.name || "",
        who_agentid: agent.id || -1,
        who_type: 1,
        mailentryid: mailentryid || undefined,
        emaildirection: "O",
        email_status: 2,
        emailbody_html: cleanedBody,
        emailbody: htmlToText(cleanedBody),
        from_address_override: senderEmail,
        from_mailbox_id: -2,
        sales_mailbox_override_id: agent.salesMailboxId || undefined,
        agent_id: agent.id || undefined,
        _novalidate: true,
        _forcereassign: true,
      }];
      logEvent("info", "POST /api/Ticket", {
        summary: pending.summary,
        ticketTypeId: pending.ticketTypeId || null,
      });
      return fetchWithTimeout(cfg.haloBaseUrl + "/api/Ticket", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer " + token,
        },
        body: JSON.stringify(payload),
      }, FETCH_TIMEOUT_MS).then(function (r) {
        if (!r.ok) {
          return r.text().then(function (t) {
            throw new Error("Halo /Ticket " + r.status + ": " + t.slice(0, 200));
          });
        }
        return r.json();
      }).then(function (json) {
        // Halo's create response shape varies: single object, array of one,
        // or { tickets: [...] }. Pull the id from whichever form arrives.
        var entity = Array.isArray(json) ? json[0]
          : (json && json.tickets && json.tickets[0]) ? json.tickets[0]
          : json;
        if (!entity || typeof entity.id !== "number") {
          throw new Error("Halo /Ticket created OK but response had no id");
        }
        return entity.id;
      });
    });
  }

  function appendToHalo(ticketId, data) {
    return getAccessToken().then(function (token) {
      var cfg = getConfig();
      var agent = getAgentSnapshot();
      var senderEmail = "";
      var senderName = "";
      var mailentryid = "";
      try {
        senderEmail = Office.context.mailbox.userProfile.emailAddress || "";
        senderName = Office.context.mailbox.userProfile.displayName || "";
      } catch (e) {
        // fall through with blanks
      }
      try {
        // On compose, item.itemId is populated once the draft has been saved
        // server-side. For sends Outlook saves the item before firing the
        // messageSending event, so itemId should be available here. If it's
        // not (older Outlook builds, race), the payload omits the field and
        // Halo treats it the same as native intake without an EntryId.
        mailentryid = Office.context.mailbox.item.itemId || "";
      } catch (e) {
        /* swallow */
      }
      // On-send is always outbound. Note gets only the topmost new content
      // (above the first quoted-reply separator) with the agent's saved Halo
      // signature additionally stripped. emailbody_html below keeps the full
      // body for parity with native intake.
      // Sanitize first so all downstream patterns see the cleaned HTML.
      var cleanedBody = sanitizeOutlookHtml(data.body || "");
      var noteHtml = stripSignature(extractTopReply(cleanedBody), agent.signature);
      var notePlain = htmlToText(noteHtml);
      var payload = [{
        ticket_id: Number(ticketId),
        outcome: "Outgoing Email",
        outcome_id: 0,
        // Outbound by construction.
        _isuserupdate: false,
        // Halo's note (plaintext) + note_html (HTML) convention. Both required.
        note: notePlain,
        note_html: noteHtml,
        hiddenfromuser: false,
        actionhide: 0,
        emailfrom: senderName || senderEmail,
        emailfromname: senderName,
        emailfromaddress: senderEmail,
        // Outbound: emailto is the recipient (the customer).
        emailto: (data.to || []).join("; "),
        emailcc: (data.cc || []).join("; "),
        // Canonical Halo subject — replaces legacy emailsubject.
        emailsubjectnew: data.subject,
        emailimportance: getItemImportance(),
        dateemailed: formatHaloDate(new Date()),
        // Agent attribution — use the cached Halo agent id when available,
        // 0 as a marker for "Halo, attribute to API caller" otherwise.
        agent_id: agent.id || 0,
        // Action-author triplet — agent on outbound (who_type=1).
        who: agent.name || "",
        who_agentid: agent.id || -1,
        who_type: 1,
        mailentryid: mailentryid || undefined,
        // Direction + delivered-status guard matches Halo's native intake.
        emaildirection: "O",
        email_status: 2,
        // Full original body in both formats so the action mirrors what
        // native intake produces.
        emailbody_html: cleanedBody,
        emailbody: htmlToText(cleanedBody),
        // For outbound mail: stamp from_address_override with the agent's
        // actual send-from address. from_mailbox_id: -2 signals "use
        // overridden from address".
        from_address_override: senderEmail,
        from_mailbox_id: -2,
        // Per-agent sales mailbox setup id, resolved by the task pane at app
        // load via /api/SalesMailbox and stamped into the snapshot. Undefined
        // when the agent has no sales mailbox configured — Halo falls back
        // to tenant defaults.
        sales_mailbox_override_id: agent.salesMailboxId || undefined,
        // Time tracking from the compose timer. data.timeSeconds is the
        // raw second count (capped at 30 min by the UI); Halo expects
        // decimal hours on time_taken. Omit both fields when 0 so we
        // don't pollute Halo's time reports with empty entries.
        timetaken: data.timeSeconds > 0 ? Math.max(data.timeSeconds, 60) / 3600 : undefined,
        chargerate: data.chargeRateId > 0 ? data.chargeRateId : undefined,
      }];
      logEvent("info", "POST /api/Actions", {
        ticketId: ticketId,
        bodyLen: (data.body || "").length,
        timeSeconds: data.timeSeconds || 0,
        chargeRateId: data.chargeRateId || 0,
        toCount: (data.to || []).length,
      });
      return fetchWithTimeout(cfg.haloBaseUrl + "/api/Actions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer " + token,
        },
        body: JSON.stringify(payload),
      }, FETCH_TIMEOUT_MS).then(function (r) {
        if (!r.ok) {
          return r.text().then(function (t) { throw new Error("Halo " + r.status + ": " + t.slice(0, 200)); });
        }
        return r.json();
      });
    });
  }

  function onMessageSendHandler(event) {
    // Absolute-first tracer: write a raw localStorage key the moment the
    // handler is entered, BEFORE any closure-captured helper is touched.
    // If diagnostics shows "handler entered" via logEvent but this key is
    // missing, the issue is between dispatch and our entry. If this key
    // is set but "handler entered" never logs, logEvent itself is broken
    // in the dispatch context.
    try {
      window.localStorage.setItem("halo.onSendEntry.v1", new Date().toISOString());
    } catch (e) { /* swallow */ }

    var startedAt = Date.now();
    var completed = false;
    var stage = "init";

    logEvent("info", "handler entered");

    var finish = function (errorMessage) {
      if (completed) return;
      completed = true;
      var opts = { allowEvent: true };
      if (errorMessage) opts.errorMessage = errorMessage;
      logEvent(errorMessage ? "error" : "info",
        errorMessage ? ("finished with error in '" + stage + "': " + errorMessage)
                     : ("finished ok in '" + stage + "'"),
        { stage: stage, durationMs: Date.now() - startedAt });
      // logEvent writes synchronously to localStorage, so the entry above is
      // durable before event.completed() terminates the runtime.
      try { event.completed(opts); } catch (e) {}
    };

    // Outer safety. If we get here, something below didn't propagate.
    var safety = setTimeout(function () {
      finish("HaloPSA log-on-send hung in stage \"" + stage + "\" — email sent anyway.");
    }, SAFETY_MS);

    stage = "loadCustomProps";
    logEvent("info", "stage → loadCustomProps");
    loadCustomProps().then(function (cp) {
      var ticketIdRaw = cp.get(TICKET_PROP);
      var pendingRaw = cp.get(PENDING_CREATE_PROP);
      var timeSecondsRaw = cp.get(TIMER_TIME_PROP);
      var chargeRateRaw = cp.get(CHARGE_RATE_PROP);

      var pending;
      if (pendingRaw) {
        try { pending = JSON.parse(pendingRaw); }
        catch (e) { pending = undefined; }
      }
      var stagedTicketId = ticketIdRaw ? Number(ticketIdRaw) : undefined;
      var timeSeconds = Number(timeSecondsRaw || 0);
      if (!isFinite(timeSeconds) || timeSeconds < 0) timeSeconds = 0;
      var chargeRateId = Number(chargeRateRaw || 0);
      if (!isFinite(chargeRateId)) chargeRateId = 0;

      logEvent("info", "stage targets resolved", {
        ticketId: stagedTicketId || null,
        pending: pending ? pending.summary : null,
        timeSeconds: timeSeconds,
        chargeRateId: chargeRateId,
      });

      if (!stagedTicketId && !pending) {
        var defaults = getDefaults();
        if (!defaults.autoLogRepliesToTickets) {
          clearTimeout(safety);
          finish();
          return;
        }
        // Auto-import path: subject-tag match first (fast, unambiguous for
        // replies to ticket emails), then fall back to recipient lookup.
        stage = "autoLookup";
        logEvent("info", "stage → autoLookup");
        readSubject().then(function (subject) {
          var tagId = extractTicketIdFromSubject(subject);
          if (tagId) {
            logEvent("info", "auto-lookup: subject-tag match", { ticketId: tagId });
            return Promise.resolve({ foundId: tagId, subject: subject, toEmails: null });
          }
          // No subject tag — fall back to recipient lookup (requires unique match).
          return readRecipientsField(Office.context.mailbox.item.to)
            .then(function (toEmails) {
              return autoFindTicketForRecipients(toEmails).then(function (foundId) {
                return { foundId: foundId, subject: subject, toEmails: toEmails };
              });
            });
        }).then(function (result) {
          if (!result.foundId) {
            logEvent("info", "auto-lookup: no match, skipping");
            clearTimeout(safety);
            finish();
            return;
          }
          logEvent("info", "auto-lookup: matched ticket", { ticketId: result.foundId });
          stage = "readItem";
          var toPromise = result.toEmails
            ? Promise.resolve(result.toEmails)
            : readRecipientsField(Office.context.mailbox.item.to);
          return Promise.all([
            readBody(),
            Promise.resolve(result.subject),
            toPromise,
            readRecipientsField(Office.context.mailbox.item.cc),
          ]).then(function (parts) {
            // If a Halo intake mailbox is among the recipients, native intake
            // will log this reply itself — appending here too would double-post.
            if (recipientsHitHaloMailbox(parts[2], parts[3])) {
              logEvent("info", "auto-log suppressed: halo intake mailbox in recipients");
              return null;
            }
            var data = {
              body: parts[0],
              subject: parts[1],
              to: parts[2],
              cc: parts[3],
              timeSeconds: timeSeconds,
              chargeRateId: chargeRateId,
            };
            stage = "appendToHalo";
            logEvent("info", "stage → appendToHalo (auto)", { ticketId: result.foundId });
            return appendToHalo(result.foundId, data);
          }).then(function () {
            clearTimeout(safety);
            finish();
          });
        }).catch(function (err) {
          clearTimeout(safety);
          finish("HaloPSA auto-import failed: " +
            (err && err.message ? err.message : String(err)) + ". Email sent anyway.");
        });
        return;
      }

      stage = "readItem";
      logEvent("info", "stage → readItem");
      return Promise.all([
        readBody(),
        readSubject(),
        readRecipientsField(Office.context.mailbox.item.to),
        readRecipientsField(Office.context.mailbox.item.cc),
      ]).then(function (parts) {
        var data = {
          body: parts[0],
          subject: parts[1],
          to: parts[2],
          cc: parts[3],
          timeSeconds: timeSeconds,
          chargeRateId: chargeRateId,
        };
        // Create-then-append path: pending payload wins over a staged
        // ticketId (the more recent intent). Post the ticket first, then
        // append the action to the new ticket id.
        if (pending) {
          stage = "createTicket";
          logEvent("info", "stage → createTicket", { summary: pending.summary });
          return createTicketFromPending(pending, data).then(function (newId) {
            stage = "appendToHalo";
            logEvent("info", "stage → appendToHalo (newly created)", { ticketId: newId });
            return appendToHalo(newId, data);
          });
        }
        stage = "appendToHalo";
        logEvent("info", "stage → appendToHalo");
        return appendToHalo(stagedTicketId, data);
      }).then(function () {
        stage = "clearMarker";
        logEvent("info", "stage → clearMarker");
        // Clear every staged prop so re-sending the same draft doesn't
        // double-log. Includes timer + charge rate so a fresh draft
        // (next reply from this thread) starts from zero.
        cp.set(TICKET_PROP, null);
        cp.set(PENDING_CREATE_PROP, null);
        cp.set(TIMER_TIME_PROP, null);
        cp.set(CHARGE_RATE_PROP, null);
        cp.saveAsync(function () {
          clearTimeout(safety);
          finish();
        });
      });
    }).catch(function (err) {
      clearTimeout(safety);
      var msg = err && err.message ? err.message : String(err);
      finish("HaloPSA log-on-send failed in \"" + stage + "\": " + msg + ". Email sent anyway.");
    });
  }

  // Register at module load — NOT inside Office.onReady. Microsoft's reference
  // implementations (smart-alerts-walkthrough sample) call associate at top
  // level so the handler is wired before Outlook dispatches the event. Doing
  // it inside Office.onReady introduces a callback delay during which a
  // racing dispatch finds no handler and silently drops the event.
  // Office.actions is part of office.js and becomes available as soon as the
  // script tag finishes — earlier than Office.onReady fires.
  //
  // Also expose the handler at window scope. Office.js's dispatch path
  // is documented to look up the action via the associate map, but some
  // older / mobile / new-Outlook builds also fall back to a global lookup
  // by name. The IIFE hides the function from that path; this re-exposes
  // it without giving up the closure for our helpers.
  if (typeof window !== "undefined") {
    window.onMessageSendHandler = onMessageSendHandler;
  }
  if (typeof Office !== "undefined" && Office.actions && typeof Office.actions.associate === "function") {
    Office.actions.associate("onMessageSendHandler", onMessageSendHandler);
    logEvent("info", "handler registered via Office.actions.associate");
  } else {
    // Fall back to onReady if office.js hasn't fully hooked up actions yet.
    logEvent("warn", "Office.actions.associate unavailable at module load — falling back to Office.onReady");
    if (typeof Office !== "undefined" && typeof Office.onReady === "function") {
      Office.onReady(function () {
        if (Office.actions && typeof Office.actions.associate === "function") {
          Office.actions.associate("onMessageSendHandler", onMessageSendHandler);
          logEvent("info", "handler registered via Office.onReady fallback");
        } else {
          logEvent("error", "Office.actions.associate still unavailable inside Office.onReady");
        }
      });
    }
  }
})();
