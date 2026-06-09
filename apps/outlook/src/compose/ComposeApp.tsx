import { useEffect, useState, useCallback } from "react";
import {
  Text,
  Spinner,
  makeStyles,
  tokens,
  Input,
  Avatar,
  Badge,
  Divider,
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
  Textarea,
} from "@fluentui/react-components";
import {
  Search24Regular,
  DocumentLink24Regular,
  BookQuestionMark24Regular,
  Send24Regular,
  CheckmarkCircle16Filled,
  Mail24Regular,
  Add24Regular,
  Attach24Regular,
  Play24Regular,
  Pause24Regular,
  ArrowReset24Regular,
  Clock24Regular,
  Dismiss12Regular,
} from "@fluentui/react-icons";
import { ConfigScreen } from "../components/ConfigScreen";
import { AuthScreen } from "../components/AuthScreen";
import {
  getConfig,
  isAuthenticated,
  findUserByEmail,
  findClientByDomain,
  listOpenTicketsForClient,
  searchTickets,
  searchKbArticles,
  searchCannedText,
  listCannedTextGroups,
  createCannedText,
  createCannedTextGroup,
  listTicketTypes,
  ticketTypesForAgentCreate,
  getChargeRates,
  type TenantConfig,
  type HaloUser,
  type HaloClient,
  type HaloTicket,
  type HaloTicketType,
  type HaloChargeRate,
  type HaloKbArticle,
  type HaloCannedText,
  type HaloCannedTextGroup,
} from "@iusehalo/halo-api";
import {
  getRecipients,
  insertIntoBody,
  domainOf,
} from "../lib/office";
import { getDefaults } from "../lib/defaults";
import { useDebouncedSearch } from "../lib/use-debounced-search";

type Phase = "loading" | "needs-config" | "needs-auth" | "ready";

const useStyles = makeStyles({
  root: {
    height: "100%",
    display: "flex",
    flexDirection: "column",
    backgroundColor: tokens.colorNeutralBackground1,
    overflowY: "auto",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "8px 12px",
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  brand: {
    fontWeight: tokens.fontWeightSemibold,
    fontSize: tokens.fontSizeBase300,
  },
  body: {
    display: "flex",
    flexDirection: "column",
    gap: "16px",
    padding: "12px",
    flex: 1,
  },
  sectionLabel: {
    fontSize: tokens.fontSizeBase200,
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground2,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    marginBottom: "6px",
  },
  section: {
    display: "flex",
    flexDirection: "column",
    gap: "6px",
  },
  recipientRow: {
    display: "flex",
    gap: "10px",
    alignItems: "center",
    padding: "6px 8px",
    borderRadius: tokens.borderRadiusMedium,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  recipientText: {
    flex: 1,
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
  },
  recipientName: {
    fontSize: tokens.fontSizeBase200,
    fontWeight: tokens.fontWeightSemibold,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  recipientSecondary: {
    fontSize: tokens.fontSizeBase100,
    color: tokens.colorNeutralForeground3,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  empty: {
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground3,
    fontStyle: "italic",
  },
  resultList: {
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
    maxHeight: "200px",
    overflowY: "auto",
  },
  resultRow: {
    padding: "8px 10px",
    cursor: "pointer",
    borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
    ":hover": {
      backgroundColor: tokens.colorNeutralBackground2Hover,
    },
    ":last-child": {
      borderBottom: "none",
    },
  },
  resultPrimary: {
    fontSize: tokens.fontSizeBase200,
    fontWeight: tokens.fontWeightSemibold,
  },
  resultSecondary: {
    fontSize: tokens.fontSizeBase100,
    color: tokens.colorNeutralForeground3,
  },
  toast: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    color: tokens.colorPaletteGreenForeground1,
    fontSize: tokens.fontSizeBase200,
  },
  toggleSection: {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
    padding: "10px",
    borderRadius: tokens.borderRadiusMedium,
    backgroundColor: tokens.colorNeutralBackground2,
  },
  hint: {
    fontSize: tokens.fontSizeBase100,
    color: tokens.colorNeutralForeground3,
  },
  centerPad: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: "12px",
    padding: "24px",
  },
  // ---------- Log staging ----------
  logButtonsRow: {
    display: "flex",
    gap: "8px",
  },
  logButtonFull: {
    flex: 1,
  },
  stagedBanner: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    padding: "8px 10px",
    borderRadius: tokens.borderRadiusMedium,
    backgroundColor: tokens.colorPaletteGreenBackground1,
    color: tokens.colorPaletteGreenForeground1,
    fontSize: tokens.fontSizeBase200,
  },
  stagedBannerText: {
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  // ---------- Timer ----------
  timerRow: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
  },
  timerDisplay: {
    fontFamily: "monospace",
    fontSize: tokens.fontSizeBase500,
    fontWeight: tokens.fontWeightSemibold,
    flex: 1,
  },
  timerCapped: {
    color: tokens.colorPaletteYellowForeground1,
  },
  chargeRateRow: {
    marginTop: "6px",
  },
});

export function ComposeApp() {
  const styles = useStyles();
  const [phase, setPhase] = useState<Phase>("loading");

  const refreshPhase = useCallback(() => {
    if (!getConfig()) setPhase("needs-config");
    else if (!isAuthenticated()) setPhase("needs-auth");
    else setPhase("ready");
  }, []);

  useEffect(() => {
    refreshPhase();
  }, [refreshPhase]);

  if (phase === "loading") {
    return (
      <div className={styles.root}>
        <div className={styles.centerPad}>
          <Spinner label="Loading…" />
        </div>
      </div>
    );
  }

  if (phase === "needs-config") {
    return (
      <div className={styles.root}>
        <ConfigScreen onConfigured={refreshPhase} />
      </div>
    );
  }

  if (phase === "needs-auth") {
    return (
      <div className={styles.root}>
        <AuthScreen onAuthenticated={refreshPhase} onReconfigure={refreshPhase} />
      </div>
    );
  }

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <Text className={styles.brand}>HaloPSA</Text>
      </div>
      <div className={styles.body}>
        <RecipientsSection />
        <Divider />
        <InsertCannedTextSection />
        <Divider />
        <InsertTicketSection />
        <Divider />
        <InsertKbSection />
        <Divider />
        <LogStagingSection />
        <Divider />
        <TimerSection />
      </div>
    </div>
  );
}

// ---------- Recipients section ----------

interface ResolvedRecipient {
  email: string;
  user?: HaloUser;
  client?: HaloClient;
  loading: boolean;
}

function RecipientsSection() {
  const styles = useStyles();
  const [recipients, setRecipients] = useState<ResolvedRecipient[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [error, setError] = useState<string | undefined>();
  // Bumping this triggers a re-fetch. Used both by the Office RecipientsChanged
  // handler and the manual Refresh button.
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
  }, [reloadToken]);

  // Subscribe to Outlook's RecipientsChanged event so the resolved-recipients
  // list stays in sync as the user adds/removes addresses in the compose
  // pane. Without this, the panel only ever reflects the recipients present
  // when the task pane first opened, which is the bug the user reported.
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

  return (
    <div className={styles.section}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <Text className={styles.sectionLabel}>Recipients</Text>
        <Button
          appearance="subtle"
          size="small"
          onClick={() => setReloadToken((n) => n + 1)}
          aria-label="Refresh recipients"
        >
          Refresh
        </Button>
      </div>
      {error && (
        <MessageBar intent="error">
          <MessageBarBody>{error}</MessageBarBody>
        </MessageBar>
      )}
      {loadingList ? (
        <Skeleton>
          <SkeletonItem size={48} />
        </Skeleton>
      ) : recipients.length === 0 ? (
        <Text className={styles.empty}>No recipients yet.</Text>
      ) : (
        recipients.map((r, i) => <RecipientRow key={`${r.email}-${i}`} recipient={r} />)
      )}
    </div>
  );
}

function RecipientRow({ recipient }: { recipient: ResolvedRecipient }) {
  const styles = useStyles();
  const displayName = recipient.user?.name ?? recipient.email;
  const secondary = recipient.user?.client_name ?? recipient.client?.name ?? recipient.email;

  return (
    <div className={styles.recipientRow}>
      <Avatar name={displayName} color="colorful" size={28} />
      <div className={styles.recipientText}>
        <Text className={styles.recipientName}>{displayName}</Text>
        <Text className={styles.recipientSecondary}>{secondary}</Text>
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

// ---------- Insert canned-text section ----------
//
// Canned texts in Halo are saved email/ticket boilerplate, organised into groups
// (Oppos, Service, DIY Halo, SOWs, ...). We let the user filter by group, search
// by name or body, click to insert the HTML into the draft at cursor, and save
// a new canned text from inside Outlook.

const ALL_GROUPS_KEY = -1; // sentinel meaning "no group filter"

function InsertCannedTextSection() {
  const styles = useStyles();
  const [query, setQuery] = useState("");
  const [groupId, setGroupId] = useState<number>(ALL_GROUPS_KEY);
  const [groups, setGroups] = useState<HaloCannedTextGroup[]>([]);
  const [toast, setToast] = useState<string | undefined>();
  const [actionError, setActionError] = useState<string | undefined>();
  const [saveOpen, setSaveOpen] = useState(false);

  useEffect(() => {
    listCannedTextGroups().then(setGroups).catch(() => {});
  }, []);

  // The hook only re-fetches on query changes; we also want group changes to
  // trigger a re-filter. Compose a stable cache key.
  const searchKey = `${query} ${groupId}`;
  const search = (_q: string) =>
    searchCannedText(query, groupId === ALL_GROUPS_KEY ? undefined : groupId);

  const { results, loading, error: searchError } = useDebouncedSearch<HaloCannedText>(
    searchKey,
    search,
    { minLength: 0 },
  );
  const error = actionError ?? searchError;

  const onPick = async (c: HaloCannedText) => {
    try {
      const html = c.html?.trim() || escapeHtml(c.text ?? "");
      await insertIntoBody(html);
      setToast(`Inserted "${c.name}"`);
      setTimeout(() => setToast(undefined), 3000);
    } catch (e) {
      setActionError((e as Error).message);
    }
  };

  return (
    <div className={styles.section}>
      <Text className={styles.sectionLabel}>
        <Mail24Regular
          style={{ verticalAlign: "middle", marginRight: 4, width: 14, height: 14 }}
        />
        Insert canned text
      </Text>

      <Field label="Filter by group">
        <select
          value={groupId}
          onChange={(e) => setGroupId(Number(e.target.value))}
          style={{
            padding: "4px 8px",
            border: `1px solid ${tokens.colorNeutralStroke1}`,
            borderRadius: tokens.borderRadiusMedium,
            background: tokens.colorNeutralBackground1,
            fontSize: tokens.fontSizeBase300,
          }}
        >
          <option value={ALL_GROUPS_KEY}>All groups</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Search">
        <Input
          value={query}
          placeholder="Filter by name or body…"
          onChange={(_, d) => setQuery(d.value)}
          contentBefore={<Search24Regular />}
        />
      </Field>

      <Button
        size="small"
        appearance="subtle"
        icon={<Add24Regular />}
        onClick={() => setSaveOpen(true)}
        style={{ alignSelf: "flex-start" }}
      >
        Save current draft as canned text
      </Button>

      {loading && (
        <div>
          <Spinner size="extra-tiny" /> Loading…
        </div>
      )}

      {!loading && results.length === 0 && (
        <Text className={styles.empty}>
          {query.trim() || groupId !== ALL_GROUPS_KEY
            ? "No canned texts match."
            : "No canned texts."}
        </Text>
      )}

      {results.length > 0 && (
        <div className={styles.resultList}>
          {results.map((c) => (
            <div
              key={c.id}
              className={styles.resultRow}
              onClick={() => onPick(c)}
              role="button"
              tabIndex={0}
            >
              <div className={styles.resultPrimary}>{c.name}</div>
              <div className={styles.resultSecondary}>
                {(c.text ?? "").slice(0, 120)}
                {(c.text ?? "").length > 120 ? "…" : ""}
              </div>
            </div>
          ))}
        </div>
      )}

      {error && (
        <MessageBar intent="error">
          <MessageBarBody>{error}</MessageBarBody>
        </MessageBar>
      )}

      {toast && (
        <div className={styles.toast}>
          <CheckmarkCircle16Filled />
          <span>{toast}</span>
        </div>
      )}

      <SaveCannedTextDialog
        open={saveOpen}
        groups={groups}
        defaultGroupId={groupId === ALL_GROUPS_KEY ? undefined : groupId}
        onClose={() => setSaveOpen(false)}
        onCreated={(c) => {
          setSaveOpen(false);
          setToast(`Saved "${c.name}"`);
          setTimeout(() => setToast(undefined), 3000);
        }}
      />
    </div>
  );
}

function SaveCannedTextDialog({
  open,
  groups,
  defaultGroupId,
  onClose,
  onCreated,
}: {
  open: boolean;
  groups: HaloCannedTextGroup[];
  defaultGroupId?: number;
  onClose: () => void;
  onCreated: (c: HaloCannedText) => void;
}) {
  const [name, setName] = useState("");
  const [groupId, setGroupId] = useState<number | undefined>(defaultGroupId);
  const [newGroupName, setNewGroupName] = useState("");
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [localGroups, setLocalGroups] = useState(groups);

  useEffect(() => {
    setLocalGroups(groups);
  }, [groups]);

  useEffect(() => {
    if (!open) return;
    setError(undefined);
    setBusy(false);
    setName("");
    setText("");
    setGroupId(defaultGroupId);
    setNewGroupName("");
    setCreatingGroup(false);
    // Prefill with the current draft body so the agent can save what they
    // just wrote without copy-paste.
    Office.context.mailbox.item?.body?.getAsync(Office.CoercionType.Text, (r) => {
      if (r.status === Office.AsyncResultStatus.Succeeded) {
        setText(r.value || "");
      }
    });
  }, [open, defaultGroupId]);

  const submit = async () => {
    if (!name.trim() || !text.trim()) {
      setError("Name and body are required.");
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      let targetGroupId = groupId;
      if (creatingGroup && newGroupName.trim()) {
        const created = await createCannedTextGroup(newGroupName.trim());
        targetGroupId = created.id;
      }
      // Need both plain and HTML representations. Wrap plain in <p> tags as a
      // minimal default; Halo's UI accepts both.
      const html = `<p>${escapeHtml(text).replace(/\r?\n\r?\n/g, "</p><p>").replace(/\r?\n/g, "<br>")}</p>`;
      const created = await createCannedText({
        name: name.trim(),
        text: text.trim(),
        html,
        group_id: targetGroupId,
      });
      onCreated(created);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(_, d) => !d.open && onClose()}>
      <DialogSurface>
        <DialogBody>
          <DialogTitle>Save as canned text</DialogTitle>
          <DialogContent>
            <Field label="Name" required>
              <Input
                value={name}
                onChange={(_, d) => setName(d.value)}
                placeholder="e.g. CX - Refill Hours"
              />
            </Field>

            <Field label="Group" style={{ marginTop: 10 }}>
              {creatingGroup ? (
                <div style={{ display: "flex", gap: 6 }}>
                  <Input
                    value={newGroupName}
                    placeholder="New group name"
                    onChange={(_, d) => setNewGroupName(d.value)}
                    style={{ flex: 1 }}
                  />
                  <Button
                    size="small"
                    appearance="secondary"
                    onClick={() => {
                      setCreatingGroup(false);
                      setNewGroupName("");
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              ) : (
                <div style={{ display: "flex", gap: 6 }}>
                  <select
                    value={groupId ?? ""}
                    onChange={(e) =>
                      setGroupId(e.target.value === "" ? undefined : Number(e.target.value))
                    }
                    style={{
                      flex: 1,
                      padding: "4px 8px",
                      border: `1px solid ${tokens.colorNeutralStroke1}`,
                      borderRadius: tokens.borderRadiusMedium,
                      background: tokens.colorNeutralBackground1,
                      fontSize: tokens.fontSizeBase300,
                    }}
                  >
                    <option value="">(No group)</option>
                    {localGroups.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name}
                      </option>
                    ))}
                  </select>
                  <Button
                    size="small"
                    appearance="subtle"
                    icon={<Add24Regular />}
                    onClick={() => setCreatingGroup(true)}
                  >
                    New group
                  </Button>
                </div>
              )}
            </Field>

            <Field label="Body" required style={{ marginTop: 10 }}>
              <Textarea
                value={text}
                onChange={(_, d) => setText(d.value)}
                rows={8}
                placeholder="Plain text — Halo will format on insert."
              />
            </Field>

            {error && (
              <MessageBar intent="error" style={{ marginTop: 10 }}>
                <MessageBarBody>{error}</MessageBarBody>
              </MessageBar>
            )}
          </DialogContent>
          <DialogActions>
            <Button appearance="secondary" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button
              appearance="primary"
              onClick={submit}
              disabled={busy || !name.trim() || !text.trim()}
              icon={busy ? <Spinner size="tiny" /> : undefined}
            >
              {busy ? "Saving…" : "Save"}
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}

// ---------- Insert ticket-link section ----------

function InsertTicketSection() {
  const styles = useStyles();
  const cfg = getConfig() as TenantConfig;
  const [query, setQuery] = useState("");
  const [toast, setToast] = useState<string | undefined>();
  const [actionError, setActionError] = useState<string | undefined>();
  const { results, loading, error: searchError } = useDebouncedSearch(query, searchTickets);
  const error = actionError ?? searchError;
  const setError = setActionError;

  const onPick = async (ticket: HaloTicket) => {
    try {
      const url = `${cfg.haloBaseUrl}/agent?id=${ticket.id}`;
      const safeSummary = escapeHtml(ticket.summary);
      const html = `<a href="${url}">#${ticket.id} — ${safeSummary}</a>`;
      await insertIntoBody(html);
      setToast(`Inserted link to #${ticket.id}`);
      setTimeout(() => setToast(undefined), 3000);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className={styles.section}>
      <Text className={styles.sectionLabel}>
        <DocumentLink24Regular
          style={{ verticalAlign: "middle", marginRight: 4, width: 14, height: 14 }}
        />
        Insert ticket link
      </Text>
      <Input
        value={query}
        placeholder="Search tickets…"
        onChange={(_, d) => setQuery(d.value)}
        contentBefore={<Search24Regular />}
      />
      {error && (
        <MessageBar intent="error">
          <MessageBarBody>{error}</MessageBarBody>
        </MessageBar>
      )}
      {toast && (
        <div className={styles.toast}>
          <CheckmarkCircle16Filled />
          <span>{toast}</span>
        </div>
      )}
      {query.trim().length >= 2 && (
        <div className={styles.resultList}>
          {loading ? (
            <div style={{ padding: 10 }}>
              <Spinner size="extra-tiny" /> Searching…
            </div>
          ) : results.length === 0 ? (
            <div style={{ padding: 10 }}>
              <Text className={styles.empty}>No tickets found.</Text>
            </div>
          ) : (
            results.map((t) => (
              <div key={t.id} className={styles.resultRow} onClick={() => onPick(t)}>
                <Text className={styles.resultPrimary}>
                  #{t.id} — {t.summary}
                </Text>
                {(t.client_name || t.statusname) && (
                  <>
                    <br />
                    <Text className={styles.resultSecondary}>
                      {[t.client_name, t.statusname].filter(Boolean).join(" · ")}
                    </Text>
                  </>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ---------- Insert KB-article section ----------

const KB_BODY_INSERT_THRESHOLD = 4000;

function InsertKbSection() {
  const styles = useStyles();
  const cfg = getConfig() as TenantConfig;
  const [query, setQuery] = useState("");
  const [toast, setToast] = useState<string | undefined>();
  const [actionError, setActionError] = useState<string | undefined>();
  const { results, loading, error: searchError } = useDebouncedSearch(query, searchKbArticles);
  const error = actionError ?? searchError;
  const setError = setActionError;

  const onPick = async (article: HaloKbArticle) => {
    try {
      // Body field varies by tenant version — try faq_answer first, fall back to details.
      const body = article.faq_answer ?? article.details ?? "";
      const articleUrl = `${cfg.haloBaseUrl}/kb?id=${article.id}`;
      let html: string;
      if (body && body.length <= KB_BODY_INSERT_THRESHOLD) {
        // Inline the full article when it's short enough.
        html = body;
      } else if (body) {
        // For long articles, insert a snippet + link so the email stays readable.
        const text = stripHtml(body).slice(0, 400).trim();
        html = `<blockquote>${escapeHtml(text)}…</blockquote><p><a href="${articleUrl}">Read full article: ${escapeHtml(article.name)}</a></p>`;
      } else {
        html = `<p><a href="${articleUrl}">${escapeHtml(article.name)}</a></p>`;
      }
      await insertIntoBody(html);
      setToast(`Inserted "${article.name}"`);
      setTimeout(() => setToast(undefined), 3000);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className={styles.section}>
      <Text className={styles.sectionLabel}>
        <BookQuestionMark24Regular
          style={{ verticalAlign: "middle", marginRight: 4, width: 14, height: 14 }}
        />
        Insert KB article
      </Text>
      <Input
        value={query}
        placeholder="Search KB…"
        onChange={(_, d) => setQuery(d.value)}
        contentBefore={<Search24Regular />}
      />
      {error && (
        <MessageBar intent="error">
          <MessageBarBody>{error}</MessageBarBody>
        </MessageBar>
      )}
      {toast && (
        <div className={styles.toast}>
          <CheckmarkCircle16Filled />
          <span>{toast}</span>
        </div>
      )}
      {query.trim().length >= 2 && (
        <div className={styles.resultList}>
          {loading ? (
            <div style={{ padding: 10 }}>
              <Spinner size="extra-tiny" /> Searching…
            </div>
          ) : results.length === 0 ? (
            <div style={{ padding: 10 }}>
              <Text className={styles.empty}>No articles found.</Text>
            </div>
          ) : (
            results.map((a) => (
              <div key={a.id} className={styles.resultRow} onClick={() => onPick(a)}>
                <Text className={styles.resultPrimary}>{a.name}</Text>
                {a.tags && a.tags.length > 0 && (
                  <>
                    <br />
                    <Text className={styles.resultSecondary}>
                      {a.tags.map((t) => t.value).join(" · ")}
                    </Text>
                  </>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}


// ---------- Log staging (Append / Create) ----------
//
// Two buttons mirroring the read-pane LogActions UI. Both stage state into
// Office.context.mailbox.item CustomProperties; the launchevent runtime reads
// the staged target on send and either appends (haloLogTicketId) or
// creates-then-appends (haloLogPendingCreate). Replaces the previous single
// "Log to ticket" switch that conflated append and create paths.

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

function LogStagingSection() {
  const styles = useStyles();
  const [stagedTicketId, setStagedTicketId] = useState<number | undefined>();
  const [stagedTicketSummary, setStagedTicketSummary] = useState<string | undefined>();
  const [stagedCreate, setStagedCreate] = useState<PendingCreate | undefined>();
  const [rehydrated, setRehydrated] = useState(false);
  const [autoMatchedTickets, setAutoMatchedTickets] = useState<HaloTicket[]>([]);
  const [autoMatchLoading, setAutoMatchLoading] = useState(false);

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
          searchTickets(`#${id}`, 1)
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
    if (!rehydrated) return;
    if (!getDefaults().autoLogRepliesToTickets) return;

    let cancelled = false;
    setAutoMatchLoading(true);

    (async () => {
      try {
        const { to } = await getRecipients();
        if (cancelled || to.length === 0) return;

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
        if (tickets.length === 1) {
          setStagedTicketId((prev) => {
            if (prev !== undefined) return prev;
            const t = tickets[0];
            setStagedTicketSummary(t.summary);
            writeLogProps({ ticketId: t.id });
            return t.id;
          });
        }
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

  return (
    <div className={styles.section}>
      <Text className={styles.sectionLabel}>
        <Send24Regular
          style={{ verticalAlign: "middle", marginRight: 4, width: 14, height: 14 }}
        />
        Log on send
      </Text>
      <div className={styles.logButtonsRow}>
        <AppendStageDialog
          onStage={onAppendStaged}
          triggerClass={styles.logButtonFull}
          candidates={autoMatchedTickets}
        />
        <CreateStageDialog onStage={onCreateStaged} triggerClass={styles.logButtonFull} />
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
    </div>
  );
}

function AppendStageDialog({
  onStage,
  triggerClass,
  candidates = [],
}: {
  onStage: (t: HaloTicket) => void;
  triggerClass: string;
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
      <DialogTrigger disableButtonEnhancement>
        <Button
          appearance="secondary"
          icon={<Attach24Regular />}
          className={triggerClass}
        >
          Append
        </Button>
      </DialogTrigger>
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
  triggerClass,
}: {
  onStage: (p: PendingCreate) => void;
  triggerClass: string;
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
      <DialogTrigger disableButtonEnhancement>
        <Button
          appearance="primary"
          icon={<Add24Regular />}
          className={triggerClass}
        >
          Create
        </Button>
      </DialogTrigger>
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

// ---------- Timer section ----------
//
// Live MM:SS counter that auto-starts when the compose pane opens and
// persists across pane close/reopen via custom properties on the draft.
// Capped at 30 minutes (display freezes; accumulation stops) so a
// forgotten draft doesn't poison the time entry.
//
// On send, launchevent.js reads haloComposeTimeSeconds and
// haloComposeChargeRateId from the draft's custom properties and stamps
// them as time_taken (decimal hours) and chargerate_id on the action.

const TIMER_TIME_PROP = "haloComposeTimeSeconds";
const TIMER_RUNNING_PROP = "haloComposeTimerRunning";
const CHARGE_RATE_PROP = "haloComposeChargeRateId";
const TIMER_CAP_SECONDS = 30 * 60;
const TIMER_PERSIST_INTERVAL_SECONDS = 5;

function formatMMSS(seconds: number): string {
  const capped = Math.min(seconds, TIMER_CAP_SECONDS);
  const m = Math.floor(capped / 60);
  const s = capped % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function TimerSection() {
  const styles = useStyles();
  const [seconds, setSeconds] = useState(0);
  const [running, setRunning] = useState(true);
  const [chargeRateId, setChargeRateId] = useState(0);
  const [chargeRates, setChargeRates] = useState<HaloChargeRate[]>([]);
  const [hydrated, setHydrated] = useState(false);

  // Charge rate options come from ClientCache.lookups — synchronous after
  // bootstrap. getChargeRates always returns at least one entry (No Charge).
  useEffect(() => {
    setChargeRates(getChargeRates());
  }, []);

  // Rehydrate persisted state on mount: time accumulated so far, running
  // flag, selected charge rate. Without this, every pane reopen would
  // reset the counter to zero.
  useEffect(() => {
    const item = Office.context.mailbox.item;
    if (!item) {
      setHydrated(true);
      return;
    }
    item.loadCustomPropertiesAsync((r) => {
      if (r.status === Office.AsyncResultStatus.Succeeded) {
        const t = Number(r.value.get(TIMER_TIME_PROP) || 0);
        const run = r.value.get(TIMER_RUNNING_PROP);
        const cr = Number(r.value.get(CHARGE_RATE_PROP) || 0);
        if (Number.isFinite(t)) setSeconds(t);
        if (run === "0") setRunning(false);
        if (Number.isFinite(cr)) setChargeRateId(cr);
      }
      setHydrated(true);
    });
  }, []);

  // Tick + cap at 30 minutes. Tick stops when paused or capped.
  useEffect(() => {
    if (!running || !hydrated) return;
    if (seconds >= TIMER_CAP_SECONDS) return;
    const h = window.setInterval(() => {
      setSeconds((s) => Math.min(s + 1, TIMER_CAP_SECONDS));
    }, 1000);
    return () => window.clearInterval(h);
  }, [running, hydrated, seconds]);

  // Persist time every N seconds so a sudden pane close doesn't lose
  // more than ~5s of accumulated time.
  useEffect(() => {
    if (!hydrated) return;
    if (seconds % TIMER_PERSIST_INTERVAL_SECONDS !== 0) return;
    const item = Office.context.mailbox.item;
    if (!item) return;
    item.loadCustomPropertiesAsync((r) => {
      if (r.status !== Office.AsyncResultStatus.Succeeded) return;
      r.value.set(TIMER_TIME_PROP, String(seconds));
      r.value.saveAsync(() => { /* fire and forget */ });
    });
  }, [seconds, hydrated]);

  const persistRunning = (next: boolean) => {
    const item = Office.context.mailbox.item;
    if (!item) return;
    item.loadCustomPropertiesAsync((r) => {
      if (r.status !== Office.AsyncResultStatus.Succeeded) return;
      r.value.set(TIMER_RUNNING_PROP, next ? "1" : "0");
      r.value.saveAsync(() => { /* fire and forget */ });
    });
  };

  const persistChargeRate = (next: number) => {
    const item = Office.context.mailbox.item;
    if (!item) return;
    item.loadCustomPropertiesAsync((r) => {
      if (r.status !== Office.AsyncResultStatus.Succeeded) return;
      r.value.set(CHARGE_RATE_PROP, String(next));
      r.value.saveAsync(() => { /* fire and forget */ });
    });
  };

  const togglePause = () => {
    const next = !running;
    setRunning(next);
    persistRunning(next);
  };

  const reset = () => {
    setSeconds(0);
    const item = Office.context.mailbox.item;
    if (!item) return;
    item.loadCustomPropertiesAsync((r) => {
      if (r.status !== Office.AsyncResultStatus.Succeeded) return;
      r.value.set(TIMER_TIME_PROP, "0");
      r.value.saveAsync(() => { /* fire and forget */ });
    });
  };

  const capped = seconds >= TIMER_CAP_SECONDS;
  const selectedRate = chargeRates.find((r) => r.id === chargeRateId) ?? chargeRates[0];

  return (
    <div className={styles.section}>
      <Text className={styles.sectionLabel}>
        <Clock24Regular
          style={{ verticalAlign: "middle", marginRight: 4, width: 14, height: 14 }}
        />
        Time on this email
      </Text>
      <div className={styles.timerRow}>
        <Text className={`${styles.timerDisplay} ${capped ? styles.timerCapped : ""}`}>
          {formatMMSS(seconds)}
        </Text>
        <Button
          appearance="subtle"
          size="small"
          icon={running ? <Pause24Regular /> : <Play24Regular />}
          aria-label={running ? "Pause timer" : "Resume timer"}
          onClick={togglePause}
        />
        <Button
          appearance="subtle"
          size="small"
          icon={<ArrowReset24Regular />}
          aria-label="Reset timer"
          onClick={reset}
        />
      </div>
      {capped && (
        <Text className={styles.hint}>
          Capped at 30:00 — a single email shouldn't bill more than half an hour.
        </Text>
      )}
      <Field label="Charge rate" className={styles.chargeRateRow}>
        <Combobox
          value={selectedRate?.name ?? "No Charge"}
          onOptionSelect={(_, d) => {
            if (!d.optionValue) return;
            const next = Number(d.optionValue);
            setChargeRateId(next);
            persistChargeRate(next);
          }}
        >
          {chargeRates.map((r) => (
            <Option key={r.id} value={String(r.id)} text={r.name}>
              {r.name}
            </Option>
          ))}
        </Combobox>
      </Field>
    </div>
  );
}

// ---------- helpers ----------

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function stripHtml(s: string): string {
  return s
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ");
}
