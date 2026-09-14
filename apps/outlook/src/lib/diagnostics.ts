// Cross-runtime diagnostic log.
//
// All Outlook runtimes in this add-in are served from the same origin
// (tools.iusehalo.com) so they share window.localStorage. We deliberately use
// localStorage instead of Office.context.roamingSettings here because the
// roamingSettings bag is loaded ONCE when each runtime starts and never
// auto-refreshes — meaning the task pane reads its own stale in-memory copy
// and can't see writes that the launch-event runtime made after the task pane
// opened. localStorage is synchronous, immediate, and visible across runtimes
// at the same origin.
//
// The launch-event runtime has a parallel ES5 implementation in
// public/launchevent.js — they MUST agree on the storage key and entry shape.

import {
  getCachedClientCache,
  getConfig,
  setRequestTracer,
  type RequestTrace,
} from "@iusehalo/halo-api";
import { getDefaults } from "./defaults";
import { MANIFEST_VERSION } from "../setup/version";

export type LogLevel = "info" | "warn" | "error";

export interface LogEntry {
  /** ISO timestamp the entry was recorded. */
  ts: string;
  level: LogLevel;
  /** Free-form tag identifying which surface wrote the entry (e.g. "on-send", "auth", "api"). */
  source: string;
  /** Short human-readable message. Truncated to MAX_MESSAGE_LEN before storage. */
  message: string;
  /** Optional structured payload. Kept small — entire log is bounded by MAX_BYTES. */
  data?: Record<string, unknown>;
}

export const DIAG_LOG_KEY = "halo.diagLog.v1";
const MAX_ENTRIES = 200;
const MAX_MESSAGE_LEN = 500;
// localStorage has a 5 MB cap per origin — we're nowhere near that, but the
// log isn't worth scaling without bound. Cap at ~64 KB.
const MAX_BYTES = 64_000;

function read(): LogEntry[] {
  try {
    const raw = window.localStorage.getItem(DIAG_LOG_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function write(entries: LogEntry[]): void {
  try {
    window.localStorage.setItem(DIAG_LOG_KEY, JSON.stringify(entries));
  } catch {
    /* swallow — out-of-quota or private mode */
  }
}

function trim(entries: LogEntry[]): LogEntry[] {
  let trimmed = entries.length > MAX_ENTRIES ? entries.slice(-MAX_ENTRIES) : entries;
  while (trimmed.length > 1 && JSON.stringify(trimmed).length > MAX_BYTES) {
    trimmed = trimmed.slice(1);
  }
  return trimmed;
}

export function logEvent(
  level: LogLevel,
  source: string,
  message: string,
  data?: Record<string, unknown>,
): void {
  try {
    const entry: LogEntry = {
      ts: new Date().toISOString(),
      level,
      source,
      message: message.length > MAX_MESSAGE_LEN ? message.slice(0, MAX_MESSAGE_LEN) + "…" : message,
    };
    if (data) entry.data = data;
    write(trim([...read(), entry]));
  } catch {
    // Logging must never throw into caller logic.
  }
}

export function getEvents(): LogEntry[] {
  return read();
}

export function clearEvents(): void {
  try {
    window.localStorage.removeItem(DIAG_LOG_KEY);
  } catch {
    /* swallow */
  }
}

// ---------- API request tracing + support report ----------

/** Free-form facts the surfaces record about the current state (resolved
 *  contact/client, ticket counts, type list…) so the report explains WHY the
 *  pane shows what it shows, not just which calls it made. In-memory only. */
const context: Record<string, unknown> = {};

export function setDiagContext(key: string, value: unknown): void {
  context[key] = value;
}

/**
 * Route every Halo API call through the diagnostic log when the `apiTrace`
 * flag is on (Settings → Diagnostics). The flag is read per request so
 * toggling it takes effect immediately, without a reload.
 */
export function installApiTracer(runtime: string): void {
  setRequestTracer((t: RequestTrace) => {
    if (!getDefaults().apiTrace) return;
    const failed = t.status === 0 || t.status >= 400;
    const count = t.count != null ? ` → ${t.count} record${t.count === 1 ? "" : "s"}` : "";
    logEvent(
      failed ? "error" : "info",
      `api:${runtime}`,
      `${t.method} ${t.path} · ${t.status}${count} · ${t.ms}ms`,
      { path: t.path, status: t.status, ms: t.ms, count: t.count, error: t.error },
    );
  });
}

function officeFacts(): Record<string, unknown> {
  try {
    const d = Office.context?.diagnostics;
    const req = Office.context?.requirements;
    const sets = ["1.8", "1.10", "1.13", "1.14"].filter((v) => {
      try {
        return req?.isSetSupported("Mailbox", v);
      } catch {
        return false;
      }
    });
    return {
      host: d?.host,
      platform: d?.platform,
      version: d?.version,
      mailboxSets: sets,
    };
  } catch {
    return { host: "unknown (Office.js not loaded)" };
  }
}

/** Plain-text support report: environment, tenant/agent, recorded context, recent log. */
export function buildDiagnosticsReport(): string {
  const cfg = getConfig();
  const agent = getCachedClientCache()?.agent;
  let installedMv: string | null = null;
  try {
    installedMv = new URLSearchParams(window.location.search).get("mv");
  } catch {
    /* ignore */
  }
  const lines: string[] = [
    "HaloPSA for Outlook — diagnostics",
    `generated: ${new Date().toISOString()}`,
    `build: manifest ${MANIFEST_VERSION}${installedMv ? ` (installed ${installedMv})` : ""} · ${window.location.host}`,
    `office: ${JSON.stringify(officeFacts())}`,
    `tenant: ${cfg?.haloBaseUrl ?? "not configured"}`,
    `agent: ${agent ? `${agent.id} ${agent.name ?? ""}`.trim() : "unknown"}`,
    `apiTrace: ${getDefaults().apiTrace ? "on" : "off"}`,
    "",
    "context:",
    ...Object.entries(context).map(([k, v]) => `  ${k}: ${JSON.stringify(v)}`),
    "",
    "recent log (oldest first):",
    ...read()
      .slice(-80)
      .map((e) => `  ${e.ts} [${e.level}] [${e.source}] ${e.message}${e.data?.error ? ` — ${String(e.data.error)}` : ""}`),
  ];
  return lines.join("\n");
}

/** Trigger a browser download of the current log as JSON. */
export function downloadEvents(): void {
  const blob = new Blob([JSON.stringify(read(), null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `halo-outlook-diagnostics-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
