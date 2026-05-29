import { useEffect, useState } from "react";
import {
  Button,
  makeStyles,
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
} from "@fluentui/react-components";
import { Add24Regular, Attach24Regular } from "@fluentui/react-icons";
import {
  appendAction,
  createTicket,
  listTicketTypes,
  ticketTypesForAgentCreate,
  ticketDeepLink,
  searchTickets,
} from "@iusehalo/halo-api";
import {
  getBody,
  fetchAllAttachments,
  listAttachments,
  type EmailContext,
  type FetchedAttachment,
} from "../lib/office";
import type {
  HaloTicket,
  HaloUser,
  HaloClient,
  HaloTicketType,
  HaloAttachmentInline,
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
  toggleRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: "4px",
  },
  toggleLabel: {
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground2,
  },
  hint: {
    fontSize: tokens.fontSizeBase100,
    color: tokens.colorNeutralForeground3,
  },
});

interface Props {
  email: EmailContext;
  client?: HaloClient;
  contact?: HaloUser;
  candidateTickets: HaloTicket[];
  /** When true, Append is primary and Create is secondary (use when a thread match exists). */
  preferAppend?: boolean;
}

export function LogActions({
  email,
  client,
  contact,
  candidateTickets,
  preferAppend,
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

  return (
    <div className={styles.root}>
      <div className={styles.buttons}>
        <AppendDialog
          email={email}
          contact={contact}
          tickets={candidateTickets}
          onResult={announce}
          triggerClass={styles.buttonFull}
          appearance={preferAppend ? "primary" : "secondary"}
        />
        <CreateDialog
          email={email}
          client={client}
          contact={contact}
          onResult={announce}
          triggerClass={styles.buttonFull}
          appearance={preferAppend ? "secondary" : "primary"}
          dedupWarning={preferAppend}
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

function AppendDialog({
  email,
  contact,
  tickets,
  onResult,
  triggerClass,
  appearance = "secondary",
}: {
  email: EmailContext;
  contact?: HaloUser;
  tickets: HaloTicket[];
  onResult: (kind: "success" | "error" | "warning", msg: string) => void;
  triggerClass: string;
  appearance?: "primary" | "secondary";
}) {
  const [selectedId, setSelectedId] = useState<number | undefined>();
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState<{ message: string; url?: string } | undefined>();
  const [internalNote, setInternalNote] = useState(false);
  const [includeAttachments, setIncludeAttachments] = useState(
    getDefaults().includeAttachmentsByDefault ?? true,
  );
  const [searchResults, setSearchResults] = useState<HaloTicket[]>([]);
  const [searching, setSearching] = useState(false);
  const attachmentCount = listAttachments().filter((a) => !a.isInline).length;

  // Server-side search: when the user types, query Halo (debounced) so newly
  // created tickets are findable even if they didn't exist when the dialog
  // opened. Cap at 15 hits so the dropdown stays usable.
  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setSearchResults([]);
      setSearching(false);
      return;
    }
    // Skip the API call once a selection has been made — at that point the
    // combobox value is the formatted "#123 · summary" string, not a search.
    if (selectedId) return;
    setSearching(true);
    let cancelled = false;
    const handle = setTimeout(() => {
      searchTickets(trimmed, 15)
        .then((res) => {
          if (!cancelled) setSearchResults(res);
        })
        .catch(() => {
          if (!cancelled) setSearchResults([]);
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [query, selectedId]);

  // Merge candidates (thread matches + open tickets for the client) with the
  // server-side search results, deduping by id and prioritising candidates
  // first so thread-matched tickets always lead the list.
  const visibleTickets = (() => {
    const q = query.trim().toLowerCase();
    const base = q
      ? tickets.filter((t) => {
          const hay = `#${t.id} ${t.summary ?? ""} ${t.statusname ?? ""}`.toLowerCase();
          return hay.includes(q);
        })
      : tickets;
    if (!q || searchResults.length === 0) return base.slice(0, 15);
    const seen = new Set(base.map((t) => t.id));
    const extras = searchResults.filter((t) => !seen.has(t.id));
    return [...base, ...extras].slice(0, 15);
  })();

  const reset = () => {
    setSelectedId(undefined);
    setQuery("");
    setDone(undefined);
    setInternalNote(false);
  };

  const submit = async () => {
    if (!selectedId) return;
    setBusy(true);
    try {
      const html = await getBody("html");
      let attachments: HaloAttachmentInline[] = [];
      let attachWarning: string | undefined;
      if (includeAttachments && attachmentCount > 0) {
        const fetched = await fetchAllAttachments();
        attachments = fetched.attachments.map(toHaloAttachment);
        if (fetched.errors.length > 0) {
          attachWarning = `Some attachments couldn't be included: ${fetched.errors.join("; ")}`;
        }
      }

      // Direction-aware outcome. Sent items get "Outgoing Email" so Halo
      // attributes them as agent-to-customer; inbox messages stay
      // "Email Received". Both are tenant-configurable; the defaults below
      // match Halo's standard outcome names.
      const defaultOutcome =
        email.direction === "outgoing"
          ? getDefaults().defaultOutgoingOutcome ?? "Outgoing Email"
          : getDefaults().defaultAppendOutcome ?? "Email Received";

      const action = await appendAction({
        ticket_id: selectedId,
        outcome: defaultOutcome,
        note: html,
        hiddenfromuser: internalNote,
        // RFC sender — for outgoing this is the agent, for incoming the customer.
        // Halo logs this verbatim as the From: header of the recorded action.
        emailfrom: email.senderEmail,
        emailfromname: email.senderName,
        emailsubject: email.subject,
        attachments: attachments.length ? attachments : undefined,
        // user_id is always the customer regardless of direction so the
        // action is linked to the right person in Halo. The Dashboard's
        // contact resolution already uses customerEmail, so `contact` here
        // is the customer for both sent and received mail.
        user_id: contact?.id,
        actionby_user_id: contact?.id,
        internetmessageid: email.internetMessageId,
        inreplyto: email.inReplyTo,
        references: email.references.length ? email.references.join(" ") : undefined,
      });

      if (attachWarning) {
        onResult("warning", `Appended to #${action.ticket_id}, but: ${attachWarning}`);
        setOpen(false);
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

  return (
    <Dialog
      open={open}
      onOpenChange={(_, d) => {
        setOpen(d.open);
        if (!d.open) reset();
      }}
    >
      <DialogTrigger disableButtonEnhancement>
        <Button
          appearance={appearance}
          icon={<Attach24Regular />}
          className={triggerClass}
        >
          Append
        </Button>
      </DialogTrigger>
      <DialogSurface>
        <DialogBody>
          <DialogTitle>Append email to ticket</DialogTitle>
          <DialogContent>
            <Field label="Ticket" required hint="Type to filter by # or summary">
              <Combobox
                freeform
                placeholder="Search tickets…"
                value={query}
                selectedOptions={selectedId ? [String(selectedId)] : []}
                onInput={(e) => {
                  setQuery((e.target as HTMLInputElement).value);
                  setSelectedId(undefined);
                }}
                onOptionSelect={(_, d) => {
                  const id = d.optionValue ? Number(d.optionValue) : undefined;
                  setSelectedId(id);
                  const t = tickets.find((x) => x.id === id);
                  setQuery(t ? `#${t.id} · ${t.summary}` : "");
                }}
              >
                {visibleTickets.map((t) => (
                  <Option key={t.id} value={String(t.id)} text={`#${t.id} · ${t.summary}`}>
                    #{t.id} · {t.summary}
                    {t.statusname ? ` · ${t.statusname}` : ""}
                  </Option>
                ))}
                {visibleTickets.length === 0 && (
                  <Option value="__none__" disabled>
                    {searching ? "Searching…" : "No tickets match"}
                  </Option>
                )}
              </Combobox>
            </Field>

            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 12 }}>
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
              onClick={submit}
              disabled={!selectedId || busy || !!done}
              icon={busy ? <Spinner size="tiny" /> : undefined}
            >
              {busy ? "Appending…" : done ? "Done" : "Append"}
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
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
      const html = await getBody("html");
      let attachments: HaloAttachmentInline[] = [];
      let attachWarning: string | undefined;
      if (includeAttachments && attachmentCount > 0) {
        const fetched = await fetchAllAttachments();
        attachments = fetched.attachments.map(toHaloAttachment);
        if (fetched.errors.length > 0) {
          attachWarning = `Some attachments couldn't be included: ${fetched.errors.join("; ")}`;
        }
      }

      const ticket = await createTicket({
        summary,
        details: html,
        client_id: client?.id,
        user_id: contact?.id,
        tickettype_id: ticketTypeId,
        attachments: attachments.length ? attachments : undefined,
        emailfrom: email.senderEmail,
        emailfromname: email.senderName,
        emailsubject: email.subject,
        internetmessageid: email.internetMessageId,
        inreplyto: email.inReplyTo,
        references: email.references.length ? email.references.join(" ") : undefined,
      });

      // Remember selected ticket type as the new default
      if (ticketTypeId) {
        await setDefaults({ ...getDefaults(), defaultTicketTypeId: ticketTypeId });
      }

      if (attachWarning) {
        onResult("warning", `Created #${ticket.id}, but: ${attachWarning}`);
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

            <div style={{ marginTop: 12 }}>
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

function toHaloAttachment(f: FetchedAttachment): HaloAttachmentInline {
  return {
    filename: f.filename,
    data_base64: f.base64,
    contenttype: f.contentType,
    isimage: f.contentType.startsWith("image/"),
  };
}
