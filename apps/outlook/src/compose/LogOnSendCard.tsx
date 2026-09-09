import { useEffect, useRef, useState, type ReactElement } from "react";
import {
  Text,
  Spinner,
  tokens,
  Input,
  Avatar,
  Badge,
  MessageBar,
  MessageBarBody,
  Combobox,
  Option,
  Skeleton,
  SkeletonItem,
  Field,
  Button,
  Dialog,
  DialogTrigger,
  DialogSurface,
  DialogBody,
  DialogTitle,
  DialogContent,
  DialogActions,
} from "@fluentui/react-components";
import {
  Search24Regular,
  Send24Regular,
  CheckmarkCircle16Filled,
  Add24Regular,
  Attach24Regular,
  Dismiss12Regular,
  ArrowClockwise16Regular,
} from "@fluentui/react-icons";
import {
  findUserByEmail,
  findClientByDomain,
  listOpenTicketsForClient,
  searchTickets,
  listTicketTypes,
  ticketTypesForAgentCreate,
  getClientCache,
  intakeMailboxAddresses,
  type HaloUser,
  type HaloClient,
  type HaloTicket,
  type HaloTicketType,
} from "@iusehalo/halo-api";
import { getRecipients, domainOf } from "../lib/office";
import { getDefaults } from "../lib/defaults";
import { useDebouncedSearch } from "../lib/use-debounced-search";
import { useComposeStyles } from "./styles";

// ---------- Log staging (Append / Create) ----------
//
// Two buttons mirroring the read-pane LogActions UI. Both stage state into
// Office.context.mailbox.item CustomProperties; the launchevent runtime reads
// the staged target on send and either appends (haloLogTicketId) or
// creates-then-appends (haloLogPendingCreate).
//
// The card also hosts the resolved-recipients list (who this email is going
// to, matched against Halo contacts / client domains) since that is the
// context the Append / Create decision is made against.

const TICKET_PROP = "haloLogTicketId";
const PENDING_CREATE_PROP = "haloLogPendingCreate";

interface PendingCreate {
  summary: string;
  ticketTypeId?: number;
}

/** Persist log props. Setting one of {ticketId, pending} clears the other
 *  so the two staging modes don't conflict on send. */
function writeLogProps(next: {
  ticketId?: number;
  pending?: PendingCreate;
  clearAll?: boolean;
}): Promise<void> {
  return new Promise((resolve) => {
    const item = Office.context.mailbox.item;
    if (!item) return resolve();
    item.loadCustomPropertiesAsync((r) => {
      if (r.status !== Office.AsyncResultStatus.Succeeded) return resolve();
      const cp = r.value;
      if (next.clearAll) {
        cp.set(TICKET_PROP, "");
        cp.set(PENDING_CREATE_PROP, "");
      } else if (next.ticketId !== undefined) {
        cp.set(TICKET_PROP, String(next.ticketId));
        cp.set(PENDING_CREATE_PROP, "");
      } else if (next.pending !== undefined) {
        cp.set(TICKET_PROP, "");
        cp.set(PENDING_CREATE_PROP, JSON.stringify(next.pending));
      }
      cp.saveAsync(() => resolve());
    });
  });
}

export function LogOnSendCard() {
  const styles = useComposeStyles();
  const [stagedTicketId, setStagedTicketId] = useState<number | undefined>();
  const [stagedTicketSummary, setStagedTicketSummary] = useState<string | undefined>();
  const [stagedCreate, setStagedCreate] = useState<PendingCreate | undefined>();
  const [rehydrated, setRehydrated] = useState(false);
  const [autoMatchedTickets, setAutoMatchedTickets] = useState<HaloTicket[]>([]);
  const [autoMatchLoading, setAutoMatchLoading] = useState(false);
  const autoMatchRan = useRef(false);
  // Bumping this triggers a recipients re-fetch (manual Refresh button).
  const [refreshToken, setRefreshToken] = useState(0);

  // Rehydrate on mount so the user sees what's currently staged on this draft.
  useEffect(() => {
    const item = Office.context.mailbox.item;
    if (!item) { setRehydrated(true); return; }
    item.loadCustomPropertiesAsync((r) => {
      if (r.status === Office.AsyncResultStatus.Succeeded) {
        const ticketRaw = r.value.get(TICKET_PROP);
        const pendingRaw = r.value.get(PENDING_CREATE_PROP);
        if (ticketRaw) {
          const id = Number(ticketRaw);
          setStagedTicketId(id);
          // searchTickets puts the exact-id match first for bare numbers.
          searchTickets(String(id), 1)
            .then((res) => setStagedTicketSummary(res[0]?.summary))
            .catch(() => { /* non-fatal */ });
        }
        if (pendingRaw) {
          try { setStagedCreate(JSON.parse(pendingRaw)); } catch { /* malformed */ }
        }
      }
      setRehydrated(true);
    });
  }, []);

  // After rehydration: if auto-log is on and nothing is already staged, look up
  // open tickets for the compose recipients. Auto-stage when exactly one is found;
  // store candidates for the Append picker when multiple are found.
  useEffect(() => {
    if (!rehydrated || autoMatchRan.current) return;
    autoMatchRan.current = true;
    if (!getDefaults().autoLogRepliesToTickets) return;

    let cancelled = false;
    setAutoMatchLoading(true);

    (async () => {
      try {
        const { to } = await getRecipients();
        if (cancelled || to.length === 0) return;

        // Skip auto-staging when a Halo intake mailbox is among the recipients:
        // Halo's native email intake will log this reply itself, so auto-staging
        // (which appends via API on send) would double-post it.
        const intake = new Set(intakeMailboxAddresses(await getClientCache()));
        if (intake.size > 0 && to.some((e) => intake.has(e.trim().toLowerCase()))) return;

        const resolved = await Promise.all(
          to.map(async (email) => {
            const [user, client] = await Promise.all([
              findUserByEmail(email).catch(() => undefined),
              findClientByDomain(domainOf(email)).catch(() => undefined),
            ]);
            return { user, client };
          }),
        );
        if (cancelled) return;

        const clientIds = new Set<number>();
        for (const r of resolved) {
          const cid = r.user?.client_id ?? r.client?.id;
          if (cid) clientIds.add(cid);
        }
        if (clientIds.size === 0) return;

        const ticketArrays = await Promise.all(
          [...clientIds].map((id) =>
            listOpenTicketsForClient(id).catch(() => [] as HaloTicket[]),
          ),
        );
        if (cancelled) return;

        const seen = new Set<number>();
        const tickets: HaloTicket[] = [];
        for (const arr of ticketArrays) {
          for (const t of arr) {
            if (!seen.has(t.id)) { seen.add(t.id); tickets.push(t); }
          }
        }
        if (tickets.length === 0) return;

        setAutoMatchedTickets(tickets);

        // Auto-stage only when exactly one ticket found and nothing already staged.
        // Read staged state directly — this effect runs after rehydration so the
        // closure captures the final rehydrated values.
        if (tickets.length === 1 && stagedTicketId === undefined && stagedCreate === undefined) {
          const t = tickets[0];
          setStagedTicketId(t.id);
          setStagedTicketSummary(t.summary);
          writeLogProps({ ticketId: t.id });
        }
      } catch {
        // Non-fatal — failures here (e.g. no recipients yet, Halo unavailable)
        // should not surface as an error to the user.
      } finally {
        if (!cancelled) setAutoMatchLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [rehydrated]);

  const onAppendStaged = (t: HaloTicket) => {
    setStagedTicketId(t.id);
    setStagedTicketSummary(t.summary);
    setStagedCreate(undefined);
    writeLogProps({ ticketId: t.id });
  };

  const onCreateStaged = (p: PendingCreate) => {
    setStagedCreate(p);
    setStagedTicketId(undefined);
    setStagedTicketSummary(undefined);
    writeLogProps({ pending: p });
  };

  const clearStaging = () => {
    setStagedTicketId(undefined);
    setStagedTicketSummary(undefined);
    setStagedCreate(undefined);
    writeLogProps({ clearAll: true });
  };

  const staged = Boolean(stagedTicketId) || Boolean(stagedCreate);

  return (
    <div className={styles.card}>
      <div className={styles.cardLabelRow}>
        <Text className={styles.cardLabel}>
          <Send24Regular style={{ width: 14, height: 14 }} />
          Log on send
        </Text>
        <Button
          appearance="subtle"
          size="small"
          icon={<ArrowClockwise16Regular />}
          onClick={() => setRefreshToken((n) => n + 1)}
          aria-label="Refresh recipients"
          title="Refresh recipients"
        />
      </div>

      {stagedTicketId && (
        <div className={styles.stagedBanner}>
          <CheckmarkCircle16Filled />
          <span className={styles.stagedBannerText}>
            Will append to #{stagedTicketId}
            {stagedTicketSummary ? ` · ${stagedTicketSummary}` : ""}
          </span>
          <Button
            appearance="subtle"
            size="small"
            icon={<Dismiss12Regular />}
            aria-label="Clear staged log"
            onClick={clearStaging}
          />
        </div>
      )}
      {stagedCreate && (
        <div className={styles.stagedBanner}>
          <CheckmarkCircle16Filled />
          <span className={styles.stagedBannerText}>
            Will create ticket: {stagedCreate.summary}
          </span>
          <Button
            appearance="subtle"
            size="small"
            icon={<Dismiss12Regular />}
            aria-label="Clear staged create"
            onClick={clearStaging}
          />
        </div>
      )}

      <div className={styles.logButtonsRow}>
        <AppendStageDialog
          onStage={onAppendStaged}
          candidates={autoMatchedTickets}
          trigger={
            staged ? (
              <Button appearance="secondary" size="small" className={styles.logButtonFull}>
                Change ticket
              </Button>
            ) : (
              <Button
                appearance="secondary"
                size="small"
                icon={<Attach24Regular />}
                className={styles.logButtonFull}
              >
                Append
              </Button>
            )
          }
        />
        <CreateStageDialog
          onStage={onCreateStaged}
          trigger={
            staged ? (
              <Button appearance="secondary" size="small" className={styles.logButtonFull}>
                Create new instead
              </Button>
            ) : (
              <Button
                appearance="primary"
                size="small"
                icon={<Add24Regular />}
                className={styles.logButtonFull}
              >
                Create
              </Button>
            )
          }
        />
      </div>
      {autoMatchLoading && (
        <Text className={styles.hint}>
          <Spinner size="extra-tiny" style={{ marginRight: 4 }} /> Looking up related tickets…
        </Text>
      )}
      {!autoMatchLoading && autoMatchedTickets.length > 1 && !stagedTicketId && !stagedCreate && (
        <Text className={styles.hint}>
          {autoMatchedTickets.length} related tickets found — click Append to pick one.
        </Text>
      )}

      <RecipientsList refreshToken={refreshToken} />
    </div>
  );
}

// ---------- Recipients ----------

interface ResolvedRecipient {
  email: string;
  user?: HaloUser;
  client?: HaloClient;
  loading: boolean;
}

const RECIPIENTS_COLLAPSED_COUNT = 2;

function RecipientsList({ refreshToken }: { refreshToken: number }) {
  const styles = useComposeStyles();
  const [recipients, setRecipients] = useState<ResolvedRecipient[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [error, setError] = useState<string | undefined>();
  const [expanded, setExpanded] = useState(false);
  // Bumped by the Office RecipientsChanged handler; the parent's refreshToken
  // covers the manual Refresh button. Either triggers a re-fetch.
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoadingList(true);
    (async () => {
      try {
        const { to } = await getRecipients();
        if (cancelled) return;
        if (to.length === 0) {
          setRecipients([]);
          setLoadingList(false);
          return;
        }
        // Seed each as still-resolving so the UI shows skeletons while Halo lookups run.
        const seeds: ResolvedRecipient[] = to.map((e) => ({ email: e, loading: true }));
        setRecipients(seeds);
        setLoadingList(false);

        // Resolve each recipient in parallel — domain lookups are cheap per address.
        await Promise.all(
          to.map(async (email, idx) => {
            try {
              const [user, client] = await Promise.all([
                findUserByEmail(email).catch(() => undefined),
                findClientByDomain(domainOf(email)).catch(() => undefined),
              ]);
              if (cancelled) return;
              setRecipients((prev) => {
                const next = [...prev];
                next[idx] = { email, user, client, loading: false };
                return next;
              });
            } catch {
              if (cancelled) return;
              setRecipients((prev) => {
                const next = [...prev];
                next[idx] = { email, loading: false };
                return next;
              });
            }
          }),
        );
      } catch (e) {
        if (!cancelled) {
          setError((e as Error).message);
          setLoadingList(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadToken, refreshToken]);

  // Subscribe to Outlook's RecipientsChanged event so the resolved-recipients
  // list stays in sync as the user adds/removes addresses in the compose
  // pane. Without this, the panel only ever reflects the recipients present
  // when the task pane first opened.
  useEffect(() => {
    const item = Office.context?.mailbox?.item;
    if (!item || typeof item.addHandlerAsync !== "function") return;
    const handler = () => setReloadToken((n) => n + 1);
    try {
      item.addHandlerAsync(
        Office.EventType.RecipientsChanged,
        handler,
        (result) => {
          if (result.status !== Office.AsyncResultStatus.Succeeded) {
            // Non-fatal — the manual Refresh button is the fallback.
          }
        },
      );
    } catch {
      /* Read-mode items don't support this event; harmless to swallow. */
    }
    return () => {
      try {
        item.removeHandlerAsync?.(Office.EventType.RecipientsChanged, () => {});
      } catch {
        /* swallow */
      }
    };
  }, []);

  const hiddenCount = Math.max(0, recipients.length - RECIPIENTS_COLLAPSED_COUNT);
  const visible = expanded ? recipients : recipients.slice(0, RECIPIENTS_COLLAPSED_COUNT);

  return (
    <div className={styles.recipientList}>
      {error && (
        <MessageBar intent="error">
          <MessageBarBody>{error}</MessageBarBody>
        </MessageBar>
      )}
      {loadingList ? (
        <Skeleton>
          <SkeletonItem size={24} />
        </Skeleton>
      ) : recipients.length === 0 ? (
        <Text className={styles.empty}>No recipients yet.</Text>
      ) : (
        <>
          {visible.map((r, i) => <RecipientRow key={`${r.email}-${i}`} recipient={r} />)}
          {hiddenCount > 0 && (
            <Button
              appearance="subtle"
              size="small"
              className={styles.moreButton}
              aria-expanded={expanded}
              onClick={() => setExpanded((v) => !v)}
            >
              {expanded ? "Show less" : `+${hiddenCount} more`}
            </Button>
          )}
        </>
      )}
    </div>
  );
}

function RecipientRow({ recipient }: { recipient: ResolvedRecipient }) {
  const styles = useComposeStyles();
  const displayName = recipient.user?.name ?? recipient.email;
  const secondary = recipient.user?.client_name ?? recipient.client?.name ?? recipient.email;

  return (
    <div className={styles.recipientRow}>
      <Avatar name={displayName} color="colorful" size={24} />
      <div className={styles.recipientText} title={`${displayName} · ${secondary}`}>
        <span className={styles.recipientName}>{displayName}</span>
        {secondary !== displayName && (
          <span className={styles.recipientSecondary}> · {secondary}</span>
        )}
      </div>
      {recipient.loading ? (
        <Spinner size="extra-tiny" />
      ) : recipient.user ? (
        <Badge appearance="filled" color="success" size="small">
          Contact
        </Badge>
      ) : recipient.client ? (
        <Badge appearance="filled" color="warning" size="small">
          Domain
        </Badge>
      ) : (
        <Badge appearance="filled" color="danger" size="small">
          No match
        </Badge>
      )}
    </div>
  );
}

// ---------- Stage dialogs ----------

function AppendStageDialog({
  onStage,
  trigger,
  candidates = [],
}: {
  onStage: (t: HaloTicket) => void;
  trigger: ReactElement;
  candidates?: HaloTicket[];
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const { results, loading } = useDebouncedSearch(query, searchTickets);

  const pick = (t: HaloTicket) => { onStage(t); setOpen(false); };
  const rowStyle = {
    padding: "6px 8px",
    cursor: "pointer",
    borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
  };
  // Show candidates when query is too short to have search results yet.
  const showCandidates = candidates.length > 0 && query.trim().length < 2;

  return (
    <Dialog open={open} onOpenChange={(_, d) => setOpen(d.open)}>
      <DialogTrigger disableButtonEnhancement>{trigger}</DialogTrigger>
      <DialogSurface>
        <DialogBody>
          <DialogTitle>Append on send to existing ticket</DialogTitle>
          <DialogContent>
            {showCandidates && (
              <div style={{ marginBottom: 12 }}>
                <Text style={{ fontSize: tokens.fontSizeBase200, color: tokens.colorNeutralForeground3, display: "block", marginBottom: 4 }}>
                  Related tickets
                </Text>
                <div style={{ maxHeight: 200, overflowY: "auto" }}>
                  {candidates.slice(0, 15).map((t) => (
                    <div key={t.id} onClick={() => pick(t)} style={rowStyle}>
                      <strong>#{t.id}</strong> · {t.summary}
                      {t.statusname ? ` · ${t.statusname}` : ""}
                    </div>
                  ))}
                </div>
              </div>
            )}
            <Field label={showCandidates ? "Or search for a different ticket" : "Find ticket"}>
              <Input
                value={query}
                placeholder="Search by ID, summary, or client…"
                onChange={(_, d) => setQuery(d.value)}
                contentBefore={<Search24Regular />}
              />
            </Field>
            {loading ? (
              <div style={{ marginTop: 8 }}>
                <Spinner size="extra-tiny" /> Searching…
              </div>
            ) : results.length > 0 ? (
              <div style={{ marginTop: 8, maxHeight: 240, overflowY: "auto" }}>
                {results.slice(0, 15).map((t) => (
                  <div key={t.id} onClick={() => pick(t)} style={rowStyle}>
                    <strong>#{t.id}</strong> · {t.summary}
                    {t.statusname ? ` · ${t.statusname}` : ""}
                  </div>
                ))}
              </div>
            ) : query.trim().length >= 2 ? (
              <Text style={{ marginTop: 8, fontStyle: "italic" }}>
                No tickets found.
              </Text>
            ) : null}
          </DialogContent>
          <DialogActions>
            <Button appearance="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}

function CreateStageDialog({
  onStage,
  trigger,
}: {
  onStage: (p: PendingCreate) => void;
  trigger: ReactElement;
}) {
  const [open, setOpen] = useState(false);
  const [summary, setSummary] = useState("");
  const [ticketTypes, setTicketTypes] = useState<HaloTicketType[]>([]);
  const [ticketTypeId, setTicketTypeId] = useState<number | undefined>();
  const [loadingTypes, setLoadingTypes] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoadingTypes(true);
    listTicketTypes()
      .then((all) => {
        const types = ticketTypesForAgentCreate(all);
        setTicketTypes(types);
        if (!ticketTypeId && types.length > 0) setTicketTypeId(types[0].id);
      })
      .catch(() => { /* type-less create still works */ })
      .finally(() => setLoadingTypes(false));
  }, [open, ticketTypeId]);

  useEffect(() => {
    if (!open) return;
    const item = Office.context.mailbox.item;
    if (!item) return;
    item.subject?.getAsync?.((r) => {
      if (r.status === Office.AsyncResultStatus.Succeeded && r.value) {
        setSummary(r.value);
      }
    });
  }, [open]);

  const stage = () => {
    if (!summary.trim()) return;
    onStage({ summary: summary.trim(), ticketTypeId });
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={(_, d) => setOpen(d.open)}>
      <DialogTrigger disableButtonEnhancement>{trigger}</DialogTrigger>
      <DialogSurface>
        <DialogBody>
          <DialogTitle>Create on send</DialogTitle>
          <DialogContent>
            <Field label="Summary">
              <Input value={summary} onChange={(_, d) => setSummary(d.value)} />
            </Field>
            <Field label="Ticket type" style={{ marginTop: 8 }}>
              <Combobox
                value={ticketTypes.find((t) => t.id === ticketTypeId)?.name ?? ""}
                onOptionSelect={(_, d) =>
                  setTicketTypeId(d.optionValue ? Number(d.optionValue) : undefined)
                }
              >
                {loadingTypes ? (
                  <Option value="">Loading…</Option>
                ) : (
                  ticketTypes.map((t) => (
                    <Option key={t.id} value={String(t.id)} text={t.name}>
                      {t.name}
                    </Option>
                  ))
                )}
              </Combobox>
            </Field>
          </DialogContent>
          <DialogActions>
            <Button appearance="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button appearance="primary" onClick={stage} disabled={!summary.trim()}>
              Stage create
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
