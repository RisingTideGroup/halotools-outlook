import { useEffect, useState } from "react";
import {
  Button,
  makeStyles,
  tokens,
  Text,
  Field,
  Input,
  Combobox,
  Option,
  Switch,
  Divider,
  Spinner,
} from "@fluentui/react-components";
import { ArrowLeft24Regular } from "@fluentui/react-icons";
import { getConfig } from "@iusehalo/halo-api";
import { getDefaults, setDefaults } from "../lib/defaults";
import {
  listTicketTypes,
  ticketTypesForAgentCreate,
  clearReferenceCache,
} from "@iusehalo/halo-api";
import type { HaloTicketType } from "@iusehalo/halo-api";
import { MANIFEST_VERSION } from "../setup/version";
import {
  getEvents,
  clearEvents,
  downloadEvents,
  type LogEntry,
} from "../lib/diagnostics";
import { buildMcpUrl } from "../lib/mcp-url";

const useStyles = makeStyles({
  root: {
    display: "flex",
    flexDirection: "column",
    height: "100%",
    overflowY: "auto",
  },
  header: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    padding: "8px 12px",
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  title: {
    fontWeight: tokens.fontWeightSemibold,
    fontSize: tokens.fontSizeBase300,
  },
  body: {
    display: "flex",
    flexDirection: "column",
    gap: "16px",
    padding: "16px",
    flex: 1,
  },
  sectionLabel: {
    fontSize: tokens.fontSizeBase200,
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground2,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
  },
  meta: {
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground3,
  },
  dangerSection: {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
  },
  diagButtons: {
    display: "flex",
    flexWrap: "wrap",
    gap: "6px",
    marginTop: "8px",
  },
  diagList: {
    display: "flex",
    flexDirection: "column",
    gap: "4px",
    maxHeight: "220px",
    overflowY: "auto",
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
    padding: "8px",
    backgroundColor: tokens.colorNeutralBackground2,
    fontFamily: "Consolas, ui-monospace, monospace",
    fontSize: "11px",
  },
  diagRow: {
    display: "grid",
    gridTemplateColumns: "auto auto 1fr",
    gap: "6px",
    alignItems: "baseline",
  },
  diagRowError: {
    color: tokens.colorPaletteRedForeground1,
  },
  diagRowWarn: {
    color: tokens.colorPaletteDarkOrangeForeground1,
  },
});

interface Props {
  onClose: () => void;
  onSignOut: () => void;
  onReconfigure: () => void;
}

export function SettingsScreen({ onClose, onSignOut, onReconfigure }: Props) {
  const styles = useStyles();
  const cfg = getConfig();
  const initialDefaults = getDefaults();
  const [ticketTypes, setTicketTypes] = useState<HaloTicketType[]>([]);
  const [defaultTypeId, setDefaultTypeId] = useState<number | undefined>(
    initialDefaults.defaultTicketTypeId,
  );
  const [defaultOutcome, setDefaultOutcome] = useState<string>(
    initialDefaults.defaultAppendOutcome ?? "Email Received",
  );
  const [includeAttach, setIncludeAttach] = useState<boolean>(
    initialDefaults.includeAttachmentsByDefault ?? true,
  );
  const [autoLogReplies, setAutoLogReplies] = useState<boolean>(
    initialDefaults.autoLogRepliesToTickets ?? false,
  );
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [events, setEvents] = useState<LogEntry[]>(() => getEvents());
  const [copyStatus, setCopyStatus] = useState<string | undefined>();
  const [mcpCopyStatus, setMcpCopyStatus] = useState<string | undefined>();
  const mcpUrl =
    cfg?.haloBaseUrl && cfg?.clientId
      ? buildMcpUrl(cfg.haloBaseUrl, cfg.clientId)
      : undefined;

  useEffect(() => {
    listTicketTypes()
      .then((all) => setTicketTypes(ticketTypesForAgentCreate(all)))
      .catch(() => {
        /* non-fatal — picker just stays empty */
      })
      .finally(() => setLoading(false));
  }, []);

  // Poll the diagnostic log every second so entries written by other runtimes
  // (notably the launch-event handler firing on Send) appear live without the
  // user having to click Refresh. Cheap — read is a JSON.parse off a small
  // localStorage key.
  useEffect(() => {
    const tick = () => {
      const next = getEvents();
      setEvents((prev) =>
        prev.length === next.length && prev[prev.length - 1]?.ts === next[next.length - 1]?.ts
          ? prev
          : next,
      );
    };
    const handle = window.setInterval(tick, 1000);
    return () => window.clearInterval(handle);
  }, []);

  const refreshEvents = () => setEvents(getEvents());
  const handleCopyEvents = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(events, null, 2));
      setCopyStatus("Copied to clipboard");
    } catch {
      setCopyStatus("Copy failed — use Download instead");
    }
    setTimeout(() => setCopyStatus(undefined), 2500);
  };
  const handleClearEvents = () => {
    clearEvents();
    setEvents([]);
  };
  const handleCopyMcpUrl = async () => {
    if (!mcpUrl) return;
    try {
      await navigator.clipboard.writeText(mcpUrl);
      setMcpCopyStatus("Copied");
    } catch {
      setMcpCopyStatus("Copy failed — select and copy manually");
    }
    setTimeout(() => setMcpCopyStatus(undefined), 2500);
  };

  const save = async () => {
    setSaving(true);
    try {
      await setDefaults({
        defaultTicketTypeId: defaultTypeId,
        defaultAppendOutcome: defaultOutcome,
        includeAttachmentsByDefault: includeAttach,
        autoLogRepliesToTickets: autoLogReplies,
      });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <Button
          appearance="subtle"
          size="small"
          icon={<ArrowLeft24Regular />}
          onClick={onClose}
          aria-label="Back"
        />
        <Text className={styles.title}>Settings</Text>
      </div>

      <div className={styles.body}>
        <div>
          <Text className={styles.sectionLabel}>Connection</Text>
          <Text block className={styles.meta}>
            {cfg?.haloBaseUrl}
          </Text>
          <Text block className={styles.meta}>
            Client ID: {cfg?.clientId}
          </Text>
        </div>

        <Divider />

        <Text className={styles.sectionLabel}>Defaults</Text>

        <Field label="Default ticket type for Create">
          {loading ? (
            <Spinner size="extra-tiny" />
          ) : (
            <Combobox
              placeholder="No default"
              value={ticketTypes.find((t) => t.id === defaultTypeId)?.name ?? ""}
              onOptionSelect={(_, d) =>
                setDefaultTypeId(d.optionValue ? Number(d.optionValue) : undefined)
              }
            >
              <Option value="" text="No default">
                — No default —
              </Option>
              {ticketTypes.map((t) => (
                <Option key={t.id} value={String(t.id)} text={t.name}>
                  {t.name}
                </Option>
              ))}
            </Combobox>
          )}
        </Field>

        <Field
          label="Default action outcome for Append"
          hint="The HaloPSA Action outcome name applied when appending. Must exist in your Halo config."
        >
          <Combobox
            value={defaultOutcome}
            placeholder="Email Received"
            onOptionSelect={(_, d) => setDefaultOutcome(d.optionText ?? "Email Received")}
            freeform
          >
            <Option value="Email Received">Email Received</Option>
            <Option value="Note">Note</Option>
            <Option value="Internal Note">Internal Note</Option>
          </Combobox>
        </Field>

        <Switch
          checked={includeAttach}
          onChange={(_, d) => setIncludeAttach(d.checked)}
          label="Include attachments by default when logging"
        />

        <Switch
          checked={autoLogReplies}
          onChange={(_, d) => setAutoLogReplies(d.checked)}
          label="Auto-stage replies to Halo tickets on send"
        />
        <Text className={styles.meta}>
          When enabled, the compose pane looks up open tickets for your recipients and
          automatically stages the email for logging. If exactly one ticket is found it
          is pre-selected; if multiple are found you'll be prompted to pick.
        </Text>

        <Divider />

        <Button
          appearance="primary"
          onClick={save}
          disabled={saving}
          icon={saving ? <Spinner size="tiny" /> : undefined}
        >
          {saving ? "Saving…" : "Save"}
        </Button>

        <Button
          appearance="subtle"
          onClick={() => {
            clearReferenceCache();
            listTicketTypes(true)
              .then((all) => setTicketTypes(ticketTypesForAgentCreate(all)))
              .catch(() => {});
          }}
        >
          Refresh reference data
        </Button>

        <Divider />

        <div>
          <Text className={styles.sectionLabel}>AI assistants (MCP)</Text>
          <Text block className={styles.meta}>
            Expose your HaloPSA to Claude, ChatGPT, Cursor and any other Model
            Context Protocol client. Paste this URL into the MCP server settings
            of the assistant — sign-in goes through your Halo login. Requires{" "}
            <strong>https://tools.iusehalo.com/auth/callback</strong> on your
            Halo Connect app's redirect URIs.
          </Text>
          {mcpUrl ? (
            <>
              <Field label="MCP server URL" style={{ marginTop: 8 }}>
                <Input value={mcpUrl} readOnly onFocus={(e) => e.currentTarget.select()} />
              </Field>
              <div className={styles.diagButtons}>
                <Button appearance="primary" size="small" onClick={handleCopyMcpUrl}>
                  Copy URL
                </Button>
                {mcpCopyStatus && (
                  <Text className={styles.meta}>{mcpCopyStatus}</Text>
                )}
              </div>
            </>
          ) : (
            <Text block className={styles.meta}>
              Configure your Halo connection first to generate your MCP URL.
            </Text>
          )}
        </div>

        <Divider />

        <div>
          <Text className={styles.sectionLabel}>Diagnostics</Text>
          <Text block className={styles.meta}>
            Recent events written by every runtime (task pane, compose, on-send).
            Useful when something fails in a runtime whose console isn't reachable
            from devtools. {events.length} entries captured.
          </Text>
          {/* Raw on-send entry tracer. Written by launchevent.js directly via
              localStorage.setItem as the FIRST statement of the handler, before
              any closure-captured helper is touched. If this shows a timestamp
              but the diagnostic log doesn't have a "handler entered" entry, the
              shared logEvent path is broken in the on-send runtime context. If
              it shows "—" after a send attempt, the handler genuinely never
              ran — narrowing the issue to Office.js dispatch, not our code. */}
          <Text block className={styles.meta} style={{ marginTop: 4 }}>
            On-send handler last entered:{" "}
            <code>
              {(() => {
                try {
                  const ts = window.localStorage.getItem("halo.onSendEntry.v1");
                  return ts ? new Date(ts).toLocaleTimeString() : "—";
                } catch {
                  return "—";
                }
              })()}
            </code>
          </Text>
          {events.length > 0 && (
            <div className={styles.diagList}>
              {events.slice(-25).reverse().map((e, i) => (
                <div
                  key={`${e.ts}-${i}`}
                  className={`${styles.diagRow} ${
                    e.level === "error"
                      ? styles.diagRowError
                      : e.level === "warn"
                        ? styles.diagRowWarn
                        : ""
                  }`}
                  title={e.data ? JSON.stringify(e.data) : e.ts}
                >
                  <span>{new Date(e.ts).toLocaleTimeString()}</span>
                  <span>[{e.source}]</span>
                  <span style={{ wordBreak: "break-word" }}>{e.message}</span>
                </div>
              ))}
            </div>
          )}
          <div className={styles.diagButtons}>
            <Button appearance="subtle" size="small" onClick={refreshEvents}>
              Refresh
            </Button>
            <Button
              appearance="subtle"
              size="small"
              onClick={handleCopyEvents}
              disabled={events.length === 0}
            >
              Copy
            </Button>
            <Button
              appearance="subtle"
              size="small"
              onClick={downloadEvents}
              disabled={events.length === 0}
            >
              Download
            </Button>
            <Button
              appearance="subtle"
              size="small"
              onClick={handleClearEvents}
              disabled={events.length === 0}
            >
              Clear
            </Button>
          </div>
          {copyStatus && (
            <Text block className={styles.meta}>
              {copyStatus}
            </Text>
          )}
        </div>

        <Divider />

        <div className={styles.dangerSection}>
          <Text className={styles.sectionLabel}>Account</Text>
          <Button appearance="secondary" onClick={onSignOut}>
            Sign out
          </Button>
          <Button appearance="secondary" onClick={onReconfigure}>
            Switch HaloPSA tenant
          </Button>
        </div>

        <Divider />

        <Text block className={styles.meta}>
          HaloPSA for Outlook · manifest v{MANIFEST_VERSION}
          {(() => {
            try {
              const mv = new URLSearchParams(window.location.search).get("mv");
              return mv && mv.split(".").slice(0, 3).join(".") !== MANIFEST_VERSION
                ? ` (installed: ${mv})`
                : null;
            } catch {
              return null;
            }
          })()}
          {" · tools.iusehalo.com"}
        </Text>
      </div>
    </div>
  );
}
