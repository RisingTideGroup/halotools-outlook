import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import {
  Button,
  makeStyles,
  mergeClasses,
  tokens,
  Dialog,
  DialogTrigger,
  DialogSurface,
  DialogTitle,
  DialogBody,
  DialogContent,
  DialogActions,
  Field,
  Combobox,
  Option,
  Spinner,
  MessageBar,
  MessageBarBody,
  Text,
  Switch,
  Input,
  TabList,
  Tab,
  Badge,
  Link,
} from "@fluentui/react-components";
import { Add24Regular, Attach24Regular, Search16Regular } from "@fluentui/react-icons";
import {
  appendAction,
  createTicket,
  listTicketTypes,
  listStatuses,
  listAgents,
  ticketTypesForAgentCreate,
  ticketDeepLink,
  searchTickets,
  normalizeTicketQuery,
  classifyTicket,
  stripAgentSignature,
  getCachedClientCache,
  getCachedSalesMailboxId,
} from "@iusehalo/halo-api";
import {
  getBody,
  fetchAllAttachments,
  listAttachments,
  getCurrentUserEmail,
  getItemImportance,
  formatHaloDate,
  resolveInlineCidImages,
  isEmlExportSupported,
  getMessageAsEml,
  type EmailContext,
  type FetchedAttachment,
} from "../lib/office";
import { htmlToText, sanitizeOutlookHtml, extractTopReply } from "../lib/html";
import { appendEnvelopeHtml, appendEnvelopeText, joinAddresses } from "../lib/envelope";
import type {
  HaloTicket,
  HaloUser,
  HaloClient,
  HaloTicketType,
  HaloAttachmentInline,
  HaloStatus,
  HaloAgent,
  TicketKind,
  TicketSearchOptions,
} from "@iusehalo/halo-api";
import { getDefaults, setDefaults } from "../lib/defaults";

const useStyles = makeStyles({
  root: {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
  },
  buttons: {
    display: "flex",
    gap: "8px",
  },
  buttonFull: {
    flex: 1,
  },
  successText: {
    color: tokens.colorPaletteGreenForeground1,
    fontSize: tokens.fontSizeBase200,
  },
  // ---- append picker ----
  pickerStack: {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
  },
  scopeRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "8px",
    flexWrap: "wrap",
  },
  openOnlySwitch: {
    // Tighten the Switch so it sits on one line with the scope tabs.
    "& label": { paddingLeft: "4px", fontSize: tokens.fontSizeBase200 },
  },
  listBox: {
    display: "flex",
    flexDirection: "column",
    gap: "2px",
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
    padding: "4px",
    maxHeight: "280px",
    overflowY: "auto",
    backgroundColor: tokens.colorNeutralBackground1,
  },
  groupLabel: {
    fontSize: tokens.fontSizeBase100,
    lineHeight: tokens.lineHeightBase100,
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground3,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    padding: "6px 8px 2px",
  },
  row: {
    display: "flex",
    flexDirection: "column",
    gap: "2px",
    padding: "6px 8px",
    borderRadius: tokens.borderRadiusMedium,
    cursor: "pointer",
    outline: "none",
    border: "1px solid transparent",
    ":hover": { backgroundColor: tokens.colorNeutralBackground1Hover },
    ":focus-visible": { border: `1px solid ${tokens.colorStrokeFocus2}` },
  },
  rowThread: {
    backgroundColor: tokens.colorBrandBackground2,
    ":hover": { backgroundColor: tokens.colorBrandBackground2Hover },
  },
  rowSelected: {
    backgroundColor: tokens.colorNeutralBackground1Selected,
    border: `1px solid ${tokens.colorBrandStroke1}`,
    ":hover": { backgroundColor: tokens.colorNeutralBackground1Selected },
  },
  rowTop: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    minWidth: 0,
  },
  rowTitle: {
    flex: 1,
    minWidth: 0,
    fontSize: tokens.fontSizeBase300,
    lineHeight: tokens.lineHeightBase300,
    fontWeight: tokens.fontWeightSemibold,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  rowMeta: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    fontSize: tokens.fontSizeBase200,
    lineHeight: tokens.lineHeightBase200,
    color: tokens.colorNeutralForeground3,
    minWidth: 0,
    flexWrap: "wrap",
  },
  metaEllipsis: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    maxWidth: "45%",
  },
  dot: {
    display: "inline-block",
    width: "8px",
    height: "8px",
    borderRadius: "50%",
    flexShrink: 0,
  },
  sep: {
    color: tokens.colorNeutralForeground4,
  },
  emptyRow: {
    padding: "12px 8px",
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground3,
    display: "flex",
    alignItems: "center",
    gap: "8px",
  },
  footerRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "8px",
    padding: "8px 8px 4px",
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground3,
  },
  toggles: {
    display: "flex",
    flexDirection: "column",
    gap: "2px",
    marginTop: "4px",
  },
});

interface Props {
  email: EmailContext;
  client?: HaloClient;
  contact?: HaloUser;
  /** Thread-matched tickets first, then the client's open tickets (deduped). */
  candidateTickets: HaloTicket[];
  /** When true, Append is primary and Create is secondary (use when a thread match exists). */
  preferAppend?: boolean;
  /** The single thread-matched ticket, when there is exactly one. Turns the
   * Append trigger into a one-click "Append to #id" and preselects it in the
   * dialog. Replaces the old QuickImportBanner. */
  primaryTicket?: HaloTicket;
  /** Which of `candidateTickets` were matched by Message-ID threading — shown
   * under "This conversation" in the picker. Falls back to `[primaryTicket]`. */
  threadTickets?: HaloTicket[];
}

export function LogActions({
  email,
  client,
  contact,
  candidateTickets,
  preferAppend,
  primaryTicket,
  threadTickets,
}: Props) {
  const styles = useStyles();
  const [success, setSuccess] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [warning, setWarning] = useState<string | undefined>();

  const announce = (kind: "success" | "error" | "warning", msg: string) => {
    setSuccess(undefined);
    setError(undefined);
    setWarning(undefined);
    if (kind === "success") setSuccess(msg);
    else if (kind === "error") setError(msg);
    else setWarning(msg);
    if (kind === "success") setTimeout(() => setSuccess(undefined), 5000);
  };

  const appendIsPrimary = !!primaryTicket || !!preferAppend;

  return (
    <div className={styles.root}>
      <div className={styles.buttons}>
        <AppendDialog
          email={email}
          client={client}
          contact={contact}
          tickets={candidateTickets}
          threadTickets={threadTickets}
          primaryTicket={primaryTicket}
          onResult={announce}
          triggerClass={styles.buttonFull}
          appearance={appendIsPrimary ? "primary" : "secondary"}
        />
        <CreateDialog
          email={email}
          client={client}
          contact={contact}
          onResult={announce}
          triggerClass={styles.buttonFull}
          appearance={appendIsPrimary ? "secondary" : "primary"}
          dedupWarning={appendIsPrimary}
        />
      </div>

      {success && <Text className={styles.successText}>{success}</Text>}
      {warning && (
        <MessageBar intent="warning">
          <MessageBarBody>{warning}</MessageBarBody>
        </MessageBar>
      )}
      {error && (
        <MessageBar intent="error">
          <MessageBarBody>{error}</MessageBarBody>
        </MessageBar>
      )}
    </div>
  );
}

// ---------- Append to ticket ----------

type Scope = "client" | "mine" | "all";

function AppendDialog({
  email,
  client,
  contact,
  tickets,
  threadTickets,
  primaryTicket,
  onResult,
  triggerClass,
  appearance = "secondary",
}: {
  email: EmailContext;
  client?: HaloClient;
  contact?: HaloUser;
  tickets: HaloTicket[];
  threadTickets?: HaloTicket[];
  primaryTicket?: HaloTicket;
  onResult: (kind: "success" | "error" | "warning", msg: string) => void;
  triggerClass: string;
  appearance?: "primary" | "secondary";
}) {
  const styles = useStyles();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ message: string; url?: string } | undefined>();

  // Picker state.
  const [selectedId, setSelectedId] = useState<number | undefined>();
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<Scope>(client ? "client" : "all");
  const [openOnly, setOpenOnly] = useState(true);
  const [openResults, setOpenResults] = useState<HaloTicket[]>([]);
  const [allResults, setAllResults] = useState<HaloTicket[]>([]);
  const [searching, setSearching] = useState(false);

  // Payload toggles.
  const [internalNote, setInternalNote] = useState(false);
  const [includeAttachments, setIncludeAttachments] = useState(
    getDefaults().includeAttachmentsByDefault ?? true,
  );
  const emlSupported = isEmlExportSupported();
  const [attachEml, setAttachEml] = useState(true);
  const attachmentCount = listAttachments().filter((a) => !a.isInline).length;

  // Lookups for the row meta line (status colour/name, agent name, type badge).
  const [statuses, setStatuses] = useState<HaloStatus[]>([]);
  const [agents, setAgents] = useState<HaloAgent[]>([]);
  const [ticketTypes, setTicketTypes] = useState<HaloTicketType[]>([]);
  const currentAgent = getCachedClientCache()?.agent;

  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    listStatuses().then(setStatuses).catch(() => {});
    listAgents().then(setAgents).catch(() => {});
    listTicketTypes().then(setTicketTypes).catch(() => {});
  }, [open]);

  // Fresh picker every time the dialog OPENS: default scope, preselect the
  // thread match when there is exactly one, focus the search box. Deliberately
  // keyed on `open` alone — the thread lookup can resolve after the dialog is
  // already up, and re-running this then would silently replace whatever the
  // agent has selected or typed.
  useEffect(() => {
    if (!open) return;
    setScope(client ? "client" : "all");
    setSelectedId(primaryTicket?.id);
    const handle = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Server-side search (debounced). Two scoped queries run in parallel when
  // "Open only" is on: the open set drives the list, the unfiltered set gives
  // us the "N closed tickets match" count — closed is defined as "in the
  // unfiltered set but not the open set", which is what Halo itself uses for
  // open_only rather than a status flag we'd have to guess at.
  const searchable = isSearchableQuery(query);
  useEffect(() => {
    if (!open) return;
    if (!searchable) {
      setOpenResults([]);
      setAllResults([]);
      setSearching(false);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const handle = setTimeout(() => {
      const base: TicketSearchOptions = {
        clientId: scope === "client" ? client?.id : undefined,
        agentId: scope === "mine" ? currentAgent?.id : undefined,
      };
      const all = searchTickets(query, 25, { ...base, openOnly: false });
      const openSet = openOnly
        ? searchTickets(query, 25, { ...base, openOnly: true })
        : Promise.resolve<HaloTicket[]>([]);
      Promise.all([openSet, all])
        .then(([o, a]) => {
          if (cancelled) return;
          setOpenResults(o);
          setAllResults(a);
        })
        .catch(() => {
          if (cancelled) return;
          setOpenResults([]);
          setAllResults([]);
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [open, query, searchable, scope, openOnly, client?.id, currentAgent?.id]);

  // ---- Row model ----
  const model = useMemo(() => {
    const q = normalizeTicketQuery(query).toLowerCase();
    const matches = (t: HaloTicket) =>
      !q ||
      `#${t.id} ${t.id} ${t.summary ?? ""} ${t.statusname ?? ""} ${t.client_name ?? ""}`
        .toLowerCase()
        .includes(q);
    const inScope = (t: HaloTicket) =>
      scope !== "mine" || !currentAgent || ticketAgentId(t) === currentAgent.id;

    const thread = threadTickets ?? (primaryTicket ? [primaryTicket] : []);
    const threadIds = new Set(thread.map((t) => t.id));
    const conversation = thread.filter(matches);

    const seen = new Set<number>(threadIds);
    const results: HaloTicket[] = [];
    for (const t of tickets) {
      if (seen.has(t.id) || !matches(t) || !inScope(t)) continue;
      seen.add(t.id);
      results.push(t);
    }
    const server = openOnly ? openResults : allResults;
    for (const t of server) {
      if (seen.has(t.id)) continue;
      seen.add(t.id);
      results.push(t);
    }

    // Closed matches hidden by the switch: unfiltered hits that aren't in
    // the open set and aren't already known-open candidates.
    const openIds = new Set<number>([
      ...openResults.map((t) => t.id),
      ...tickets.map((t) => t.id),
    ]);
    const closedCount = openOnly ? allResults.filter((t) => !openIds.has(t.id)).length : 0;

    return { conversation, results, closedCount };
  }, [
    query,
    scope,
    openOnly,
    tickets,
    threadTickets,
    primaryTicket,
    openResults,
    allResults,
    currentAgent,
  ]);

  const groupLabel = scope === "client" && client ? client.name : "Results";
  const showClientName = (t: HaloTicket) => scope !== "client" || t.client_id !== client?.id;

  const reset = () => {
    setSelectedId(undefined);
    setQuery("");
    setOpenOnly(true);
    setOpenResults([]);
    setAllResults([]);
    setDone(undefined);
    setInternalNote(false);
  };

  // Arrow-key navigation from the search box into the list and between rows.
  const focusRow = (from: HTMLElement | null, delta: 1 | -1) => {
    const rows = Array.from(
      listRef.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? [],
    );
    if (rows.length === 0) return;
    const idx = from ? rows.indexOf(from) : -1;
    const next = idx < 0 ? (delta > 0 ? 0 : rows.length - 1) : idx + delta;
    if (next < 0) {
      inputRef.current?.focus();
      return;
    }
    rows[Math.min(next, rows.length - 1)]?.focus();
  };

  const onInputKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    // Enter in the search box never appends — with a thread ticket preselected,
    // "type a word, hit Enter" would otherwise log the email to the wrong
    // ticket. Enter moves into the list; appending is the button, Enter on a
    // focused row, or double-click.
    if (e.key === "ArrowDown" || e.key === "Enter") {
      e.preventDefault();
      focusRow(null, 1);
    }
  };

  const onRowKeyDown = (e: KeyboardEvent<HTMLDivElement>, id: number) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setSelectedId(id);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      focusRow(e.currentTarget, 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      focusRow(e.currentTarget, -1);
    }
  };

  const submit = async (ticketIdOverride?: number) => {
    const ticketId = ticketIdOverride ?? selectedId;
    if (!ticketId) return;
    setBusy(true);
    try {
      const rawHtml = sanitizeOutlookHtml(await getBody("html"));
      const html =
        getDefaults().includeInlineImages !== false
          ? await resolveInlineCidImages(rawHtml, ticketId)
          : rawHtml;
      const { attachments, warnings } = await buildEmailAttachments({
        includeFiles: includeAttachments && attachmentCount > 0,
        attachEml: emlSupported && attachEml,
      });

      // Direction-aware outcome. Sent items get "Outgoing Email" so Halo
      // attributes them as agent-to-customer; inbox messages stay
      // "Email Received". Both are tenant-configurable; the defaults below
      // match Halo's standard outcome names.
      const isOutgoing = email.direction === "outgoing";
      const defaultOutcome = isOutgoing
        ? getDefaults().defaultOutgoingOutcome ?? "Outgoing Email"
        : getDefaults().defaultAppendOutcome ?? "Email Received";

      // Halo's native intake convention is "full thread in emailbody, only the
      // topmost new content in note". emailbody_html below keeps the unchanged
      // original body (including the quoted reply separator). The note slice
      // is everything above the first quoted-reply separator the extractor
      // can detect; for outbound mail we additionally strip the agent's
      // saved Halo signature so the note isn't sig-dominated. The envelope
      // footer (From/To/Cc/Subject) is appended AFTER the body so list
      // previews keep showing the message text first.
      let noteHtml = extractTopReply(html);
      if (isOutgoing) noteHtml = stripAgentSignature(noteHtml);
      const notePlain = htmlToText(noteHtml);
      const agent = getCachedClientCache()?.agent;
      const recipients = recipientFields(email, isOutgoing);

      const action = await appendAction({
        ticket_id: ticketId,
        outcome: defaultOutcome,
        outcome_id: 0,
        // True when the customer effectively posted this (inbound). Halo's
        // "Updated by User" automations fire off this flag.
        _isuserupdate: !isOutgoing,
        // Halo's convention: note carries plain text, note_html carries the
        // matching HTML. Both required.
        note: appendEnvelopeText(notePlain, email),
        note_html: appendEnvelopeHtml(noteHtml, email),
        hiddenfromuser: internalNote,
        // actionhide is the literal Halo column the Email tab filters on:
        // `emailto IS NOT NULL AND actionhide <> 1`. Set explicitly — Halo
        // doesn't reliably default it from hiddenfromuser.
        actionhide: internalNote ? 1 : 0,
        // RFC sender — for outgoing this is the agent, for incoming the customer.
        // Halo logs this verbatim as the From: header of the recorded action.
        emailfrom: email.senderName || email.senderEmail,
        emailfromname: email.senderName,
        emailfromaddress: email.senderEmail,
        // Canonical Halo subject field — replaces the legacy emailsubject.
        emailsubjectnew: email.subject,
        // The real To:/Cc: lists from the message (bare addresses, "; "-joined,
        // matching native intake). Falls back to the Outlook user (inbound) or
        // the customer (outbound) only when the host gave us no recipients.
        emailto: recipients.emailto,
        emailcc: recipients.emailcc,
        // Importance class read from the message; falls back to "normal" on
        // hosts without the Mailbox 1.10 property.
        emailimportance: getItemImportance(),
        // ISO datetime without trailing Z. Inbound = received time;
        // outbound = sent time. email.receivedAt covers both (Outlook's
        // dateTimeCreated semantically maps to both depending on folder).
        dateemailed: formatHaloDate(email.receivedAt),
        attachments: attachments.length ? attachments : undefined,
        // user_id is always the customer regardless of direction so the
        // action is linked to the right person in Halo. The Dashboard's
        // contact resolution already uses customerEmail, so `contact` here
        // is the customer for both sent and received mail.
        user_id: contact?.id,
        actionby_user_id: contact?.id,
        // Agent attribution on outbound mail. For inbound we leave agent_id
        // unset so Halo treats it as customer-originated.
        agent_id: isOutgoing ? agent?.id : undefined,
        // Action-author display triplet. Inbound: the sender's name with
        // who_type=2 (user) and who_agentid=-1 (not an agent). Outbound:
        // the agent's name with who_type=1 (agent) and the agent's id.
        who: isOutgoing
          ? (agent?.name ?? "")
          : (email.senderName || email.senderEmail),
        who_agentid: isOutgoing ? (agent?.id ?? -1) : -1,
        who_type: isOutgoing ? 1 : 2,
        internetmessageid: email.internetMessageId,
        inreplyto: email.inReplyTo,
        references: email.references.length ? email.references.join(" ") : undefined,
        // EWS ItemId from Office.js — matches Halo's native email-intake field.
        mailentryid: email.itemId,
        // Direction + delivered-status guard. email_status: 2 stops Halo from
        // queuing this for actual send — we're recording an email that already
        // happened.
        emaildirection: isOutgoing ? "O" : "I",
        email_status: 2,
        // Full original body (both formats) so the action has the same
        // emailbody/emailbody_html parity as Halo's native intake records.
        emailbody_html: html,
        emailbody: htmlToText(html),
        // For outbound mail: stamp from_address_override so Halo records
        // the agent's actual From address. from_mailbox_id: -2 signals
        // "overridden from address" — matches the sales mailbox flow.
        // sales_mailbox_override_id is resolved at app load via
        // /api/SalesMailbox; undefined when the agent has no sales mailbox
        // configured (Halo falls back to tenant defaults).
        from_address_override: isOutgoing ? email.senderEmail : undefined,
        from_mailbox_id: isOutgoing ? -2 : undefined,
        sales_mailbox_override_id: isOutgoing ? getCachedSalesMailboxId() : undefined,
      });

      if (warnings.length) {
        onResult("warning", `Appended to #${action.ticket_id}, but: ${warnings.join(" ")}`);
        setOpen(false);
        reset();
      } else {
        // In-dialog success so the user sees confirmation without scrolling.
        // Include a deep-link straight to the action just created.
        setDone({
          message: `Appended to #${action.ticket_id}`,
          url: ticketDeepLink(action.ticket_id, action.id),
        });
        onResult("success", `Appended to #${action.ticket_id}`);
        setTimeout(() => {
          setOpen(false);
          reset();
        }, 1800);
      }
    } catch (e) {
      onResult("error", (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const renderRow = (t: HaloTicket, inThread: boolean) => {
    const status = statuses.find((s) => s.id === t.status_id);
    const kind = classifyTicket(t, ticketTypes);
    const agentName = ticketAgentName(t, agents);
    const age = relativeAge(firstRealDate(t.lastactiondate, t.last_update, t.dateoccurred));
    const selected = t.id === selectedId;
    return (
      <div
        key={t.id}
        role="option"
        aria-selected={selected}
        tabIndex={0}
        title={t.summary}
        className={mergeClasses(
          styles.row,
          inThread && styles.rowThread,
          selected && styles.rowSelected,
        )}
        onClick={() => setSelectedId(t.id)}
        onDoubleClick={() => {
          setSelectedId(t.id);
          if (!busy && !done) void submit(t.id);
        }}
        onKeyDown={(e) => onRowKeyDown(e, t.id)}
      >
        <div className={styles.rowTop}>
          <KindBadge kind={kind} />
          <span className={styles.rowTitle}>
            #{t.id} {t.summary}
          </span>
        </div>
        <div className={styles.rowMeta}>
          {showClientName(t) && t.client_name && (
            <>
              <span className={styles.metaEllipsis}>{t.client_name}</span>
              <span className={styles.sep}>·</span>
            </>
          )}
          <span
            aria-hidden
            className={styles.dot}
            style={{ backgroundColor: status?.colour || tokens.colorNeutralStroke1 }}
          />
          <span className={styles.metaEllipsis}>
            {status?.name ?? t.statusname ?? "Unknown status"}
          </span>
          <span className={styles.sep}>·</span>
          <span className={styles.metaEllipsis}>{agentName ?? "Unassigned"}</span>
          {age && (
            <>
              <span className={styles.sep}>·</span>
              <span>{age}</span>
            </>
          )}
        </div>
      </div>
    );
  };

  const nothingToShow = model.conversation.length === 0 && model.results.length === 0;

  return (
    <Dialog
      open={open}
      onOpenChange={(_, d) => {
        setOpen(d.open);
        if (!d.open) reset();
      }}
    >
      <DialogTrigger disableButtonEnhancement>
        <Button appearance={appearance} icon={<Attach24Regular />} className={triggerClass}>
          {primaryTicket ? `Append to #${primaryTicket.id}` : "Append"}
        </Button>
      </DialogTrigger>
      <DialogSurface>
        <DialogBody>
          <DialogTitle>Append email to ticket</DialogTitle>
          <DialogContent>
            <div className={styles.pickerStack}>
              <Input
                ref={inputRef}
                contentBefore={<Search16Regular />}
                placeholder="Search tickets… or a ticket #"
                value={query}
                onChange={(_, d) => setQuery(d.value)}
                onKeyDown={onInputKeyDown}
                aria-label="Search tickets"
                autoComplete="off"
              />

              <div className={styles.scopeRow}>
                <TabList
                  size="small"
                  selectedValue={scope}
                  onTabSelect={(_, d) => setScope(d.value as Scope)}
                  aria-label="Search scope"
                >
                  {client && <Tab value="client">This client</Tab>}
                  {currentAgent && <Tab value="mine">Mine</Tab>}
                  <Tab value="all">All</Tab>
                </TabList>
                <Switch
                  className={styles.openOnlySwitch}
                  checked={openOnly}
                  onChange={(_, d) => setOpenOnly(d.checked)}
                  label="Open only"
                />
              </div>

              <div
                ref={listRef}
                role="listbox"
                aria-label="Matching tickets"
                className={styles.listBox}
              >
                {model.conversation.length > 0 && (
                  <>
                    <div className={styles.groupLabel}>This conversation</div>
                    {model.conversation.map((t) => renderRow(t, true))}
                  </>
                )}
                {model.results.length > 0 && (
                  <>
                    <div className={styles.groupLabel}>{groupLabel}</div>
                    {model.results.map((t) => renderRow(t, false))}
                  </>
                )}
                {nothingToShow && (
                  <div className={styles.emptyRow}>
                    {searching ? (
                      <>
                        <Spinner size="tiny" /> Searching…
                      </>
                    ) : searchable ? (
                      "No tickets match"
                    ) : (
                      "Type to search tickets, or enter a ticket #"
                    )}
                  </div>
                )}
                {model.closedCount > 0 && (
                  <div className={styles.footerRow}>
                    <span>
                      {model.closedCount} closed ticket{model.closedCount === 1 ? "" : "s"} match
                    </span>
                    <Link as="button" onClick={() => setOpenOnly(false)}>
                      Show closed
                    </Link>
                  </div>
                )}
              </div>
            </div>

            <div className={styles.toggles}>
              <Switch
                checked={internalNote}
                onChange={(_, d) => setInternalNote(d.checked)}
                label="Private note (hidden from customer)"
              />
              <Switch
                checked={includeAttachments}
                onChange={(_, d) => setIncludeAttachments(d.checked)}
                disabled={attachmentCount === 0}
                label={
                  attachmentCount === 0
                    ? "No attachments"
                    : `Include ${attachmentCount} attachment${attachmentCount === 1 ? "" : "s"}`
                }
              />
              {emlSupported && (
                <Switch
                  checked={attachEml}
                  onChange={(_, d) => setAttachEml(d.checked)}
                  label="Attach original email (.eml)"
                />
              )}
            </div>

            {done && (
              <MessageBar intent="success" style={{ marginTop: 12 }}>
                <MessageBarBody>
                  {done.message}
                  {done.url && (
                    <>
                      {" — "}
                      <a href={done.url} target="_blank" rel="noopener noreferrer">
                        Open in Halo
                      </a>
                    </>
                  )}
                </MessageBarBody>
              </MessageBar>
            )}
          </DialogContent>
          <DialogActions>
            <Button appearance="secondary" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button
              appearance="primary"
              onClick={() => void submit()}
              disabled={!selectedId || busy || !!done}
              icon={busy ? <Spinner size="tiny" /> : undefined}
            >
              {busy
                ? "Appending…"
                : done
                  ? "Done"
                  : selectedId
                    ? `Append to #${selectedId}`
                    : "Append"}
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}

function KindBadge({ kind }: { kind: TicketKind }) {
  if (kind === "sale") {
    return (
      <Badge appearance="tint" color="brand" size="small" shape="rounded">
        Sale
      </Badge>
    );
  }
  if (kind === "project") {
    return (
      <Badge appearance="tint" color="informative" size="small" shape="rounded">
        Project
      </Badge>
    );
  }
  return (
    <Badge appearance="outline" color="informative" size="small" shape="rounded">
      Ticket
    </Badge>
  );
}

// ---------- Create new ticket ----------

function CreateDialog({
  email,
  client,
  contact,
  onResult,
  triggerClass,
  appearance = "primary",
  dedupWarning = false,
}: {
  email: EmailContext;
  client?: HaloClient;
  contact?: HaloUser;
  onResult: (kind: "success" | "error" | "warning", msg: string) => void;
  triggerClass: string;
  appearance?: "primary" | "secondary";
  dedupWarning?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [summary, setSummary] = useState(email.subject);
  const [ticketTypes, setTicketTypes] = useState<HaloTicketType[]>([]);
  const [ticketTypeId, setTicketTypeId] = useState<number | undefined>(
    getDefaults().defaultTicketTypeId,
  );
  const [includeAttachments, setIncludeAttachments] = useState(
    getDefaults().includeAttachmentsByDefault ?? true,
  );
  const emlSupported = isEmlExportSupported();
  const [attachEml, setAttachEml] = useState(true);
  const [loadError, setLoadError] = useState<string | undefined>();
  const attachmentCount = listAttachments().filter((a) => !a.isInline).length;

  useEffect(() => {
    if (!open) return;
    setSummary(email.subject);
    listTicketTypes()
      .then((all) => {
        const types = ticketTypesForAgentCreate(all);
        setTicketTypes(types);
        if (!ticketTypeId && types.length === 1) setTicketTypeId(types[0].id);
      })
      .catch((e) => setLoadError((e as Error).message));
  }, [open, email.subject, ticketTypeId]);

  const submit = async () => {
    setBusy(true);
    try {
      // See sanitizeOutlookHtml usage in the append flow above — same reason.
      const html = sanitizeOutlookHtml(await getBody("html"));
      const { attachments, warnings } = await buildEmailAttachments({
        includeFiles: includeAttachments && attachmentCount > 0,
        attachEml: emlSupported && attachEml,
      });

      const isOutgoing = email.direction === "outgoing";
      // `details` mirrors the `note` convention from the append flow — just
      // the topmost new content, followed by the envelope footer.
      // emailbody_html below keeps the full thread.
      let topHtml = extractTopReply(html);
      if (isOutgoing) topHtml = stripAgentSignature(topHtml);
      const detailsHtml = appendEnvelopeHtml(topHtml, email);
      const detailsPlain = appendEnvelopeText(htmlToText(topHtml), email);
      const agent = getCachedClientCache()?.agent;
      const recipients = recipientFields(email, isOutgoing);
      const ticket = await createTicket({
        summary,
        details: detailsHtml,
        client_id: client?.id,
        user_id: contact?.id,
        tickettype_id: ticketTypeId,
        attachments: attachments.length ? attachments : undefined,
        emailfrom: email.senderName || email.senderEmail,
        emailfromname: email.senderName,
        emailfromaddress: email.senderEmail,
        // See append-flow comments for each new field — same semantics apply
        // to the initial action Halo creates from a ticket POST.
        emailsubjectnew: email.subject,
        emailto: recipients.emailto,
        emailcc: recipients.emailcc,
        emailimportance: getItemImportance(),
        dateemailed: formatHaloDate(email.receivedAt),
        outcome_id: 0,
        _isuserupdate: !isOutgoing,
        note_html: detailsHtml,
        // `details` is the ticket body field. We additionally send a plain
        // text mirror on the initial action via `note`.
        note: detailsPlain,
        who: isOutgoing
          ? (agent?.name ?? "")
          : (email.senderName || email.senderEmail),
        who_agentid: isOutgoing ? (agent?.id ?? -1) : -1,
        who_type: isOutgoing ? 1 : 2,
        internetmessageid: email.internetMessageId,
        inreplyto: email.inReplyTo,
        references: email.references.length ? email.references.join(" ") : undefined,
        // EWS ItemId from Office.js — matches Halo's native email-intake field
        // so the ticket's initial action carries a back-reference to the
        // source message in the user's mailbox.
        mailentryid: email.itemId,
        // Direction + delivered-status guard — see CreateActionPayload.email_status.
        emaildirection: isOutgoing ? "O" : "I",
        email_status: 2,
        emailbody_html: html,
        emailbody: htmlToText(html),
        from_address_override: isOutgoing ? email.senderEmail : undefined,
        from_mailbox_id: isOutgoing ? -2 : undefined,
        sales_mailbox_override_id: isOutgoing ? getCachedSalesMailboxId() : undefined,
        // Bypass server-side validation prompts so create-from-email succeeds
        // silently even when the chosen ticket type has required custom
        // fields the agent didn't fill in. Matches Halo's native intake.
        _novalidate: true,
        _forcereassign: true,
      });

      // Remember selected ticket type as the new default
      if (ticketTypeId) {
        await setDefaults({ ...getDefaults(), defaultTicketTypeId: ticketTypeId });
      }

      if (warnings.length) {
        onResult("warning", `Created #${ticket.id}, but: ${warnings.join(" ")}`);
      } else {
        onResult("success", `Created #${ticket.id}`);
      }
      setOpen(false);
    } catch (e) {
      onResult("error", (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(_, d) => setOpen(d.open)}>
      <DialogTrigger disableButtonEnhancement>
        <Button appearance={appearance} icon={<Add24Regular />} className={triggerClass}>
          Create
        </Button>
      </DialogTrigger>
      <DialogSurface>
        <DialogBody>
          <DialogTitle>Create ticket from email</DialogTitle>
          <DialogContent>
            {dedupWarning && (
              <MessageBar intent="warning" style={{ marginBottom: 12 }}>
                <MessageBarBody>
                  This conversation is already linked to a ticket. Consider appending instead
                  to keep the thread together.
                </MessageBarBody>
              </MessageBar>
            )}
            <Field label="Summary" required>
              <Input value={summary} onChange={(_, d) => setSummary(d.value)} />
            </Field>

            <Field label="Ticket type" hint="Saved as your default for next time">
              <Combobox
                placeholder={loadError ? "Failed to load types" : "Select…"}
                value={
                  ticketTypeId
                    ? ticketTypes.find((t) => t.id === ticketTypeId)?.name ?? ""
                    : ""
                }
                onOptionSelect={(_, d) =>
                  setTicketTypeId(d.optionValue ? Number(d.optionValue) : undefined)
                }
              >
                {ticketTypes.map((t) => (
                  <Option key={t.id} value={String(t.id)} text={t.name}>
                    {t.name}
                  </Option>
                ))}
              </Combobox>
            </Field>

            <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 2 }}>
              <Switch
                checked={includeAttachments}
                onChange={(_, d) => setIncludeAttachments(d.checked)}
                disabled={attachmentCount === 0}
                label={
                  attachmentCount === 0
                    ? "No attachments"
                    : `Include ${attachmentCount} attachment${attachmentCount === 1 ? "" : "s"}`
                }
              />
              {emlSupported && (
                <Switch
                  checked={attachEml}
                  onChange={(_, d) => setAttachEml(d.checked)}
                  label="Attach original email (.eml)"
                />
              )}
            </div>

            <Text size={200} style={{ marginTop: 12, color: tokens.colorNeutralForeground3 }}>
              Client: {client?.name ?? "—"} · Contact: {contact?.name ?? "—"}
              <br />
              Email headers stamped on the ticket's first action so future replies thread automatically.
            </Text>
          </DialogContent>
          <DialogActions>
            <Button appearance="secondary" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button
              appearance="primary"
              onClick={submit}
              disabled={!summary.trim() || busy}
              icon={busy ? <Spinner size="tiny" /> : undefined}
            >
              {busy ? "Creating…" : "Create"}
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}

// ---------- helpers ----------

/** Base64 chars ≈ bytes × 4/3; 20 MB of message is plenty and keeps the
 *  Action POST inside what Halo's API gateway accepts. */
const EML_MAX_BASE64_CHARS = 20 * 1024 * 1024;

function toHaloAttachment(f: FetchedAttachment): HaloAttachmentInline {
  return {
    filename: f.filename,
    data_base64: f.base64,
    contenttype: f.contentType,
    isimage: f.contentType.startsWith("image/"),
  };
}

/**
 * Gather the file attachments (when asked) plus the whole message as .eml
 * (when asked and the host supports it). Partial failures become warnings,
 * never errors — a missing attachment shouldn't stop the action being logged.
 */
async function buildEmailAttachments(opts: {
  includeFiles: boolean;
  attachEml: boolean;
}): Promise<{ attachments: HaloAttachmentInline[]; warnings: string[] }> {
  const attachments: HaloAttachmentInline[] = [];
  const warnings: string[] = [];
  if (opts.includeFiles) {
    const fetched = await fetchAllAttachments();
    attachments.push(...fetched.attachments.map(toHaloAttachment));
    if (fetched.errors.length > 0) {
      warnings.push(`Some attachments couldn't be included: ${fetched.errors.join("; ")}`);
    }
  }
  if (opts.attachEml) {
    const eml = await getMessageAsEml();
    if (!eml) {
      warnings.push("The original email (.eml) couldn't be exported from Outlook and was skipped.");
    } else if (eml.base64.length > EML_MAX_BASE64_CHARS) {
      warnings.push("The original email (.eml) is over 20 MB and was skipped.");
    } else {
      attachments.push({
        filename: eml.filename,
        data_base64: eml.base64,
        contenttype: "message/rfc822",
        isimage: false,
      });
    }
  }
  return { attachments, warnings };
}

/**
 * emailto / emailcc for the action: the message's real recipient lists as
 * bare "; "-joined addresses (native intake format). When the host gave us
 * no To: list, fall back to the previous behaviour — the Outlook user for
 * inbound mail, the customer for outbound.
 */
function recipientFields(
  email: EmailContext,
  isOutgoing: boolean,
): { emailto: string; emailcc: string | undefined } {
  const to = joinAddresses(email.to ?? []);
  const cc = joinAddresses(email.cc ?? []);
  const fallback = isOutgoing ? email.customerEmail : (getCurrentUserEmail() ?? "");
  return { emailto: to || fallback, emailcc: cc || undefined };
}

/** Only hit the server for 2+ characters, or any bare ticket number ("#4" / "4"). */
function isSearchableQuery(query: string): boolean {
  const q = normalizeTicketQuery(query);
  return q.length >= 2 || /^\d+$/.test(q);
}

/** Halo returns the assigned agent under several field names depending on tenant version. */
function ticketAgentId(t: HaloTicket): number | undefined {
  const id = t.agent_id ?? t.assignedagent_id ?? t.agent?.id;
  return id && id > 0 ? id : undefined;
}

function ticketAgentName(t: HaloTicket, agents: HaloAgent[]): string | undefined {
  const direct = t.agent_name || t.agentname || t.assignedagent_name || t.agent?.name;
  if (direct) return direct;
  const id = ticketAgentId(t);
  return id ? agents.find((a) => a.id === id)?.name : undefined;
}

/** Halo uses 1900-01-01 as its "no date" sentinel, which is a truthy string —
 *  so `a ?? b` never falls through. Return the first candidate that is a real date. */
function firstRealDate(...candidates: Array<string | undefined>): string | undefined {
  for (const iso of candidates) {
    if (!iso) continue;
    const d = new Date(iso);
    if (!Number.isNaN(d.getTime()) && d.getFullYear() >= 1990) return iso;
  }
  return undefined;
}

/** "3d", "6h", "2w", "4mo", "1y" — compact age from an ISO timestamp. Halo's
 *  "no date" sentinel (1900-01-01) and unparseable input give undefined. */
function relativeAge(iso: string | undefined): string | undefined {
  if (!iso) return undefined;
  const then = new Date(iso);
  if (Number.isNaN(then.getTime()) || then.getFullYear() < 1990) return undefined;
  const mins = Math.max(0, Math.floor((Date.now() - then.getTime()) / 60000));
  if (mins < 60) return mins <= 1 ? "now" : `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  if (days < 60) return `${Math.floor(days / 7)}w`;
  if (days < 365) return `${Math.floor(days / 30)}mo`;
  return `${Math.floor(days / 365)}y`;
}
