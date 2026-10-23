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
// TWO RUNTIMES, ONE FILE. Outlook on the web / new Outlook on Windows load
// launchevent.html (a browser runtime: DOM, window, localStorage). Classic
// Outlook on Windows loads THIS FILE directly into a JavaScript-only runtime:
// no window, no DOM, no localStorage, no cookies, no DOMParser (Microsoft:
// "Runtimes in Office Add-ins"). Everything here must work in both, so:
//   - inputs the task pane prepares for us (agent/control/mailbox snapshots)
//     are read from Office.context.roamingSettings — the one store both
//     runtimes share and that a fresh on-send runtime loads at start;
//   - the diagnostics log is kept in memory for the run and persisted before
//     event.completed(): to localStorage when it exists, to
//     OfficeRuntime.storage when it exists, and always to a bounded
//     roamingSettings mirror the task pane reads back (see
//     apps/outlook/src/lib/diagnostics.ts — same keys, same entry shape);
//   - no imports, no async/await, no relative fetch URLs, no DOM APIs.

(function () {
  var TOKENS_KEY = "halo.tokens.v1";
  var CONFIG_KEY = "halo.tenantConfig.v1";
  var TICKET_PROP = "haloLogTicketId";
  // Stage props written by the compose pane. PENDING_CREATE_PROP is JSON
  // {summary, ticketTypeId} — when present, we POST /api/Ticket carrying the
  // email as the ticket's initial action (ONE write — no follow-up append).
  // TIMER + CHARGE_RATE feed timetaken (decimal hours) and chargerate.
  var PENDING_CREATE_PROP = "haloLogPendingCreate";
  var TIMER_TIME_PROP = "haloComposeTimeSeconds";
  var CHARGE_RATE_PROP = "haloComposeChargeRateId";
  var DIAG_LOG_KEY = "halo.diagLog.v1";
  // Bounded mirror of the on-send log in roamingSettings (the task pane merges
  // it into its diagnostics view). Small on purpose: roamingSettings has a
  // ~32 KB cap shared with tokens + config.
  var DIAG_MIRROR_KEY = "halo.diagLogOnSend.v1";
  var ON_SEND_ENTRY_KEY = "halo.onSendEntry.v1";
  var DEFAULTS_KEY = "halo.defaults.v1";
  var AGENT_SNAPSHOT_KEY = "halo.agentSnapshot.v1";
  var CONTROL_SNAPSHOT_KEY = "halo.controlSnapshot.v1";
  var MAILBOX_SNAPSHOT_KEY = "halo.mailboxSnapshot.v1";
  // Shorter per-request budget for the auto-lookup path so that two sequential
  // calls (user search → ticket list) still finish well inside SAFETY_MS.
  var AUTO_LOOKUP_FETCH_MS = 1500;
  var MAX_ENTRIES = 200;
  var MIRROR_ENTRIES = 40;
  var MIRROR_BYTES = 8000;
  var MAX_MESSAGE_LEN = 500;
  var MAX_BYTES = 64000;

  // Budgets. The LOOKUP phase (custom props, body/subject reads, auto-lookup)
  // is bounded by SAFETY_MS: if it hasn't produced a target by then we let the
  // send go without logging — nothing has been written, so nothing is left
  // half-done. Once a WRITE to Halo starts the budget switches to
  // WRITE_BUDGET_MS and the event is never completed with a write in flight:
  // ending the runtime mid-POST is what leaves a created ticket without its
  // marker cleared (double log on re-send) or an action without its ticket.
  // Outlook's own "taking longer than expected" progress dialog may appear
  // after ~5 s on the web; that is a progress prompt, not a failure, and the
  // hard limit is 300 s. Writes normally finish in 1–2 s.
  var SAFETY_MS = 4000;
  var WRITE_BUDGET_MS = 25000;
  // Per-fetch budgets. Writes get more room than lookups; AbortController
  // (when available) turns a hung CORS preflight into a catchable error.
  var FETCH_TIMEOUT_MS = 3000;
  var WRITE_FETCH_TIMEOUT_MS = 8000;
  var TOKEN_FETCH_TIMEOUT_MS = 5000;
  // How long finish() waits for the diagnostics mirror to persist before
  // completing the event anyway.
  var PERSIST_WAIT_MS = 1500;

  // ---------- Environment probes ----------

  function hasLocalStorage() {
    try {
      return typeof window !== "undefined" && !!window.localStorage &&
        typeof window.localStorage.getItem === "function";
    } catch (e) { return false; }
  }

  function officeStorage() {
    try {
      if (typeof OfficeRuntime !== "undefined" && OfficeRuntime.storage &&
          typeof OfficeRuntime.storage.setItem === "function") {
        return OfficeRuntime.storage;
      }
    } catch (e) { /* not available in this runtime */ }
    return null;
  }

  function getRoaming() {
    try { return Office.context.roamingSettings; } catch (e) { return null; }
  }

  // roamingSettings values may be stored as objects (the halo-api adapter
  // stores objects as-is) or as JSON strings (older writers). Accept both.
  function roamingGet(key) {
    try {
      var rs = getRoaming();
      if (!rs) return undefined;
      var v = rs.get(key);
      if (typeof v === "string") {
        try { return JSON.parse(v); } catch (e) { return v; }
      }
      return v;
    } catch (e) { return undefined; }
  }

  function localGet(key) {
    if (!hasLocalStorage()) return undefined;
    try {
      var raw = window.localStorage.getItem(key);
      return raw ? JSON.parse(raw) : undefined;
    } catch (e) { return undefined; }
  }

  // Snapshot reads: roamingSettings first (written by the task pane through
  // the halo-api storage adapter; readable in BOTH runtimes), localStorage
  // as a fallback for browser runtimes paired with an older task pane build.
  function readSnapshot(key, fallback) {
    var v = roamingGet(key);
    if (v === undefined || v === null) v = localGet(key);
    return (v === undefined || v === null) ? fallback : v;
  }

  function getTokens() { return roamingGet(TOKENS_KEY); }
  function getConfig() { return roamingGet(CONFIG_KEY); }
  function getDefaults() { return readSnapshot(DEFAULTS_KEY, {}) || {}; }
  function getAgentSnapshot() { return readSnapshot(AGENT_SNAPSHOT_KEY, {}) || {}; }
  function getControlSnapshot() { return readSnapshot(CONTROL_SNAPSHOT_KEY, {}) || {}; }
  function getMailboxSnapshot() {
    var arr = readSnapshot(MAILBOX_SNAPSHOT_KEY, []);
    return Object.prototype.toString.call(arr) === "[object Array]" ? arr : [];
  }

  // ---------- Diagnostics ----------
  //
  // Entries accumulate in memory for this run. In a browser runtime they are
  // also appended synchronously to the shared localStorage log (visible live
  // in the task pane). persistDiagnostics() — awaited by finish() — writes the
  // run's entries to OfficeRuntime.storage (when the runtime has it) and to
  // the bounded roamingSettings mirror, so classic Outlook's JavaScript-only
  // runtime (no localStorage) still leaves a trail the task pane can show.

  var runEntries = [];
  var persistStarted = false;

  function truncate(message) {
    if (typeof message !== "string") message = String(message);
    return message.length > MAX_MESSAGE_LEN ? message.slice(0, MAX_MESSAGE_LEN) + "…" : message;
  }

  function trimEntries(arr, maxEntries, maxBytes) {
    if (arr.length > maxEntries) arr = arr.slice(-maxEntries);
    while (arr.length > 1 && JSON.stringify(arr).length > maxBytes) arr = arr.slice(1);
    return arr;
  }

  function appendLocal(entry) {
    if (!hasLocalStorage()) return;
    try {
      var raw = window.localStorage.getItem(DIAG_LOG_KEY);
      var arr = raw ? JSON.parse(raw) : [];
      if (Object.prototype.toString.call(arr) !== "[object Array]") arr = [];
      arr.push(entry);
      window.localStorage.setItem(DIAG_LOG_KEY, JSON.stringify(trimEntries(arr, MAX_ENTRIES, MAX_BYTES)));
    } catch (e) { /* quota / private mode — never throw into the handler */ }
  }

  function logEvent(level, message, data) {
    var entry = { ts: new Date().toISOString(), level: level, source: "on-send", message: truncate(message) };
    if (data) entry.data = data;
    runEntries.push(entry);
    appendLocal(entry);
    try { console.log("[halo-on-send]", level, message, data || ""); } catch (e) {}
  }

  // Persist this run's entries where the task pane can find them. Resolves
  // when done or after PERSIST_WAIT_MS, never rejects.
  function persistDiagnostics(enteredAt) {
    if (persistStarted) return Promise.resolve();
    persistStarted = true;
    var entries = trimEntries(runEntries.slice(), MIRROR_ENTRIES, MIRROR_BYTES);
    var jobs = [];

    var ost = officeStorage();
    if (ost) {
      jobs.push(new Promise(function (resolve) {
        try {
          ost.getItem(DIAG_LOG_KEY).then(function (raw) {
            var arr = [];
            try { arr = raw ? JSON.parse(raw) : []; } catch (e) { arr = []; }
            if (Object.prototype.toString.call(arr) !== "[object Array]") arr = [];
            arr = trimEntries(arr.concat(runEntries), MAX_ENTRIES, MAX_BYTES);
            var items = {};
            items[DIAG_LOG_KEY] = JSON.stringify(arr);
            if (enteredAt) items[ON_SEND_ENTRY_KEY] = enteredAt;
            return ost.setItems(items);
          }).then(function () { resolve(); }, function () { resolve(); });
        } catch (e) { resolve(); }
      }));
    }

    var rs = getRoaming();
    if (rs) {
      jobs.push(new Promise(function (resolve) {
        try {
          rs.set(DIAG_MIRROR_KEY, entries);
          if (enteredAt) rs.set(ON_SEND_ENTRY_KEY, enteredAt);
          rs.saveAsync(function () { resolve(); });
        } catch (e) { resolve(); }
      }));
    }

    if (!jobs.length) return Promise.resolve();
    return new Promise(function (resolve) {
      var done = false;
      var timer = setTimeout(function () { if (!done) { done = true; resolve(); } }, PERSIST_WAIT_MS);
      Promise.all(jobs).then(function () {
        if (!done) { done = true; clearTimeout(timer); resolve(); }
      }, function () {
        if (!done) { done = true; clearTimeout(timer); resolve(); }
      });
    });
  }

  // Module-load breadcrumb. In a browser runtime this lands in localStorage
  // immediately; in classic Outlook it is carried in memory until the handler
  // runs and persists the run (there is no storage to write to before that).
  logEvent("info", "launchevent.js module loaded", {
    localStorage: hasLocalStorage(), officeRuntimeStorage: !!officeStorage(),
  });

  // Signal to Office.js that the add-in has finished its load sequence. In
  // browser runtimes, without this Office.js stays in a partial-init state and
  // the dispatcher throws "Office.js has not fully loaded" when Outlook fires
  // messageSending. Microsoft's smart-alerts-onmessagesend sample calls
  // Office.onReady() at the top of launchevent.js for exactly this reason.
  // (Classic Outlook never runs onReady callbacks for event handlers; the
  // call is harmless there.)
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

  // ---------- Fetch helpers ----------

  // Wrap fetch with an AbortController-driven timeout. Rejects with a tagged
  // error if the request runs longer than ms — covers hung CORS preflights.
  function fetchWithTimeout(url, init, ms) {
    var ctrl = (typeof AbortController !== "undefined") ? new AbortController() : null;
    var initWithSignal = {};
    var k;
    for (k in (init || {})) if (Object.prototype.hasOwnProperty.call(init, k)) initWithSignal[k] = init[k];
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
      }
    );
  }

  // application/x-www-form-urlencoded body without URLSearchParams (not
  // guaranteed in the JavaScript-only runtime).
  function formEncode(obj) {
    var parts = [];
    var k;
    for (k in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, k) && obj[k] != null) {
        parts.push(encodeURIComponent(k) + "=" + encodeURIComponent(String(obj[k])));
      }
    }
    return parts.join("&");
  }

  function getAccessToken() {
    var tokens = getTokens();
    var cfg = getConfig();
    if (!tokens || !cfg) return Promise.reject(new Error("Not authenticated (no tokens/config in roamingSettings)"));
    if (Date.now() < tokens.expiresAt - 60000) return Promise.resolve(tokens.accessToken);

    logEvent("info", "refreshing access token");
    return fetchWithTimeout(cfg.haloBaseUrl + "/auth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: formEncode({
        grant_type: "refresh_token",
        refresh_token: tokens.refreshToken,
        client_id: cfg.clientId,
      }),
    }, TOKEN_FETCH_TIMEOUT_MS)
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

  // ---------- Pure helpers (also exported for tests, see bottom) ----------

  function domainOf(email) {
    var at = String(email || "").lastIndexOf("@");
    return at >= 0 ? String(email).slice(at + 1).toLowerCase().trim() : "";
  }

  // Email domains configured on a Halo client record, if any. Halo exposes
  // the client's domain under different names across versions/endpoints and
  // the value may hold several domains separated by , ; or whitespace. Every
  // candidate field is read; the match below is EXACT equality — never a
  // substring test (mail.com must not match gmail.com).
  var CLIENT_DOMAIN_FIELDS = ["emaildomain", "client_email_address_domain", "emaildomains", "todomain"];

  function clientDomains(client) {
    var out = [];
    if (!client) return out;
    for (var i = 0; i < CLIENT_DOMAIN_FIELDS.length; i++) {
      var raw = client[CLIENT_DOMAIN_FIELDS[i]];
      if (typeof raw !== "string" || !raw) continue;
      var parts = raw.toLowerCase().split(/[\s,;]+/);
      for (var j = 0; j < parts.length; j++) {
        var d = parts[j].replace(/^@/, "").trim();
        if (d && out.indexOf(d) < 0) out.push(d);
      }
    }
    return out;
  }

  // The ONE client whose configured domains contain `domain` exactly, or null
  // when none or several do. Never falls back to the first search result.
  function matchClientByDomain(clients, domain) {
    var d = String(domain || "").toLowerCase().trim();
    if (!d) return null;
    var found = null;
    var count = 0;
    for (var i = 0; i < (clients || []).length; i++) {
      var c = clients[i];
      if (!c || c.inactive) continue;
      if (clientDomains(c).indexOf(d) >= 0) {
        count++;
        if (count === 1) found = c;
      }
    }
    return count === 1 ? found : null;
  }

  // The ONE client_id shared by every Halo contact whose email domain is
  // exactly `domain`, or null when there are no such contacts or they belong
  // to several clients. This is the primary domain → client signal: it relies
  // only on contact email addresses, which Halo always returns.
  function clientIdFromUsers(users, domain) {
    var d = String(domain || "").toLowerCase().trim();
    if (!d) return null;
    var ids = [];
    for (var i = 0; i < (users || []).length; i++) {
      var u = users[i];
      if (!u || u.inactive || !u.emailaddress) continue;
      if (domainOf(u.emailaddress) !== d) continue;
      var cid = Number(u.client_id);
      if (!cid) continue;
      if (ids.indexOf(cid) < 0) ids.push(cid);
    }
    return ids.length === 1 ? ids[0] : null;
  }

  function exactUserByEmail(users, email) {
    var e = String(email || "").toLowerCase().trim();
    for (var i = 0; i < (users || []).length; i++) {
      var u = users[i];
      if (u && u.emailaddress && String(u.emailaddress).toLowerCase().trim() === e) return u;
    }
    return null;
  }

  function unwrapList(json, key) {
    if (Object.prototype.toString.call(json) === "[object Array]") return json;
    return (json && json[key]) || [];
  }

  // ---------- Auto-lookup ----------

  // Resolve To: recipients to a single open Halo ticket, or null when there
  // are zero or multiple matches (ambiguous — don't auto-log). Per recipient:
  // exact contact by email → that contact's open tickets; otherwise the ONE
  // client the recipient's domain belongs to (via other contacts on that
  // domain, else an exact domain configured on a client record) → that
  // client's open tickets. Anything ambiguous yields nothing: logging an
  // email to the wrong client's ticket is the failure we must never risk.
  function autoFindTicketForRecipients(toEmails) {
    if (!toEmails || toEmails.length === 0) return Promise.resolve(null);
    return getAccessToken().then(function (token) {
      var cfg = getConfig();
      var hdrs = { "Authorization": "Bearer " + token, "Accept": "application/json" };

      function getJson(url) {
        return fetchWithTimeout(url, { headers: hdrs }, AUTO_LOOKUP_FETCH_MS)
          .then(function (r) { return r.ok ? r.json() : null; });
      }
      function openTickets(qs) {
        return getJson(cfg.haloBaseUrl + "/api/Tickets?" + qs + "&open_only=true&pageinate=false&includedetails=true&domain=all")
          .then(function (json) { return unwrapList(json, "tickets"); });
      }

      // Cap at 3 recipients to stay within the time budget.
      var limited = toEmails.slice(0, 3);

      return Promise.all(limited.map(function (email) {
        var domain = domainOf(email);

        // 1. Exact contact by email.
        return getJson(cfg.haloBaseUrl + "/api/Users?search=" + encodeURIComponent(email) + "&pageinate=false")
          .then(function (json) {
            var user = exactUserByEmail(unwrapList(json, "users"), email);
            if (user && user.id) return openTickets("user_id=" + user.id);
            if (!domain) return [];

            // 2a. Client via other contacts on the same domain (exact, unique).
            return getJson(cfg.haloBaseUrl + "/api/Users?search=" + encodeURIComponent("@" + domain) + "&pageinate=false")
              .then(function (json2) {
                var cid = clientIdFromUsers(unwrapList(json2, "users"), domain);
                if (cid) return cid;
                // 2b. Client record with that exact domain configured (unique).
                return getJson(cfg.haloBaseUrl + "/api/Client?search=" + encodeURIComponent(domain) + "&pageinate=false")
                  .then(function (json3) {
                    var client = matchClientByDomain(unwrapList(json3, "clients"), domain);
                    return client ? client.id : null;
                  });
              })
              .then(function (clientId) {
                if (!clientId) {
                  logEvent("info", "auto-lookup: no unique client for domain", { domain: domain });
                  return [];
                }
                return openTickets("client_id=" + clientId);
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

  // ---------- Office.js item reads ----------

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

  // True when any recipient address is a Halo intake mailbox (then Halo's
  // native intake logs the reply itself — appending here would double-post).
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
  function extractTicketIdFromSubject(subject, snap) {
    if (!subject) return null;
    snap = snap || getControlSnapshot();
    var start = snap.email_start_tag;
    var end = snap.email_end_tag;
    if (!start || !end) return null;
    var escStart = start.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    var escEnd   = end.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    var m = new RegExp(escStart + "(\\d+)" + escEnd).exec(subject);
    return m ? Number(m[1]) : null;
  }

  // ---------- Body shaping ----------

  // Strip a known signature from an HTML body via exact substring match.
  // Falls through to the original body when sig is empty or not present
  // verbatim — false-positive stripping is worse than leaving the sig in.
  function stripSignature(html, sig) {
    if (!sig || !html) return html;
    var i = html.indexOf(sig);
    if (i === -1) return html;
    return html.slice(0, i) + html.slice(i + sig.length);
  }

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
      "<p>&nbsp;</p>"
    );
    out = out.replace(
      /(?:<div[^>]*>(?:\s|&nbsp;|<br\s*\/?>)*<\/div>\s*){2,}/gi,
      "<div>&nbsp;</div>"
    );
    out = out.replace(/(?:<br\s*\/?>\s*){3,}/gi, "<br><br>");
    return out;
  }

  // Mirrors extractTopReply in apps/outlook/src/lib/html.ts — keep in sync.
  // Returns only the topmost portion of an email body (above the first quoted-
  // reply separator). Regex only: the JavaScript-only runtime has no DOMParser.
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

  // ---------- Email envelope footer ----------
  // Mirrors apps/outlook/src/lib/envelope.ts — keep in sync. Appends a small
  // header table (direction/date, From, To, Cc, Subject) BELOW the note body
  // so Halo list previews keep showing the message text first. Inline styles
  // only; degrades to readable "Label  Value" rows if Halo strips them.
  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function formatEnvelopeDate(d) {
    try {
      var dt = d ? new Date(d) : new Date();
      if (isNaN(dt.getTime())) return "";
      return dt.toLocaleString(undefined, {
        weekday: "short", month: "short", day: "numeric", year: "numeric",
        hour: "numeric", minute: "2-digit",
      });
    } catch (e) {
      try { return new Date().toISOString(); } catch (e2) { return ""; }
    }
  }

  function formatEnvelopeAddress(name, email) {
    var n = String(name || "").trim();
    var a = String(email || "").trim();
    if (!a) return n;
    if (!n || n.toLowerCase() === a.toLowerCase()) return a;
    return n + " <" + a + ">";
  }

  // ctx: { direction, fromName, fromEmail, to: [addr], cc: [addr], subject, date }
  function envelopeRows(ctx) {
    var rows = [];
    var when = formatEnvelopeDate(ctx.date);
    rows.push(["Email", when ? (ctx.direction + " · " + when) : ctx.direction]);
    var from = formatEnvelopeAddress(ctx.fromName, ctx.fromEmail);
    if (from) rows.push(["From", from]);
    var to = (ctx.to || []).filter(Boolean).join("; ");
    if (to) rows.push(["To", to]);
    var cc = (ctx.cc || []).filter(Boolean).join("; ");
    if (cc) rows.push(["Cc", cc]);
    if (ctx.subject) rows.push(["Subject", ctx.subject]);
    return rows;
  }

  var ENVELOPE_LABEL_STYLE =
    "padding:2px 10px 2px 0;color:#707070;font-weight:600;white-space:nowrap;vertical-align:top;";
  var ENVELOPE_VALUE_STYLE = "padding:2px 0;color:#242424;vertical-align:top;word-break:break-word;";
  var ENVELOPE_TABLE_STYLE =
    "border-collapse:collapse;font-family:Segoe UI,Helvetica,Arial,sans-serif;font-size:12px;line-height:16px;color:#242424;";
  var ENVELOPE_RULE_HTML = '<hr style="border:none;border-top:1px solid #e0e0e0;margin:12px 0 8px 0;">';
  var ENVELOPE_RULE_TEXT = "\n\n----------------------------------------\n";

  function buildEnvelopeHtml(ctx) {
    var rows = envelopeRows(ctx);
    var body = "";
    for (var i = 0; i < rows.length; i++) {
      body += '<tr><td style="' + ENVELOPE_LABEL_STYLE + '">' + escapeHtml(rows[i][0]) + "</td>" +
        '<td style="' + ENVELOPE_VALUE_STYLE + '">' + escapeHtml(rows[i][1]) + "</td></tr>";
    }
    return '<table border="0" cellpadding="0" cellspacing="0" style="' + ENVELOPE_TABLE_STYLE + '">' +
      body + "</table>";
  }

  function buildEnvelopeText(ctx) {
    var rows = envelopeRows(ctx);
    var out = [];
    for (var i = 0; i < rows.length; i++) out.push(rows[i][0] + ": " + rows[i][1]);
    return out.join("\n");
  }

  // Defensive wrappers: any failure returns the body untouched so the send
  // is never blocked by the footer.
  function appendEnvelopeHtml(bodyHtml, ctx) {
    try {
      var body = bodyHtml || "";
      var footer = ENVELOPE_RULE_HTML + buildEnvelopeHtml(ctx);
      var close = body.search(/<\/body\s*>/i);
      if (close >= 0) return body.slice(0, close) + footer + body.slice(close);
      return body + footer;
    }
    catch (e) { return bodyHtml || ""; }
  }
  function appendEnvelopeText(bodyText, ctx) {
    try { return String(bodyText || "").replace(/\s+$/, "") + ENVELOPE_RULE_TEXT + buildEnvelopeText(ctx); }
    catch (e) { return bodyText || ""; }
  }

  // On-send is always outbound: From = the sending agent, To/Cc = the draft's
  // recipient lists (bare addresses — see readRecipientsField).
  function outboundEnvelope(data, senderName, senderEmail) {
    return {
      direction: "Outbound",
      fromName: senderName,
      fromEmail: senderEmail,
      to: data.to || [],
      cc: data.cc || [],
      subject: data.subject || "",
      date: new Date(),
    };
  }

  // ---------- Halo writes ----------

  function senderIdentity() {
    var out = { email: "", name: "", mailentryid: "" };
    try {
      out.email = Office.context.mailbox.userProfile.emailAddress || "";
      out.name = Office.context.mailbox.userProfile.displayName || "";
    } catch (e) { /* fall through with blanks */ }
    try {
      // On compose, item.itemId is populated once the draft has been saved
      // server-side; Outlook saves before firing messageSending, so it is
      // normally available. If not, the field is omitted and Halo treats it
      // like native intake without an EntryId.
      out.mailentryid = Office.context.mailbox.item.itemId || "";
    } catch (e) { /* swallow */ }
    return out;
  }

  // The email as a Halo action body. `note`/`note_html` carry only the agent's
  // new text (above the first quoted-reply separator, signature stripped) plus
  // the envelope footer; `emailbody*` keep the full body for parity with
  // native intake. Shared by the create and append paths so both produce the
  // same action.
  function emailActionFields(data, agent, who) {
    var cleanedBody = sanitizeOutlookHtml(data.body || "");
    var topHtml = stripSignature(extractTopReply(cleanedBody), agent.signature);
    var envelope = outboundEnvelope(data, who.name, who.email);
    var noteHtml = appendEnvelopeHtml(topHtml, envelope);
    var notePlain = appendEnvelopeText(htmlToText(topHtml), envelope);
    var fields = {
      outcome_id: 0,
      // Outbound by construction (on-send fires while the agent is sending).
      _isuserupdate: false,
      // Halo's note (plaintext) + note_html (HTML) convention. Both required.
      note: notePlain,
      note_html: noteHtml,
      emailfrom: who.name || who.email,
      emailfromname: who.name,
      emailfromaddress: who.email,
      // Outbound: emailto is the recipient (the customer).
      emailto: (data.to || []).join("; "),
      emailcc: (data.cc || []).join("; "),
      // Canonical Halo subject — replaces legacy emailsubject.
      emailsubjectnew: data.subject,
      emailimportance: getItemImportance(),
      dateemailed: formatHaloDate(new Date()),
      // Action-author triplet — agent attribution on outbound (who_type=1).
      who: agent.name || "",
      who_agentid: agent.id || -1,
      who_type: 1,
      mailentryid: who.mailentryid || undefined,
      // Direction + delivered-status guard matches Halo's native intake.
      emaildirection: "O",
      email_status: 2,
      emailbody_html: cleanedBody,
      emailbody: htmlToText(cleanedBody),
      // Stamp from_address_override with the agent's actual send-from
      // address; from_mailbox_id: -2 signals "use overridden from address".
      from_address_override: who.email,
      from_mailbox_id: -2,
      // Per-agent sales mailbox setup id, resolved by the task pane and
      // stamped into the agent snapshot. Undefined → Halo tenant defaults.
      sales_mailbox_override_id: agent.salesMailboxId || undefined,
      // Time tracking from the compose timer: raw seconds (capped at 30 min
      // by the UI) → decimal hours. Omitted when 0 so empty entries don't
      // pollute Halo's time reports.
      timetaken: data.timeSeconds > 0 ? Math.max(data.timeSeconds, 60) / 3600 : undefined,
      chargerate: data.chargeRateId > 0 ? data.chargeRateId : undefined,
    };
    return { fields: fields, noteHtml: noteHtml, notePlain: notePlain };
  }

  function postJson(url, token, payload) {
    return fetchWithTimeout(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + token,
      },
      body: JSON.stringify(payload),
    }, WRITE_FETCH_TIMEOUT_MS).then(function (r) {
      if (!r.ok) {
        return r.text().then(function (t) {
          throw new Error("Halo " + r.status + ": " + t.slice(0, 200));
        });
      }
      return r.json();
    });
  }

  /**
   * Create a ticket from the compose draft, carrying the email as the ticket's
   * initial action — the same metadata native intake stamps (emaildirection
   * "O", email_status 2, emailbody_html, mailentryid…) so the result looks
   * identical to one Halo's own intake would have created. ONE write: the
   * ticket POST already produces the action, so nothing is appended afterwards
   * (appending the same note again is what logged new tickets twice).
   * Validation flags (_novalidate, _forcereassign) bypass required-custom-
   * field prompts. Returns the new ticket id.
   */
  function createTicketFromPending(pending, data) {
    return getAccessToken().then(function (token) {
      var cfg = getConfig();
      var agent = getAgentSnapshot();
      var who = senderIdentity();
      var action = emailActionFields(data, agent, who);
      var payload = {
        summary: pending.summary,
        // `details` is the ticket body; the initial action takes note/note_html.
        details: action.noteHtml,
        tickettype_id: pending.ticketTypeId,
        agent_id: agent.id || undefined,
        _novalidate: true,
        _forcereassign: true,
      };
      var k;
      for (k in action.fields) if (Object.prototype.hasOwnProperty.call(action.fields, k)) payload[k] = action.fields[k];
      logEvent("info", "POST /api/Ticket", {
        summary: pending.summary,
        ticketTypeId: pending.ticketTypeId || null,
        timeSeconds: data.timeSeconds || 0,
      });
      return postJson(cfg.haloBaseUrl + "/api/Ticket", token, [payload]).then(function (json) {
        // Halo's create response shape varies: single object, array of one,
        // or { tickets: [...] }. Pull the id from whichever form arrives.
        var entity = Object.prototype.toString.call(json) === "[object Array]" ? json[0]
          : (json && json.tickets && json.tickets[0]) ? json.tickets[0]
          : json;
        if (!entity || typeof entity.id !== "number") {
          throw new Error("Halo /Ticket created OK but response had no id");
        }
        if (entity._warning) logEvent("warn", "Halo /Ticket warning: " + truncate(String(entity._warning)));
        return entity.id;
      });
    });
  }

  function appendToHalo(ticketId, data) {
    return getAccessToken().then(function (token) {
      var cfg = getConfig();
      var agent = getAgentSnapshot();
      var who = senderIdentity();
      var action = emailActionFields(data, agent, who);
      var payload = {
        ticket_id: Number(ticketId),
        outcome: "Outgoing Email",
        hiddenfromuser: false,
        actionhide: 0,
        // Agent attribution — the cached Halo agent id when available, 0 as
        // the marker for "Halo, attribute to API caller" otherwise.
        agent_id: agent.id || 0,
      };
      var k;
      for (k in action.fields) if (Object.prototype.hasOwnProperty.call(action.fields, k)) payload[k] = action.fields[k];
      logEvent("info", "POST /api/Actions", {
        ticketId: ticketId,
        bodyLen: (data.body || "").length,
        timeSeconds: data.timeSeconds || 0,
        chargeRateId: data.chargeRateId || 0,
        toCount: (data.to || []).length,
        agentId: agent.id || 0,
      });
      return postJson(cfg.haloBaseUrl + "/api/Actions", token, [payload]).then(function (json) {
        var entity = Object.prototype.toString.call(json) === "[object Array]" ? json[0]
          : (json && json.actions && json.actions[0]) ? json.actions[0]
          : json;
        if (entity && entity._warning) logEvent("warn", "Halo /Actions warning: " + truncate(String(entity._warning)));
        return json;
      });
    });
  }

  // ---------- The handler ----------

  function onMessageSendHandler(event) {
    var enteredAt = new Date().toISOString();
    // Absolute-first tracer (browser runtimes): written before any helper is
    // touched. In classic Outlook the same timestamp is persisted with the
    // run's diagnostics instead.
    if (hasLocalStorage()) {
      try { window.localStorage.setItem(ON_SEND_ENTRY_KEY, enteredAt); } catch (e) { /* swallow */ }
    }

    var startedAt = Date.now();
    var completed = false;
    var stage = "init";
    var safety = null;
    var writing = false;

    logEvent("info", "handler entered", {
      platform: (function () { try { return Office.context.platform; } catch (e) { return null; } })(),
      agentSnapshot: !!getAgentSnapshot().id,
      controlSnapshot: !!getControlSnapshot().email_start_tag,
      intakeMailboxes: getMailboxSnapshot().length,
    });

    var finish = function (errorMessage) {
      if (completed) return;
      completed = true;
      if (safety) clearTimeout(safety);
      var opts = { allowEvent: true };
      if (errorMessage) opts.errorMessage = errorMessage;
      logEvent(errorMessage ? "error" : "info",
        errorMessage ? ("finished with error in '" + stage + "': " + errorMessage)
                     : ("finished ok in '" + stage + "'"),
        { stage: stage, durationMs: Date.now() - startedAt });
      // Persist the run's diagnostics BEFORE completing: code after
      // event.completed() isn't guaranteed to run.
      persistDiagnostics(enteredAt).then(function () {
        try { event.completed(opts); } catch (e) {}
      });
    };

    // Lookup-phase safety: nothing has been written yet, so letting the send
    // go is harmless. Replaced by the write budget once a write begins.
    var armSafety = function (ms, label) {
      if (safety) clearTimeout(safety);
      safety = setTimeout(function () {
        finish("HaloPSA log-on-send " + label + " in stage \"" + stage + "\" — email sent anyway.");
      }, ms);
    };
    var beginWrite = function () {
      if (writing) return;
      writing = true;
      armSafety(WRITE_BUDGET_MS, "took too long");
    };
    armSafety(SAFETY_MS, "hung");

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

      var clearMarkers = function () {
        stage = "clearMarker";
        logEvent("info", "stage → clearMarker");
        // Clear every staged prop so re-sending the same draft doesn't
        // double-log. Includes timer + charge rate so a fresh draft (next
        // reply from this thread) starts from zero.
        return new Promise(function (resolve) {
          cp.set(TICKET_PROP, null);
          cp.set(PENDING_CREATE_PROP, null);
          cp.set(TIMER_TIME_PROP, null);
          cp.set(CHARGE_RATE_PROP, null);
          cp.saveAsync(function () { resolve(); });
        });
      };

      if (!stagedTicketId && !pending) {
        var defaults = getDefaults();
        if (!defaults.autoLogRepliesToTickets) {
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
          if (completed) return;
          if (!result.foundId) {
            logEvent("info", "auto-lookup: no match, skipping");
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
            if (completed) return null;
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
            beginWrite();
            return appendToHalo(result.foundId, data);
          }).then(function () {
            finish();
          });
        }).catch(function (err) {
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
        if (completed) return;
        var data = {
          body: parts[0],
          subject: parts[1],
          to: parts[2],
          cc: parts[3],
          timeSeconds: timeSeconds,
          chargeRateId: chargeRateId,
        };
        // Create path: the pending payload wins over a staged ticketId (the
        // more recent intent). The ticket POST carries the email as the
        // initial action — nothing is appended afterwards.
        if (pending) {
          stage = "createTicket";
          logEvent("info", "stage → createTicket", { summary: pending.summary });
          beginWrite();
          return createTicketFromPending(pending, data).then(function (newId) {
            logEvent("info", "ticket created", { ticketId: newId });
          });
        }
        stage = "appendToHalo";
        logEvent("info", "stage → appendToHalo");
        beginWrite();
        return appendToHalo(stagedTicketId, data);
      }).then(function () {
        if (completed) return;
        return clearMarkers().then(function () { finish(); });
      });
    }).catch(function (err) {
      var msg = err && err.message ? err.message : String(err);
      finish("HaloPSA log-on-send failed in \"" + stage + "\": " + msg + ". Email sent anyway.");
    });
  }

  // Register at module load — NOT inside Office.onReady. Microsoft's reference
  // implementations (smart-alerts-walkthrough sample) call associate at top
  // level so the handler is wired before Outlook dispatches the event, and in
  // classic Outlook onReady callbacks never run for event handlers at all.
  //
  // Also expose the handler at global scope: some builds fall back to a
  // global lookup by name. The IIFE hides the function from that path; this
  // re-exposes it without giving up the closure for our helpers.
  if (typeof window !== "undefined") {
    window.onMessageSendHandler = onMessageSendHandler;
  } else if (typeof globalThis !== "undefined") {
    try { globalThis.onMessageSendHandler = onMessageSendHandler; } catch (e) {}
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

  // Pure helpers for unit tests (Node). Never reached in Outlook.
  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      domainOf: domainOf, clientDomains: clientDomains, matchClientByDomain: matchClientByDomain,
      clientIdFromUsers: clientIdFromUsers, exactUserByEmail: exactUserByEmail,
      extractTicketIdFromSubject: extractTicketIdFromSubject, extractTopReply: extractTopReply,
      formEncode: formEncode, trimEntries: trimEntries, htmlToText: htmlToText,
    };
  }
})();
