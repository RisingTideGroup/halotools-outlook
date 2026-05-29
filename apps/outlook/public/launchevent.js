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
  // time_taken (decimal hours) and chargerate_id on the action.
  var PENDING_CREATE_PROP = "haloLogPendingCreate";
  var TIMER_TIME_PROP = "haloComposeTimeSeconds";
  var CHARGE_RATE_PROP = "haloComposeChargeRateId";
  var DIAG_LOG_KEY = "halo.diagLog.v1";
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

  // Minimal HTML → plain text for emailbody field. Same approach as the
  // task pane's htmlToText helper but inline in ES5 for the launchevent
  // runtime.
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

      var payload = [{
        summary: pending.summary,
        details: data.body || "",
        tickettype_id: pending.ticketTypeId,
        emailfrom: senderName || senderEmail,
        emailfromname: senderName,
        emailfromaddress: senderEmail,
        emailto: (data.to || []).join("; "),
        emailcc: (data.cc || []).join("; "),
        emailsubject: data.subject,
        mailentryid: mailentryid || undefined,
        emaildirection: "O",
        email_status: 2,
        emailbody_html: data.body || "",
        emailbody: htmlToText(data.body || ""),
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
      // On-send is always outbound by construction. Strip the agent's
      // configured Halo signature from note_html so the action's short-form
      // note isn't dominated by the sig block; keep the full body in
      // emailbody_html for parity with native intake.
      var noteHtml = stripSignature(data.body || "", agent.signature);
      var payload = [{
        ticket_id: Number(ticketId),
        outcome: "Outgoing Email",
        note: noteHtml,
        emailfrom: senderName || senderEmail,
        emailfromname: senderName,
        emailfromaddress: senderEmail,
        emailto: (data.to || []).join("; "),
        emailcc: (data.cc || []).join("; "),
        emailsubject: data.subject,
        // Agent attribution — use the cached Halo agent id when available,
        // 0 as a marker for "Halo, attribute to API caller" otherwise.
        agent_id: agent.id || 0,
        mailentryid: mailentryid || undefined,
        // Direction + delivered-status guard matches Halo's native intake.
        emaildirection: "O",
        email_status: 2,
        // Full original body in both formats so the action mirrors what
        // native intake produces.
        emailbody_html: data.body || "",
        emailbody: htmlToText(data.body || ""),
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
        time_taken: data.timeSeconds > 0 ? data.timeSeconds / 3600 : undefined,
        chargerate_id: data.chargeRateId > 0 ? data.chargeRateId : undefined,
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
        clearTimeout(safety);
        finish();
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
