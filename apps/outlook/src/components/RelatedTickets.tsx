import { useEffect, useMemo, useState, type KeyboardEvent, type MouseEvent } from "react";
import {
  Text,
  makeStyles,
  mergeClasses,
  tokens,
  Badge,
  Button,
  ToggleButton,
  Switch,
  Spinner,
  Menu,
  MenuTrigger,
  MenuList,
  MenuItem,
  MenuPopover,
  MenuButton,
} from "@fluentui/react-components";
import {
  Open16Regular,
  MoreVertical16Regular,
  ChevronDown12Regular,
  ChevronUp12Regular,
  ChevronRight16Regular,
  Calendar12Regular,
  Flag16Regular,
} from "@fluentui/react-icons";
import type { HaloTicket, HaloTicketType, TicketKind } from "@iusehalo/halo-api";
import { classifyTicket, listTicketTypes } from "@iusehalo/halo-api";
import { setDiagContext } from "../lib/diagnostics";
import {
  TicketPillStrip,
  useTicketLookups,
  useTicketMutations,
  openTicketInHalo,
  formatDue,
  resolveAgentName,
  type TicketLookups,
  type BusyField,
} from "./TicketList";

/**
 * "Related tickets" section: thread-matched tickets plus the client's open
 * tickets (reactive / sales / project tasks), filterable by kind and by
 * "mine only", with expandable rows that reveal the editable pill strip.
 */

const useStyles = makeStyles({
  root: {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
  },
  headerRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "8px",
  },
  label: {
    fontSize: tokens.fontSizeBase200,
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground2,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
  },
  switchLabel: {
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground2,
    paddingRight: "2px",
  },
  countRow: {
    display: "flex",
    gap: "6px",
    flexWrap: "wrap",
  },
  countPill: {
    minWidth: "unset",
    height: "24px",
    paddingLeft: "10px",
    paddingRight: "10px",
    fontSize: tokens.fontSizeBase200,
  },
  group: {
    display: "flex",
    flexDirection: "column",
    gap: "4px",
  },
  groupLabel: {
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground3,
    paddingTop: "4px",
  },
  empty: {
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground3,
    fontStyle: "italic",
  },
  loadingRow: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
  },
  card: {
    display: "flex",
    flexDirection: "column",
    gap: "4px",
    padding: "8px 10px",
    borderRadius: tokens.borderRadiusMedium,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground1,
    cursor: "pointer",
    transition: "background-color 80ms, border-color 80ms",
    ":hover": {
      backgroundColor: tokens.colorNeutralBackground1Hover,
      border: `1px solid ${tokens.colorNeutralStroke1}`,
    },
  },
  cardHighlighted: {
    border: `1px solid ${tokens.colorBrandStroke2}`,
    backgroundColor: tokens.colorBrandBackground2,
    ":hover": {
      backgroundColor: tokens.colorBrandBackground2Hover,
      border: `1px solid ${tokens.colorBrandStroke2}`,
    },
  },
  topRow: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    minWidth: 0,
  },
  typeBadge: {
    flexShrink: 0,
  },
  title: {
    flex: 1,
    minWidth: 0,
    fontSize: tokens.fontSizeBase200,
    fontWeight: tokens.fontWeightSemibold,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    cursor: "pointer",
    borderRadius: tokens.borderRadiusSmall,
    ":hover": { textDecoration: "underline" },
    ":focus-visible": {
      outline: `2px solid ${tokens.colorStrokeFocus2}`,
      outlineOffset: "1px",
    },
  },
  rowMenu: {
    flexShrink: 0,
    marginRight: "-6px",
  },
  metaRow: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    fontSize: tokens.fontSizeBase200,
    lineHeight: tokens.lineHeightBase200,
    color: tokens.colorNeutralForeground3,
    minWidth: 0,
    flexWrap: "wrap",
  },
  metaText: {
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  metaDot: {
    color: tokens.colorNeutralForeground4,
  },
  statusDot: {
    display: "inline-block",
    width: "8px",
    height: "8px",
    borderRadius: "50%",
    flexShrink: 0,
  },
  inlineFlag: {
    display: "inline-flex",
    alignItems: "center",
    gap: "2px",
    whiteSpace: "nowrap",
  },
  dueOverdue: {
    color: tokens.colorPaletteRedForeground1,
    fontWeight: tokens.fontWeightSemibold,
  },
  dueToday: {
    color: tokens.colorPaletteDarkOrangeForeground1,
    fontWeight: tokens.fontWeightSemibold,
  },
  expandButton: {
    marginLeft: "auto",
    minWidth: "unset",
    height: "16px",
    paddingLeft: "2px",
    paddingRight: "2px",
    color: tokens.colorNeutralForeground3,
  },
  expanded: {
    cursor: "default",
    paddingTop: "2px",
  },
  errorText: {
    fontSize: tokens.fontSizeBase100,
    color: tokens.colorPaletteRedForeground1,
  },
  projectsToggle: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    padding: "8px 10px",
    borderRadius: tokens.borderRadiusMedium,
    border: `1px dashed ${tokens.colorNeutralStroke1}`,
    backgroundColor: tokens.colorNeutralBackground2,
    cursor: "pointer",
    width: "100%",
    textAlign: "left",
    fontFamily: "inherit",
    ":hover": {
      backgroundColor: tokens.colorNeutralBackground2Hover,
    },
  },
  projectsToggleText: {
    flex: 1,
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
  },
  projectsToggleTitle: {
    fontSize: tokens.fontSizeBase200,
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground1,
  },
  projectsToggleSub: {
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground3,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
});

/** Above this many project tasks the Projects group starts collapsed. */
const PROJECT_COLLAPSE_THRESHOLD = 5;

/** Session memory of which scopes (clients) have their project tasks expanded.
 *  Module-level so it survives Dashboard refresh ticks / remounts. */
const expandedProjectScopes = new Set<string>();

type KindFilter = "all" | TicketKind;

interface Props {
  /** Tickets matched to the open email via Message-ID / subject tag. */
  threadTickets: HaloTicket[];
  /** Open tickets (all domains) for the active client. */
  openTickets: HaloTicket[];
  /** Ids Halo returned under domain=opportunities — authoritative Sales set,
   *  independent of the ticket-type list. */
  opportunityIds?: ReadonlySet<number>;
  /** Whether openTickets is still being fetched. */
  loading?: boolean;
  /** Key used to remember the Projects expand state per client for the session. */
  scopeKey?: string | number;
  onTicketUpdated?: (updated: HaloTicket) => void;
}

export function RelatedTickets({
  threadTickets,
  openTickets,
  opportunityIds,
  loading = false,
  scopeKey,
  onTicketUpdated,
}: Props) {
  const styles = useStyles();
  const lookups = useTicketLookups();
  const { busy, errors, apply, logTime } = useTicketMutations(onTicketUpdated);

  const [ticketTypes, setTicketTypes] = useState<HaloTicketType[]>([]);
  useEffect(() => {
    listTicketTypes()
      .then((t) => {
        setTicketTypes(t);
        setDiagContext("ticketTypes", {
          count: t.length,
          opps: t.filter((x) => /^opp/i.test(x.use ?? "")).map((x) => x.id),
          projects: t.filter((x) => /^proj/i.test(x.use ?? "")).map((x) => x.id),
        });
      })
      .catch((e) => setDiagContext("ticketTypes", { error: String(e) }));
  }, []);

  const [mineOnly, setMineOnly] = useState(false);
  const [kindFilter, setKindFilter] = useState<KindFilter>("all");

  // Per-row expansion. Thread-matched rows start expanded; re-applied whenever
  // the set of thread ids changes (new email / refresh), never on every render.
  const [expandedIds, setExpandedIds] = useState<Set<number>>(() => new Set());
  const threadKey = threadTickets.map((t) => t.id).join(",");
  useEffect(() => {
    if (!threadKey) return;
    setExpandedIds((prev) => {
      const next = new Set(prev);
      for (const t of threadTickets) next.add(t.id);
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadKey]);
  const toggleExpanded = (id: number) =>
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // Projects group expand/collapse, remembered per scope for the session.
  const scope = String(scopeKey ?? "");
  const [projectsExpanded, setProjectsExpandedState] = useState(
    () => expandedProjectScopes.has(scope),
  );
  useEffect(() => {
    setProjectsExpandedState(expandedProjectScopes.has(scope));
  }, [scope]);
  const setProjectsExpanded = (v: boolean) => {
    if (v) expandedProjectScopes.add(scope);
    else expandedProjectScopes.delete(scope);
    setProjectsExpandedState(v);
  };

  // ---- Derived lists ----
  const threadIds = useMemo(() => new Set(threadTickets.map((t) => t.id)), [threadKey]);

  const allTickets = useMemo(
    () => [...threadTickets, ...openTickets.filter((t) => !threadIds.has(t.id))],
    [threadTickets, openTickets, threadIds],
  );

  const kinds = useMemo(() => {
    const m = new Map<number, TicketKind>();
    for (const t of allTickets) m.set(t.id, classifyTicket(t, ticketTypes, opportunityIds));
    return m;
  }, [allTickets, ticketTypes, opportunityIds]);

  const currentAgentId = lookups.currentAgent?.id;
  const visible = useMemo(() => {
    if (!mineOnly || currentAgentId == null) return allTickets;
    return allTickets.filter((t) => assignedAgentId(t) === currentAgentId);
  }, [allTickets, mineOnly, currentAgentId]);

  const counts = useMemo(() => {
    const c: Record<KindFilter, number> = { all: visible.length, reactive: 0, sale: 0, project: 0 };
    for (const t of visible) c[kinds.get(t.id) ?? "reactive"]++;
    return c;
  }, [visible, kinds]);
  useEffect(() => {
    setDiagContext("relatedTickets", {
      total: allTickets.length,
      visible: visible.length,
      mineOnly,
      counts,
      kinds: Object.fromEntries(Array.from(kinds.entries()).slice(0, 50)),
    });
  }, [allTickets.length, visible.length, mineOnly, counts, kinds]);

  // If the active filter no longer has any tickets (e.g. "Mine only" toggled),
  // fall back to All rather than showing an empty list under a hidden pill —
  // and reset the state too, so the old filter doesn't silently come back the
  // moment a matching ticket reappears.
  const effectiveFilter: KindFilter = counts[kindFilter] > 0 ? kindFilter : "all";
  useEffect(() => {
    if (kindFilter !== "all" && counts[kindFilter] === 0) setKindFilter("all");
  }, [counts, kindFilter]);

  const filtered = useMemo(
    () =>
      effectiveFilter === "all"
        ? visible
        : visible.filter((t) => kinds.get(t.id) === effectiveFilter),
    [visible, effectiveFilter, kinds],
  );

  const groups = useMemo(() => {
    const conversation: HaloTicket[] = [];
    const reactive: HaloTicket[] = [];
    const sale: HaloTicket[] = [];
    const project: HaloTicket[] = [];
    for (const t of filtered) {
      if (threadIds.has(t.id)) conversation.push(t);
      else if (kinds.get(t.id) === "sale") sale.push(t);
      else if (kinds.get(t.id) === "project") project.push(t);
      else reactive.push(t);
    }
    const byActivity = (a: HaloTicket, b: HaloTicket) => activityTs(b) - activityTs(a);
    conversation.sort(byActivity);
    reactive.sort(byActivity);
    sale.sort(byActivity);
    project.sort(byActivity);
    return { conversation, reactive, sale, project };
  }, [filtered, threadIds, kinds]);

  // Project tasks in "This conversation" are never collapsed (they live in that
  // group). Only the standalone Projects group collapses, and only past the threshold.
  const projectsCollapsible = groups.project.length > PROJECT_COLLAPSE_THRESHOLD;
  const showProjectRows = !projectsCollapsible || projectsExpanded;
  const projectBreakdown = useMemo(
    () => describeTypeBreakdown(groups.project, ticketTypes),
    [groups.project, ticketTypes],
  );

  const renderRow = (t: HaloTicket, highlighted: boolean) => (
    <TicketRow
      key={t.id}
      ticket={t}
      kind={kinds.get(t.id) ?? "reactive"}
      highlighted={highlighted}
      expanded={expandedIds.has(t.id)}
      onToggle={() => toggleExpanded(t.id)}
      lookups={lookups}
      busy={busy[t.id]}
      error={errors[t.id]}
      onApply={(field, partial) => apply(t, field, partial)}
      onLogTime={(min, note) => logTime(t, min, note)}
    />
  );

  const pills: Array<{ key: KindFilter; label: string }> = [
    { key: "all", label: "All" },
    { key: "reactive", label: "Reactive" },
    { key: "sale", label: "Sales" },
    { key: "project", label: "Projects" },
  ];

  const nothingAtAll = !loading && allTickets.length === 0;

  return (
    <div className={styles.root}>
      <div className={styles.headerRow}>
        <Text className={styles.label}>Related tickets</Text>
        <Switch
          label={{ children: "Mine only", className: styles.switchLabel }}
          labelPosition="before"
          checked={mineOnly}
          disabled={currentAgentId == null}
          onChange={(_, d) => setMineOnly(d.checked)}
        />
      </div>

      {!nothingAtAll && (
        <div className={styles.countRow}>
          {pills
            .filter((p) => counts[p.key] > 0)
            .map((p) => (
              <ToggleButton
                key={p.key}
                size="small"
                shape="circular"
                className={styles.countPill}
                appearance={effectiveFilter === p.key ? "primary" : "outline"}
                checked={effectiveFilter === p.key}
                onClick={() => setKindFilter(p.key)}
              >
                {p.label} · {counts[p.key]}
              </ToggleButton>
            ))}
        </div>
      )}

      {nothingAtAll && <Text className={styles.empty}>No open tickets.</Text>}

      {!nothingAtAll && visible.length === 0 && !loading && (
        <Text className={styles.empty}>No tickets assigned to you.</Text>
      )}

      {groups.conversation.length > 0 && (
        <div className={styles.group}>
          <Text className={styles.groupLabel}>This conversation</Text>
          {groups.conversation.map((t) => renderRow(t, true))}
        </div>
      )}

      {groups.reactive.length > 0 && (
        <div className={styles.group}>
          <Text className={styles.groupLabel}>Reactive</Text>
          {groups.reactive.map((t) => renderRow(t, false))}
        </div>
      )}

      {groups.sale.length > 0 && (
        <div className={styles.group}>
          <Text className={styles.groupLabel}>Sales</Text>
          {groups.sale.map((t) => renderRow(t, false))}
        </div>
      )}

      {groups.project.length > 0 && (
        <div className={styles.group}>
          <Text className={styles.groupLabel}>Projects</Text>
          {projectsCollapsible && (
            <button
              type="button"
              className={styles.projectsToggle}
              aria-expanded={projectsExpanded}
              onClick={() => setProjectsExpanded(!projectsExpanded)}
            >
              {projectsExpanded ? <ChevronDown12Regular /> : <ChevronRight16Regular />}
              <span className={styles.projectsToggleText}>
                <span className={styles.projectsToggleTitle}>
                  {projectsExpanded ? "Hide" : "Show"} {groups.project.length} project{" "}
                  {groups.project.length === 1 ? "task" : "tasks"}
                </span>
                {projectBreakdown && (
                  <span className={styles.projectsToggleSub} title={projectBreakdown}>
                    {projectBreakdown}
                  </span>
                )}
              </span>
            </button>
          )}
          {showProjectRows && groups.project.map((t) => renderRow(t, false))}
        </div>
      )}

      {loading && (
        <div className={styles.loadingRow}>
          <Spinner size="extra-tiny" /> <Text size={200}>Loading tickets…</Text>
        </div>
      )}
    </div>
  );
}

// ---------- Row ----------

interface RowProps {
  ticket: HaloTicket;
  kind: TicketKind;
  highlighted: boolean;
  expanded: boolean;
  onToggle: () => void;
  lookups: TicketLookups;
  busy?: BusyField;
  error?: string;
  onApply: (field: BusyField, partial: Partial<HaloTicket>) => void;
  onLogTime: (minutes: number, note: string) => Promise<void>;
}

function TicketRow({
  ticket,
  kind,
  highlighted,
  expanded,
  onToggle,
  lookups,
  busy,
  error,
  onApply,
  onLogTime,
}: RowProps) {
  const styles = useStyles();
  const { statuses, priorities, agents } = lookups;

  const status = statuses.find((s) => s.id === ticket.status_id);
  const statusName = ticket.statusname ?? status?.name ?? "Status";
  const agentName = resolveAgentName(ticket, agents) ?? "Unassigned";
  const age = formatAge(activityTs(ticket));

  const due = ticket.targetdate ? formatDue(ticket.targetdate, "absolute") : undefined;
  const showDue = !!due && due.kind !== "unset";

  const priority = showablePriority(ticket, priorities);

  const open = () => openTicketInHalo(ticket.id);
  const stop = (e: MouseEvent | KeyboardEvent) => e.stopPropagation();

  return (
    <div
      className={mergeClasses(styles.card, highlighted && styles.cardHighlighted)}
      onClick={onToggle}
    >
      <div className={styles.topRow}>
        <TypeBadge kind={kind} className={styles.typeBadge} />
        <Text
          className={styles.title}
          role="link"
          tabIndex={0}
          title={`${ticket.summary} — open in HaloPSA`}
          onClick={(e) => {
            e.stopPropagation();
            open();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.stopPropagation();
              open();
            }
          }}
        >
          #{ticket.id} · {ticket.summary}
        </Text>
        <span className={styles.rowMenu} onClick={stop} onKeyDown={stop}>
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
                <MenuItem icon={<Open16Regular />} onClick={open}>
                  Open in HaloPSA
                </MenuItem>
              </MenuList>
            </MenuPopover>
          </Menu>
        </span>
      </div>

      <div className={styles.metaRow}>
        <span
          aria-hidden
          className={styles.statusDot}
          style={{ backgroundColor: status?.colour || tokens.colorNeutralStroke1 }}
        />
        <span className={styles.metaText}>{statusName}</span>
        <span className={styles.metaDot}>·</span>
        <span className={styles.metaText}>{agentName}</span>
        {age && (
          <>
            <span className={styles.metaDot}>·</span>
            <span className={styles.metaText}>{age}</span>
          </>
        )}
        {showDue && due && (
          <span
            className={mergeClasses(
              styles.inlineFlag,
              due.kind === "overdue" && styles.dueOverdue,
              due.kind === "today" && styles.dueToday,
            )}
            title="Due date"
          >
            <Calendar12Regular />
            {due.text}
          </span>
        )}
        {priority && (
          <span
            className={styles.inlineFlag}
            style={priority.colour ? { color: priority.colour } : undefined}
            title="Priority"
          >
            <Flag16Regular fontSize={12} />
            {priority.name}
          </span>
        )}
        <Button
          appearance="transparent"
          size="small"
          className={styles.expandButton}
          icon={expanded ? <ChevronUp12Regular /> : <ChevronDown12Regular />}
          aria-expanded={expanded}
          aria-label={expanded ? "Hide ticket actions" : "Show ticket actions"}
          onClick={(e) => {
            e.stopPropagation();
            onToggle();
          }}
        />
      </div>

      {expanded ? (
        <div className={styles.expanded} onClick={stop} onKeyDown={stop}>
          <TicketPillStrip
            ticket={ticket}
            lookups={lookups}
            busy={busy}
            error={error}
            onApply={onApply}
            onLogTime={onLogTime}
          />
        </div>
      ) : (
        error && <Text className={styles.errorText}>{error}</Text>
      )}
    </div>
  );
}

function TypeBadge({ kind, className }: { kind: TicketKind; className?: string }) {
  if (kind === "sale") {
    return (
      <Badge appearance="tint" color="brand" size="small" shape="rounded" className={className}>
        Sale
      </Badge>
    );
  }
  if (kind === "project") {
    return (
      <Badge appearance="tint" color="informative" size="small" shape="rounded" className={className}>
        Project
      </Badge>
    );
  }
  return (
    <Badge appearance="outline" color="informative" size="small" shape="rounded" className={className}>
      Ticket
    </Badge>
  );
}

// ---------- helpers ----------

function assignedAgentId(t: HaloTicket): number | undefined {
  return t.agent_id ?? t.assignedagent_id ?? t.agent?.id;
}

/** Epoch ms of the ticket's most recent activity (0 when unknown). */
function activityTs(t: HaloTicket): number {
  for (const iso of [t.lastactiondate, t.last_update, t.dateoccurred, t.dateopened]) {
    if (!iso) continue;
    const ms = Date.parse(iso);
    // Halo uses 1900-01-01 as its "no date" sentinel.
    if (Number.isFinite(ms) && ms > 0) return ms;
  }
  return 0;
}

/** "2h ago" / "5d" / "2w" / "3mo" style relative age; empty when unknown. */
function formatAge(ts: number): string {
  if (!ts) return "";
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 14) return `${d}d`;
  const w = Math.floor(d / 7);
  if (w < 9) return `${w}w`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}mo`;
  return `${Math.floor(d / 365)}y`;
}

/**
 * Priority to show inline: only when set, and not the lowest (default) rung of
 * the priorities applicable to the ticket's SLA. Returns name + colour.
 */
function showablePriority(
  ticket: HaloTicket,
  priorities: TicketLookups["priorities"],
): { name: string; colour?: string } | undefined {
  const pid = ticket.priority_id;
  if (pid == null || pid === 0) return undefined;
  const applicable = priorities.filter(
    (p) => !p.slaid || !ticket.sla_id || p.slaid === ticket.sla_id,
  );
  const pool = applicable.length > 0 ? applicable : priorities;
  const current = pool.find((p) => p.priorityid === pid);
  if (pool.length > 0) {
    // Halo numbers priorities from 1 (highest) upward; the max id is the lowest rung.
    const lowest = Math.max(...pool.map((p) => p.priorityid));
    if (pid === lowest) return undefined;
  }
  const name = ticket.priorityname ?? current?.name;
  if (!name) return undefined;
  return { name, colour: current?.colour };
}

/** "51 user to-dos · 23 meeting actions · 1 project" from the project group's type names. */
function describeTypeBreakdown(tickets: HaloTicket[], types: HaloTicketType[]): string {
  if (tickets.length === 0) return "";
  const counts = new Map<string, number>();
  for (const t of tickets) {
    const name =
      (t.tickettype_id != null && types.find((tt) => tt.id === t.tickettype_id)?.name) ||
      "other";
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  const parts = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name, n]) => `${n} ${pluralize(name.toLowerCase(), n)}`);
  const shown = parts.slice(0, 3);
  if (parts.length > 3) shown.push(`+${parts.length - 3} more`);
  return shown.join(" · ");
}

function pluralize(word: string, n: number): string {
  if (n === 1) return word;
  if (/(s|x|z|ch|sh)$/.test(word)) return `${word}es`;
  if (/[^aeiou]y$/.test(word)) return `${word.slice(0, -1)}ies`;
  return `${word}s`;
}
