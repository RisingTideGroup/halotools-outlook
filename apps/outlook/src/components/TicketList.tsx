import { useEffect, useMemo, useState, type CSSProperties } from "react";
import {
  Text,
  makeStyles,
  tokens,
  Badge,
  Menu,
  MenuTrigger,
  MenuList,
  MenuItem,
  MenuPopover,
  MenuButton,
  Spinner,
  Popover,
  PopoverTrigger,
  PopoverSurface,
  Button,
  Input,
  Field,
  Textarea,
} from "@fluentui/react-components";
import {
  Open16Regular,
  MoreVertical16Regular,
  Clock16Regular,
  Person16Regular,
  Calendar16Regular,
  Flag16Regular,
  Status16Regular,
} from "@fluentui/react-icons";
import type {
  HaloTicket,
  HaloStatus,
  HaloAgent,
  HaloPriority,
} from "@iusehalo/halo-api";
import { getConfig } from "@iusehalo/halo-api";
import {
  listStatuses,
  listPriorities,
  listAgents,
  getCurrentAgent,
  updateTicket,
  appendAction,
} from "@iusehalo/halo-api";
import { getCurrentUserEmail, openExternalUrl } from "../lib/office";
import { getDefaults } from "../lib/defaults";

const useStyles = makeStyles({
  root: {
    display: "flex",
    flexDirection: "column",
    gap: "6px",
  },
  label: {
    fontSize: tokens.fontSizeBase200,
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground2,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
  },
  empty: {
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground3,
    fontStyle: "italic",
  },
  card: {
    display: "flex",
    flexDirection: "column",
    gap: "6px",
    padding: "8px 10px",
    borderRadius: tokens.borderRadiusMedium,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground1,
    transition: "background-color 80ms, border-color 80ms",
    ":hover": {
      backgroundColor: tokens.colorNeutralBackground1Hover,
      border: `1px solid ${tokens.colorNeutralStroke1}`,
    },
  },
  topRow: {
    display: "flex",
    alignItems: "flex-start",
    gap: "4px",
  },
  titleWrap: {
    flex: 1,
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    gap: "2px",
  },
  title: {
    fontSize: tokens.fontSizeBase200,
    fontWeight: tokens.fontWeightSemibold,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    cursor: "pointer",
  },
  pillsRow: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    flexWrap: "wrap",
  },
  pill: {
    cursor: "pointer",
  },
  pillSpinner: {
    display: "inline-flex",
    alignItems: "center",
    padding: "2px 6px",
  },
  popoverSurface: {
    padding: "6px",
    minWidth: "200px",
    maxWidth: "260px",
    display: "flex",
    flexDirection: "column",
    gap: "6px",
  },
  popoverList: {
    display: "flex",
    flexDirection: "column",
    maxHeight: "220px",
    overflowY: "auto",
  },
  popoverItem: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    padding: "6px 8px",
    borderRadius: tokens.borderRadiusSmall,
    cursor: "pointer",
    fontSize: tokens.fontSizeBase200,
    backgroundColor: "transparent",
    border: "none",
    textAlign: "left",
    width: "100%",
    ":hover": {
      backgroundColor: tokens.colorNeutralBackground1Hover,
    },
  },
  popoverItemActive: {
    backgroundColor: tokens.colorNeutralBackground1Selected,
  },
  popoverActions: {
    display: "flex",
    justifyContent: "flex-end",
    gap: "6px",
    paddingTop: "4px",
  },
  errorText: {
    fontSize: tokens.fontSizeBase100,
    color: tokens.colorPaletteRedForeground1,
  },
  dueOverdue: {
    color: tokens.colorPaletteRedForeground1,
  },
  dueToday: {
    color: tokens.colorPaletteDarkOrangeForeground1,
  },
});

interface Props {
  label: string;
  tickets: HaloTicket[];
  onTicketUpdated?: (updated: HaloTicket) => void;
}

type BusyField = "status" | "priority" | "agent" | "due" | "log";

export function TicketList({ label, tickets, onTicketUpdated }: Props) {
  const styles = useStyles();
  const cfg = getConfig();
  const haloUrl = cfg?.haloBaseUrl;

  const [statuses, setStatuses] = useState<HaloStatus[]>([]);
  const [priorities, setPriorities] = useState<HaloPriority[]>([]);
  const [agents, setAgents] = useState<HaloAgent[]>([]);
  const [currentAgent, setCurrentAgent] = useState<HaloAgent | undefined>();

  // Per-ticket per-field busy state and per-ticket error.
  const [busy, setBusy] = useState<Record<number, BusyField | undefined>>({});
  const [errors, setErrors] = useState<Record<number, string | undefined>>({});

  useEffect(() => {
    listStatuses().then(setStatuses).catch(() => {});
    listPriorities().then(setPriorities).catch(() => {});
    listAgents().then(setAgents).catch(() => {});
    const email = getCurrentUserEmail();
    if (email) getCurrentAgent(email).then(setCurrentAgent).catch(() => {});
  }, []);

  const openInHalo = (ticketId: number) => {
    if (!haloUrl) return;
    // Halo's deep-link path for a single ticket. Add &action_id=N to jump to a
    // specific action within the ticket.
    const url = `${haloUrl}/ticket?id=${ticketId}`;
    if (!openExternalUrl(url)) {
      // Both Outlook's API and window.open were blocked. Drop the URL in the
      // clipboard so the user can paste it manually.
      navigator.clipboard?.writeText(url).catch(() => {});
    }
  };

  const apply = async (
    ticket: HaloTicket,
    field: BusyField,
    partial: Partial<HaloTicket>,
  ) => {
    setBusy((b) => ({ ...b, [ticket.id]: field }));
    setErrors((e) => ({ ...e, [ticket.id]: undefined }));
    try {
      // Only forward fields the UpdateTicketPayload supports; name-only fields stay local.
      const updated = await updateTicket({
        id: ticket.id,
        status_id: partial.status_id,
        agent_id: partial.agent_id,
        priority_id: partial.priority_id,
        targetdate: partial.targetdate,
      });
      // Merge server response with any optimistic name fields we set locally.
      onTicketUpdated?.({ ...updated, ...partial, id: ticket.id });
    } catch (e) {
      setErrors((prev) => ({
        ...prev,
        [ticket.id]: `Update failed: ${(e as Error).message}`,
      }));
    } finally {
      setBusy((b) => ({ ...b, [ticket.id]: undefined }));
    }
  };

  const logTime = async (ticket: HaloTicket, minutes: number, note: string) => {
    setBusy((b) => ({ ...b, [ticket.id]: "log" }));
    setErrors((e) => ({ ...e, [ticket.id]: undefined }));
    try {
      await appendAction({
        ticket_id: ticket.id,
        outcome: getDefaults().defaultAppendOutcome ?? "Note",
        note,
        timetaken: minutes / 60,
      });
    } catch (e) {
      setErrors((prev) => ({
        ...prev,
        [ticket.id]: `Log time failed: ${(e as Error).message}`,
      }));
      throw e;
    } finally {
      setBusy((b) => ({ ...b, [ticket.id]: undefined }));
    }
  };

  return (
    <div className={styles.root}>
      <Text className={styles.label}>{label}</Text>
      {tickets.length === 0 ? (
        <Text className={styles.empty}>None.</Text>
      ) : (
        tickets.map((t) => (
          <TicketRow
            key={t.id}
            ticket={t}
            statuses={statuses}
            priorities={priorities}
            agents={agents}
            currentAgent={currentAgent}
            busy={busy[t.id]}
            error={errors[t.id]}
            onOpen={() => openInHalo(t.id)}
            onApply={(field, partial) => apply(t, field, partial)}
            onLogTime={(min, note) => logTime(t, min, note)}
          />
        ))
      )}
    </div>
  );
}

// ---------- Single row ----------

interface RowProps {
  ticket: HaloTicket;
  statuses: HaloStatus[];
  priorities: HaloPriority[];
  agents: HaloAgent[];
  currentAgent?: HaloAgent;
  busy?: BusyField;
  error?: string;
  onOpen: () => void;
  onApply: (field: BusyField, partial: Partial<HaloTicket>) => void;
  onLogTime: (minutes: number, note: string) => Promise<void>;
}

function TicketRow({
  ticket,
  statuses,
  priorities,
  agents,
  currentAgent,
  busy,
  error,
  onOpen,
  onApply,
  onLogTime,
}: RowProps) {
  const styles = useStyles();

  return (
    <div className={styles.card}>
      <div className={styles.topRow}>
        <div className={styles.titleWrap}>
          <Text
            className={styles.title}
            onClick={onOpen}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === "Enter" && onOpen()}
            title={ticket.summary}
          >
            #{ticket.id} · {ticket.summary}
          </Text>
        </div>
        <Menu>
          <MenuTrigger disableButtonEnhancement>
            <MenuButton
              appearance="subtle"
              size="small"
              icon={<MoreVertical16Regular />}
              aria-label="More actions"
            />
          </MenuTrigger>
          <MenuPopover>
            <MenuList>
              <MenuItem icon={<Open16Regular />} onClick={onOpen}>
                Open in HaloPSA
              </MenuItem>
            </MenuList>
          </MenuPopover>
        </Menu>
      </div>

      <div className={styles.pillsRow}>
        <StatusPill
          ticket={ticket}
          statuses={statuses}
          busy={busy === "status"}
          onPick={(s) => onApply("status", { status_id: s.id, statusname: s.name })}
        />
        <PriorityPill
          ticket={ticket}
          priorities={priorities}
          busy={busy === "priority"}
          onPick={(p) =>
            onApply("priority", { priority_id: p.priorityid, priorityname: p.name })
          }
          onClear={() => onApply("priority", { priority_id: 0, priorityname: undefined })}
        />
        <AgentPill
          ticket={ticket}
          agents={agents}
          currentAgent={currentAgent}
          busy={busy === "agent"}
          onPick={(a) =>
            onApply("agent", { agent_id: a?.id ?? 0, agent_name: a?.name })
          }
        />
        <DuePill
          ticket={ticket}
          busy={busy === "due"}
          onChange={(iso) => onApply("due", { targetdate: iso })}
          onClear={() => onApply("due", { targetdate: "" })}
        />
        <LogTimePill ticket={ticket} busy={busy === "log"} onSubmit={onLogTime} />
      </div>

      {error && <Text className={styles.errorText}>{error}</Text>}
    </div>
  );
}

// ---------- Status pill ----------

/** Inline style for the status badge using Halo's own configured hex colour. */
function statusBadgeStyle(s: HaloStatus | undefined): CSSProperties | undefined {
  if (!s?.colour) return undefined;
  return { borderColor: s.colour, color: s.colour };
}

function StatusPill({
  ticket,
  statuses,
  busy,
  onPick,
}: {
  ticket: HaloTicket;
  statuses: HaloStatus[];
  busy: boolean;
  onPick: (s: HaloStatus) => void;
}) {
  const styles = useStyles();
  const [open, setOpen] = useState(false);
  const current = statuses.find((s) => s.id === ticket.status_id);
  const label = ticket.statusname ?? current?.name ?? "Status";

  if (busy) {
    return (
      <span className={styles.pillSpinner}>
        <Spinner size="extra-tiny" />
      </span>
    );
  }

  return (
    <Popover open={open} onOpenChange={(_, d) => setOpen(d.open)} trapFocus>
      <PopoverTrigger disableButtonEnhancement>
        <Badge
          appearance="outline"
          icon={<Status16Regular />}
          size="medium"
          className={styles.pill}
          style={statusBadgeStyle(current)}
        >
          {label}
        </Badge>
      </PopoverTrigger>
      <PopoverSurface className={styles.popoverSurface}>
        <div className={styles.popoverList}>
          {statuses.map((s) => (
            <button
              key={s.id}
              className={
                s.id === ticket.status_id
                  ? `${styles.popoverItem} ${styles.popoverItemActive}`
                  : styles.popoverItem
              }
              onClick={() => {
                onPick(s);
                setOpen(false);
              }}
            >
              <span
                aria-hidden
                style={{
                  display: "inline-block",
                  width: 10,
                  height: 10,
                  borderRadius: "50%",
                  backgroundColor: s.colour ?? tokens.colorNeutralStroke1,
                }}
              />
              <span>{s.name}</span>
            </button>
          ))}
          {statuses.length === 0 && (
            <Text size={200} italic>
              No statuses loaded.
            </Text>
          )}
        </div>
      </PopoverSurface>
    </Popover>
  );
}

// ---------- Priority pill ----------

function PriorityPill({
  ticket,
  priorities,
  busy,
  onPick,
  onClear,
}: {
  ticket: HaloTicket;
  priorities: HaloPriority[];
  busy: boolean;
  onPick: (p: HaloPriority) => void;
  onClear: () => void;
}) {
  const styles = useStyles();
  const [open, setOpen] = useState(false);
  // ticket.priority_id is the numeric ID; HaloPriority.priorityid is the
  // matching numeric (HaloPriority.id is a GUID string, not comparable).
  const current = priorities.find((p) => p.priorityid === ticket.priority_id);
  const label = ticket.priorityname ?? current?.name ?? "Priority";

  // Halo priorities are defined per-SLA. The SLA scoping field is `slaid`
  // (no underscore). A priority without slaid is global and always applies.
  const applicable = priorities.filter(
    (p) => !p.slaid || !ticket.sla_id || p.slaid === ticket.sla_id,
  );

  if (busy) {
    return (
      <span className={styles.pillSpinner}>
        <Spinner size="extra-tiny" />
      </span>
    );
  }

  return (
    <Popover open={open} onOpenChange={(_, d) => setOpen(d.open)} trapFocus>
      <PopoverTrigger disableButtonEnhancement>
        <Badge
          appearance="outline"
          icon={<Flag16Regular />}
          size="medium"
          className={styles.pill}
          style={
            current?.colour
              ? { borderColor: current.colour, color: current.colour }
              : undefined
          }
        >
          {label}
        </Badge>
      </PopoverTrigger>
      <PopoverSurface className={styles.popoverSurface}>
        <div className={styles.popoverList}>
          {applicable.map((p) => (
            <button
              key={p.id}
              className={
                p.priorityid === ticket.priority_id
                  ? `${styles.popoverItem} ${styles.popoverItemActive}`
                  : styles.popoverItem
              }
              onClick={() => {
                onPick(p);
                setOpen(false);
              }}
            >
              <span
                aria-hidden
                style={{
                  display: "inline-block",
                  width: 10,
                  height: 10,
                  borderRadius: "50%",
                  backgroundColor: p.colour ?? tokens.colorNeutralStroke1,
                }}
              />
              <span>{p.name}</span>
            </button>
          ))}
          {applicable.length === 0 && (
            <Text size={200} italic>
              No priorities available for this ticket's SLA.
            </Text>
          )}
          {ticket.priority_id != null && ticket.priority_id !== 0 && (
            <button
              className={styles.popoverItem}
              onClick={() => {
                onClear();
                setOpen(false);
              }}
            >
              <span>Clear priority</span>
            </button>
          )}
        </div>
      </PopoverSurface>
    </Popover>
  );
}

// ---------- Agent pill ----------

function AgentPill({
  ticket,
  agents,
  currentAgent,
  busy,
  onPick,
}: {
  ticket: HaloTicket;
  agents: HaloAgent[];
  currentAgent?: HaloAgent;
  busy: boolean;
  onPick: (a: HaloAgent | undefined) => void;
}) {
  const styles = useStyles();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return agents.slice(0, 50);
    return agents.filter((a) => a.name.toLowerCase().includes(q)).slice(0, 50);
  }, [agents, query]);

  // Halo returns the assigned agent under several different field names depending on
  // tenant version. Resolve to whichever one is populated so an assigned ticket never
  // mis-renders as "Unassigned".
  const agentName =
    ticket.agent_name ||
    ticket.agentname ||
    ticket.assignedagent_name ||
    ticket.agent?.name ||
    (() => {
      const id =
        ticket.agent_id ?? ticket.assignedagent_id ?? ticket.agent?.id;
      if (!id) return undefined;
      return agents.find((a) => a.id === id)?.name;
    })();
  const label = agentName ?? "Unassigned";

  if (busy) {
    return (
      <span className={styles.pillSpinner}>
        <Spinner size="extra-tiny" />
      </span>
    );
  }

  return (
    <Popover open={open} onOpenChange={(_, d) => setOpen(d.open)} trapFocus>
      <PopoverTrigger disableButtonEnhancement>
        <Badge
          appearance="outline"
          icon={<Person16Regular />}
          size="medium"
          className={styles.pill}
        >
          {label}
        </Badge>
      </PopoverTrigger>
      <PopoverSurface className={styles.popoverSurface}>
        <Input
          size="small"
          placeholder="Search agents…"
          value={query}
          onChange={(_, d) => setQuery(d.value)}
        />
        <div className={styles.popoverList}>
          {currentAgent && currentAgent.id !== ticket.agent_id && !query && (
            <button
              className={styles.popoverItem}
              onClick={() => {
                onPick(currentAgent);
                setOpen(false);
              }}
            >
              <Person16Regular />
              <span>Assign to me ({currentAgent.name})</span>
            </button>
          )}
          {filtered.map((a) => (
            <button
              key={a.id}
              className={
                a.id === ticket.agent_id
                  ? `${styles.popoverItem} ${styles.popoverItemActive}`
                  : styles.popoverItem
              }
              onClick={() => {
                onPick(a);
                setOpen(false);
              }}
            >
              <span>{a.name}</span>
            </button>
          ))}
          {filtered.length === 0 && (
            <Text size={200} italic>
              No matches.
            </Text>
          )}
          {ticket.agent_id != null && ticket.agent_id !== 0 && !query && (
            <button
              className={styles.popoverItem}
              onClick={() => {
                onPick(undefined);
                setOpen(false);
              }}
            >
              <span>Unassign</span>
            </button>
          )}
        </div>
      </PopoverSurface>
    </Popover>
  );
}

// ---------- Due-date pill ----------

function formatDue(iso: string | undefined): {
  text: string;
  kind: "set" | "today" | "overdue" | "unset";
} {
  if (!iso) return { text: "Set due", kind: "unset" };
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { text: "Set due", kind: "unset" };
  const today = new Date();
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const startOfTarget = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const days = Math.round(
    (startOfTarget.getTime() - startOfToday.getTime()) / 86400000,
  );
  if (days === 0) return { text: "Today", kind: "today" };
  if (days < 0) return { text: `Overdue ${Math.abs(days)}d`, kind: "overdue" };
  if (days < 7) return { text: `${days}d`, kind: "set" };
  if (days < 31) return { text: `${Math.round(days / 7)}w`, kind: "set" };
  return {
    text: d.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
    kind: "set",
  };
}

function DuePill({
  ticket,
  busy,
  onChange,
  onClear,
}: {
  ticket: HaloTicket;
  busy: boolean;
  onChange: (iso: string) => void;
  onClear: () => void;
}) {
  const styles = useStyles();
  const [open, setOpen] = useState(false);
  const formatted = formatDue(ticket.targetdate);
  const initial = ticket.targetdate ? ticket.targetdate.slice(0, 10) : "";
  const [value, setValue] = useState(initial);

  useEffect(() => {
    setValue(initial);
  }, [initial]);

  if (busy) {
    return (
      <span className={styles.pillSpinner}>
        <Spinner size="extra-tiny" />
      </span>
    );
  }

  const dueClass =
    formatted.kind === "overdue"
      ? styles.dueOverdue
      : formatted.kind === "today"
      ? styles.dueToday
      : undefined;

  return (
    <Popover open={open} onOpenChange={(_, d) => setOpen(d.open)} trapFocus>
      <PopoverTrigger disableButtonEnhancement>
        <Badge
          appearance="outline"
          icon={<Calendar16Regular />}
          size="medium"
          className={`${styles.pill} ${dueClass ?? ""}`}
        >
          {formatted.text}
        </Badge>
      </PopoverTrigger>
      <PopoverSurface className={styles.popoverSurface}>
        {/* Fluent v9 doesn't ship a stable DatePicker; HTML date input wrapped in a Field is the documented workaround. */}
        <Field label="Due date">
          <Input
            type="date"
            value={value}
            onChange={(_, d) => setValue(d.value)}
          />
        </Field>
        <div className={styles.popoverActions}>
          {ticket.targetdate && (
            <Button
              appearance="subtle"
              size="small"
              onClick={() => {
                onClear();
                setOpen(false);
              }}
            >
              Clear
            </Button>
          )}
          <Button
            appearance="primary"
            size="small"
            disabled={!value}
            onClick={() => {
              if (value) onChange(value);
              setOpen(false);
            }}
          >
            Save
          </Button>
        </div>
      </PopoverSurface>
    </Popover>
  );
}

// ---------- Log-time pill ----------

function LogTimePill({
  ticket,
  busy,
  onSubmit,
}: {
  ticket: HaloTicket;
  busy: boolean;
  onSubmit: (minutes: number, note: string) => Promise<void>;
}) {
  const styles = useStyles();
  const [open, setOpen] = useState(false);
  const [minutes, setMinutes] = useState("");
  const [note, setNote] = useState("");
  const [success, setSuccess] = useState(false);

  if (busy) {
    return (
      <span className={styles.pillSpinner}>
        <Spinner size="extra-tiny" />
      </span>
    );
  }

  const submit = async () => {
    const min = parseFloat(minutes);
    if (!Number.isFinite(min) || min <= 0) return;
    try {
      await onSubmit(min, note.trim());
      setMinutes("");
      setNote("");
      setSuccess(true);
      setOpen(false);
      window.setTimeout(() => setSuccess(false), 2000);
    } catch {
      // Error is surfaced at the row level; keep popover open for retry.
    }
  };

  return (
    <Popover open={open} onOpenChange={(_, d) => setOpen(d.open)} trapFocus>
      <PopoverTrigger disableButtonEnhancement>
        <Button
          appearance="subtle"
          size="small"
          icon={<Clock16Regular />}
          aria-label={`Log time on ticket ${ticket.id}`}
        >
          {success ? "Logged" : "Log time"}
        </Button>
      </PopoverTrigger>
      <PopoverSurface className={styles.popoverSurface}>
        <Field label="Minutes" required>
          <Input
            type="number"
            value={minutes}
            onChange={(_, d) => setMinutes(d.value)}
            placeholder="e.g. 15"
            min={1}
          />
        </Field>
        <Field label="Note">
          <Textarea
            value={note}
            onChange={(_, d) => setNote(d.value)}
            rows={2}
            placeholder="Optional"
          />
        </Field>
        <div className={styles.popoverActions}>
          <Button appearance="subtle" size="small" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            appearance="primary"
            size="small"
            disabled={!minutes || parseFloat(minutes) <= 0}
            onClick={submit}
          >
            Log
          </Button>
        </div>
      </PopoverSurface>
    </Popover>
  );
}
