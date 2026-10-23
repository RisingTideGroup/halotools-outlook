// Cross-runtime diagnostic log.
//
// Every runtime of this add-in appends entries; the task pane's Settings →
// Diagnostics panel shows them. Where an entry lives depends on the runtime
// that wrote it:
//   - task pane / compose (browser runtimes): window.localStorage, shared by
//     every browser runtime at the same origin, synchronous, visible live.
//   - the on-send handler (public/launchevent.js): in Outlook on the web and
//     new Outlook it is a browser runtime too and writes localStorage. In
//     CLASSIC Outlook on Windows it is a JavaScript-only runtime with NO
//     localStorage, so it persists its run to OfficeRuntime.storage (where the
//     runtime has it) and to a bounded mirror in Office.context.roamingSettings
//     (`halo.diagLogOnSend.v1`) before completing the send event.
// getEvents() merges localStorage with the roamingSettings mirror; the
// async getEventsAsync() additionally reads OfficeRuntime.storage. Note that
// a task pane loads roamingSettings once at start, so a mirror written by a
// later send shows up after the pane is reopened (OfficeRuntime.storage, when
// readable from the pane, shows it live).
//
// launchevent.js has a parallel ES5 implementation — they MUST agree on the
// storage keys and entry shape.

import {
  getCachedClientCache,
  getConfig,
  setRequestTracer,
  storage,
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
export const DIAG_MIRROR_KEY = "halo.diagLogOnSend.v1";
export const ON_SEND_ENTRY_KEY = "halo.onSendEntry.v1";
const MAX_ENTRIES = 200;
const MAX_MESSAGE_LEN = 500;
// localStorage has a 5 MB cap per origin — we're nowhere near that, but the
// log isn't worth scaling without bound. Cap at ~64 KB.
const MAX_BYTES = 64_000;

function asEntries(raw: unknown): LogEntry[] {
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  return Array.isArray(raw) ? (raw as LogEntry[]).filter((e) => e && typeof e.ts === "string") : [];
}

function readLocal(): LogEntry[] {
  try {
    return asEntries(window.localStorage.getItem(DIAG_LOG_KEY));
  } catch {
    return [];
  }
}

/** The on-send runtime's roamingSettings mirror (classic Outlook path). */
function readMirror(): LogEntry[] {
  try {
    return asEntries(storage().get(DIAG_MIRROR_KEY));
  } catch {
    return [];
  }
}

type OfficeRuntimeStorageLike = {
  getItem(key: string): Promise<string | null>;
  getItems(keys: string[]): Promise<Record<string, string | null>>;
};

function officeStorage(): OfficeRuntimeStorageLike | undefined {
  try {
    const g = globalThis as unknown as { OfficeRuntime?: { storage?: OfficeRuntimeStorageLike } };
    const s = g.OfficeRuntime?.storage;
    return s && typeof s.getItems === "function" ? s : undefined;
  } catch {
    return undefined;
  }
}

async function readOfficeStorage(): Promise<{ entries: LogEntry[]; enteredAt?: string }> {
  const s = officeStorage();
  if (!s) return { entries: [] };
  try {
    const items = await Promise.race([
      s.getItems([DIAG_LOG_KEY, ON_SEND_ENTRY_KEY]),
      new Promise<Record<string, string | null>>((resolve) => setTimeout(() => resolve({}), 800)),
    ]);
    return { entries: asEntries(items[DIAG_LOG_KEY]), enteredAt: items[ON_SEND_ENTRY_KEY] ?? undefined };
  } catch {
    return { entries: [] };
  }
}

function merge(...lists: LogEntry[][]): LogEntry[] {
  const seen = new Set<string>();
  const out: LogEntry[] = [];
  for (const list of lists) {
    for (const e of list) {
      const k = `${e.ts}|${e.source}|${e.message}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(e);
    }
  }
  out.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
  return out.length > MAX_ENTRIES ? out.slice(-MAX_ENTRIES) : out;
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
    write(trim([...readLocal(), entry]));
  } catch {
    // Logging must never throw into caller logic.
  }
}

/** Synchronous view: this runtime's localStorage log + the on-send mirror. */
export function getEvents(): LogEntry[] {
  return merge(readLocal(), readMirror());
}

/** Everything getEvents() sees plus OfficeRuntime.storage (classic Outlook
 *  on-send runs), when the host lets this runtime read it. */
export async function getEventsAsync(): Promise<LogEntry[]> {
  const office = await readOfficeStorage();
  return merge(readLocal(), readMirror(), office.entries);
}

/** When the on-send handler last started (ISO), from whichever store it
 *  could reach: localStorage (browser runtimes), roamingSettings or
 *  OfficeRuntime.storage (classic Outlook). */
export async function getOnSendLastEntered(): Promise<string | undefined> {
  const candidates: string[] = [];
  try {
    const v = window.localStorage.getItem(ON_SEND_ENTRY_KEY);
    if (v) candidates.push(v);
  } catch {
    /* ignore */
  }
  try {
    const v = storage().get<string>(ON_SEND_ENTRY_KEY);
    if (typeof v === "string" && v) candidates.push(v);
  } catch {
    /* ignore */
  }
  const office = await readOfficeStorage();
  if (office.enteredAt) candidates.push(office.enteredAt);
  if (!candidates.length) return undefined;
  return candidates.sort()[candidates.length - 1];
}

export function clearEvents(): void {
  try {
    window.localStorage.removeItem(DIAG_LOG_KEY);
  } catch {
    /* swallow */
  }
  try {
    void storage().remove(DIAG_MIRROR_KEY).catch(() => undefined);
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
    const sets = ["1.8", "1.10", "1.13", "1.14", "1.15"].filter((v) => {
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
export function buildDiagnosticsReport(events: LogEntry[] = getEvents()): string {
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
    ...events
      .slice(-80)
      .map((e) => `  ${e.ts} [${e.level}] [${e.source}] ${e.message}${e.data?.error ? ` — ${String(e.data.error)}` : ""}`),
  ];
  return lines.join("\n");
}

/** Trigger a browser download of the current log as JSON. */
export function downloadEvents(events: LogEntry[] = getEvents()): void {
  const blob = new Blob([JSON.stringify(events, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `halo-outlook-diagnostics-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
