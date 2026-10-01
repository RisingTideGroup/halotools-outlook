import { useEffect, useState } from "react";
import {
  Text,
  Spinner,
  tokens,
  Input,
  Select,
  MessageBar,
  MessageBarBody,
  Field,
  Button,
  Dialog,
  DialogSurface,
  DialogBody,
  DialogTitle,
  DialogContent,
  DialogActions,
  Textarea,
  TabList,
  Tab,
} from "@fluentui/react-components";
import {
  Search24Regular,
  CheckmarkCircle16Filled,
  Add24Regular,
} from "@fluentui/react-icons";
import {
  getConfig,
  searchTickets,
  searchKbArticles,
  searchCannedText,
  listCannedTextGroups,
  createCannedText,
  createCannedTextGroup,
  type TenantConfig,
  type HaloTicket,
  type HaloKbArticle,
  type HaloCannedText,
  type HaloCannedTextGroup,
} from "@iusehalo/halo-api";
import { insertIntoBody } from "../lib/office";
import { useDebouncedSearch } from "../lib/use-debounced-search";
import { useComposeStyles } from "./styles";
import { escapeHtml, stripHtml } from "./helpers";

// ---------- Insert tools (tabbed) ----------
//
// Three insert-at-cursor tools share one TabList: canned text (default),
// ticket link, KB article. All three panels stay mounted (inactive ones are
// hidden) so switching tabs never discards a typed search, a pending toast
// or an open Save dialog.

type ToolTab = "canned" | "ticket" | "kb";

export function InsertTools() {
  const styles = useComposeStyles();
  const [tab, setTab] = useState<ToolTab>("canned");

  return (
    <div className={styles.tools}>
      <TabList
        selectedValue={tab}
        onTabSelect={(_, d) => setTab(d.value as ToolTab)}
        aria-label="Insert tools"
      >
        <Tab id="compose-tab-canned" value="canned">Canned text</Tab>
        <Tab id="compose-tab-ticket" value="ticket">Ticket link</Tab>
        <Tab id="compose-tab-kb" value="kb">KB article</Tab>
      </TabList>
      <div
        role="tabpanel"
        aria-labelledby="compose-tab-canned"
        hidden={tab !== "canned"}
        className={tab === "canned" ? styles.tabPanel : undefined}
      >
        <CannedTextPanel />
      </div>
      <div
        role="tabpanel"
        aria-labelledby="compose-tab-ticket"
        hidden={tab !== "ticket"}
        className={tab === "ticket" ? styles.tabPanel : undefined}
      >
        <TicketLinkPanel />
      </div>
      <div
        role="tabpanel"
        aria-labelledby="compose-tab-kb"
        hidden={tab !== "kb"}
        className={tab === "kb" ? styles.tabPanel : undefined}
      >
        <KbArticlePanel />
      </div>
    </div>
  );
}

// ---------- Canned text ----------
//
// Canned texts in Halo are saved email/ticket boilerplate, organised into groups
// (Oppos, Service, DIY Halo, SOWs, ...). We let the user filter by group, search
// by name or body, click to insert the HTML into the draft at cursor, and save
// a new canned text from inside Outlook.

const ALL_GROUPS_KEY = -1; // sentinel meaning "no group filter"
const CANNED_PREVIEW_CHARS = 120;

function CannedTextPanel() {
  const styles = useComposeStyles();
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
  const searchKey = `${query} ${groupId}`;
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
    <>
      <div className={styles.searchRow}>
        <Input
          className={styles.searchInput}
          value={query}
          placeholder="Filter by name or body…"
          aria-label="Search canned text"
          onChange={(_, d) => setQuery(d.value)}
          contentBefore={<Search24Regular />}
        />
        <Select
          className={styles.groupSelect}
          value={String(groupId)}
          aria-label="Filter by group"
          title="Filter by group"
          onChange={(_, d) => setGroupId(Number(d.value))}
        >
          <option value={ALL_GROUPS_KEY}>All groups</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </Select>
      </div>

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
          {results.map((c) => {
            const text = c.text ?? "";
            const preview = text.slice(0, CANNED_PREVIEW_CHARS) + (text.length > CANNED_PREVIEW_CHARS ? "…" : "");
            return (
              <div
                key={c.id}
                className={styles.resultRow}
                onClick={() => onPick(c)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onPick(c); }
                }}
                role="button"
                tabIndex={0}
                aria-label={`Insert "${c.name}"`}
              >
                <div className={styles.resultRowMain}>
                  <div className={styles.resultPrimary}>{c.name}</div>
                  <div className={styles.resultPreview} title={preview}>{preview}</div>
                </div>
                <span className={styles.insertAffordance} aria-hidden="true">Insert</span>
              </div>
            );
          })}
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

      <Button
        size="small"
        appearance="subtle"
        icon={<Add24Regular />}
        onClick={() => setSaveOpen(true)}
        className={styles.saveButton}
      >
        Save current draft as canned text
      </Button>

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
    </>
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

// ---------- Ticket link ----------

function TicketLinkPanel() {
  const styles = useComposeStyles();
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
    <>
      <Input
        value={query}
        placeholder="Search tickets…"
        aria-label="Search tickets"
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
                <div className={styles.resultRowMain}>
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
              </div>
            ))
          )}
        </div>
      )}
    </>
  );
}

// ---------- KB article ----------

const KB_BODY_INSERT_THRESHOLD = 4000;

function KbArticlePanel() {
  const styles = useComposeStyles();
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
    <>
      <Input
        value={query}
        placeholder="Search KB…"
        aria-label="Search KB"
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
                <div className={styles.resultRowMain}>
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
              </div>
            ))
          )}
        </div>
      )}
    </>
  );
}
