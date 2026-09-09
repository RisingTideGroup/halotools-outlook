import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  Text,
  makeStyles,
  tokens,
  Avatar,
  Badge,
  Tag,
  Link,
  Tooltip,
  Skeleton,
  SkeletonItem,
  MessageBar,
  MessageBarBody,
  MessageBarTitle,
  Button,
  Menu,
  MenuTrigger,
  MenuList,
  MenuItem,
  MenuPopover,
  MenuDivider,
  Dialog,
  DialogTrigger,
  DialogSurface,
  DialogBody,
  DialogTitle,
  DialogContent,
  DialogActions,
  Field,
  Input,
  Combobox,
  Option,
  Spinner,
} from "@fluentui/react-components";
import {
  PersonAdd24Regular,
  MoreVertical16Regular,
  Search16Regular,
  Open16Regular,
  Note16Regular,
} from "@fluentui/react-icons";
import type { HaloUser, HaloClient } from "@iusehalo/halo-api";
import { getConfig } from "@iusehalo/halo-api";
import { domainOf, openExternalUrl, type EmailContext } from "../lib/office";
import { SearchPicker, type PickerItem } from "./SearchPicker";
import { LogNoteDialog } from "./LogNoteDialog";
import {
  searchClients,
  searchUsers,
  getClientDetails,
  getContactStats,
  createContact,
} from "@iusehalo/halo-api";

const useStyles = makeStyles({
  root: {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
  },
  header: {
    display: "flex",
    gap: "10px",
    alignItems: "center",
  },
  identity: {
    display: "flex",
    flexDirection: "column",
    gap: "2px",
    flex: 1,
    minWidth: 0,
  },
  nameRow: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    minWidth: 0,
  },
  name: {
    fontWeight: tokens.fontWeightSemibold,
    fontSize: tokens.fontSizeBase300,
    lineHeight: tokens.lineHeightBase300,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    minWidth: 0,
  },
  directionBadge: {
    flexShrink: 0,
  },
  subLine: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    fontSize: tokens.fontSizeBase200,
    lineHeight: tokens.lineHeightBase200,
    color: tokens.colorNeutralForeground3,
    minWidth: 0,
  },
  subText: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    minWidth: 0,
  },
  clientLink: {
    fontSize: tokens.fontSizeBase200,
    lineHeight: tokens.lineHeightBase200,
    fontWeight: tokens.fontWeightSemibold,
    flexShrink: 0,
    maxWidth: "60%",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  quietLink: {
    color: "inherit",
    textDecoration: "none",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    minWidth: 0,
    ":hover": { textDecoration: "underline", color: tokens.colorBrandForeground1 },
  },
  dot: {
    color: tokens.colorNeutralForeground4,
    flexShrink: 0,
  },
  tagsRow: {
    display: "flex",
    flexWrap: "nowrap",
    gap: "4px",
    overflow: "hidden",
    minWidth: 0,
  },
  menu: {
    flexShrink: 0,
    alignSelf: "flex-start",
    marginRight: "-6px",
  },
  stats: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    fontSize: tokens.fontSizeBase200,
    lineHeight: tokens.lineHeightBase200,
    color: tokens.colorNeutralForeground2,
    flexWrap: "wrap",
    padding: "4px 8px",
    backgroundColor: tokens.colorNeutralBackground2,
    borderRadius: tokens.borderRadiusMedium,
  },
  actions: {
    display: "flex",
    gap: "4px",
    flexWrap: "wrap",
  },
  skeletonStats: {
    display: "flex",
    gap: "10px",
    alignItems: "center",
    flex: 1,
  },
  /** Keeps a SearchPicker mounted (so its dialog can be opened from the menu)
   *  without rendering its trigger button in the layout. */
  hiddenTrigger: {
    position: "absolute",
    width: "0px",
    height: "0px",
    overflow: "hidden",
    visibility: "hidden",
  },
  dialogForm: {
    display: "flex",
    flexDirection: "column",
    gap: "10px",
    minWidth: "320px",
  },
});

interface Props {
  email: EmailContext;
  contact?: HaloUser;
  client?: HaloClient;
  onContactChange: (contact: HaloUser | undefined) => void;
  onClientChange: (client: HaloClient | undefined) => void;
}

export function ContactCard({
  email,
  contact,
  client,
  onContactChange,
  onClientChange,
}: Props) {
  const styles = useStyles();
  const haloUrl = getConfig()?.haloBaseUrl;
  // Direction-aware: for sent items, the "customer" represented in this card
  // is the recipient, not the agent. customerEmail/Name flip automatically.
  const displayName = contact?.name || email.customerName || email.customerEmail;
  const domain = domainOf(email.customerEmail);
  const contactEmail = contact?.emailaddress || email.customerEmail;
  const phone = contact?.phonenumber || contact?.mobile_number;
  const siteName = contact?.site_name;
  const tags = contact?.tags?.filter((t) => t.value) ?? [];

  // Stats: open tickets + last activity. Loaded async per matched contact.
  const [stats, setStats] = useState<
    { openTicketCount: number; lastActivityAt?: string } | undefined
  >(undefined);
  const [statsLoading, setStatsLoading] = useState(false);

  useEffect(() => {
    if (!contact) {
      setStats(undefined);
      setStatsLoading(false);
      return;
    }
    let cancelled = false;
    setStatsLoading(true);
    getContactStats(contact.id)
      .then((s) => {
        if (!cancelled) setStats(s);
      })
      .catch(() => {
        if (!cancelled) setStats({ openTicketCount: 0 });
      })
      .finally(() => {
        if (!cancelled) setStatsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [contact?.id]);

  // Pull full client details (for account manager + tags) only if we don't already have them.
  // Skip if the client object already carries an accountmanager_name (i.e. came from getClientDetails).
  const [clientDetails, setClientDetails] = useState<HaloClient | undefined>(undefined);
  useEffect(() => {
    if (!client) {
      setClientDetails(undefined);
      return;
    }
    if (client.accountmanager_name !== undefined) {
      setClientDetails(client);
      return;
    }
    let cancelled = false;
    getClientDetails(client.id)
      .then((c) => {
        if (!cancelled) setClientDetails(c);
      })
      .catch(() => {
        /* swallow — account manager line is decorative */
      });
    return () => {
      cancelled = true;
    };
  }, [client?.id]);

  const accountManager = clientDetails?.accountmanager_name;

  const lastActivityText = useMemo(
    () => formatLastActivity(stats?.lastActivityAt),
    [stats?.lastActivityAt],
  );

  // Site + contact tags render inline only when they fit on one line; when
  // they'd overflow the 320px pane they move into a tooltip on the client name.
  const tagsKey = [siteName ?? "", ...tags.map((t) => t.value)].join("|");
  const tagsRowRef = useRef<HTMLDivElement>(null);
  const [tagsOverflow, setTagsOverflow] = useState(false);
  // Two-phase: whenever the tag set changes, render the row again, then measure
  // it before paint and pull it out if it overflows.
  useLayoutEffect(() => {
    setTagsOverflow(false);
  }, [tagsKey]);
  useLayoutEffect(() => {
    const el = tagsRowRef.current;
    if (el && el.scrollWidth > el.clientWidth + 1) setTagsOverflow(true);
  });
  const hasTags = !!siteName || tags.length > 0;
  const tagsTooltip = hasTags
    ? [siteName ? `Site: ${siteName}` : "", tags.length ? `Tags: ${tags.map((t) => t.value).join(", ")}` : ""]
        .filter(Boolean)
        .join(" · ")
    : "";

  // Hidden SearchPicker triggers, opened from the ⋮ menu.
  const changeContactRef = useRef<HTMLDivElement>(null);
  const changeClientRef = useRef<HTMLDivElement>(null);
  const clickHidden = (ref: typeof changeContactRef) =>
    ref.current?.querySelector("button")?.click();

  const [noteOpen, setNoteOpen] = useState(false);

  const openHalo = (path: string) => {
    if (!haloUrl) return;
    const url = `${haloUrl}${path}`;
    if (!openExternalUrl(url)) {
      // Outlook blocked both popup methods — copy the URL so the agent can
      // paste it themselves. Never navigate the task pane to the target; sites
      // that set X-Frame-Options will refuse to render and the pane goes blank.
      navigator.clipboard?.writeText(url).catch(() => {});
    }
  };

  const pickContact = (u: HaloUser) => {
    onContactChange(u);
    if (u.client_id && u.client_name) {
      onClientChange({ id: u.client_id, name: u.client_name });
    }
  };
  const searchContacts = async (q: string) => {
    const users = await searchUsers(q);
    return users.map<PickerItem<HaloUser>>((u) => ({
      key: u.id,
      primary: u.name,
      secondary: [u.emailaddress, u.client_name].filter(Boolean).join(" · "),
      value: u,
    }));
  };

  const clientNameEl = client ? (
    haloUrl ? (
      <Link
        className={styles.clientLink}
        title={tagsOverflow ? undefined : `Open ${client.name} in HaloPSA`}
        onClick={() => openHalo(`/customer?clientid=${client.id}`)}
      >
        {client.name}
      </Link>
    ) : (
      <Text className={styles.clientLink}>{client.name}</Text>
    )
  ) : null;

  return (
    <div className={styles.root}>
      {/* Header: avatar · name + direction · client · email · phone/title · ⋮ */}
      <div className={styles.header}>
        <Avatar name={displayName} color="colorful" size={32} />
        <div className={styles.identity}>
          <div className={styles.nameRow}>
            <Text className={styles.name} title={displayName}>
              {displayName}
            </Text>
            {/* Direction badge: makes clear when viewing a sent item that
                the card is showing the recipient, not the agent. */}
            <Badge
              appearance="outline"
              color={email.direction === "outgoing" ? "informative" : "subtle"}
              size="small"
              className={styles.directionBadge}
            >
              {email.direction === "outgoing" ? "Sent to" : "From"}
            </Badge>
          </div>

          <div className={styles.subLine}>
            {clientNameEl &&
              (tagsOverflow && tagsTooltip ? (
                <Tooltip content={tagsTooltip} relationship="description" withArrow>
                  {clientNameEl}
                </Tooltip>
              ) : (
                clientNameEl
              ))}
            {clientNameEl && <span className={styles.dot}>·</span>}
            <a className={styles.quietLink} href={`mailto:${contactEmail}`} title={contactEmail}>
              {contactEmail}
            </a>
          </div>

          {(phone || contact?.jobtitle) && (
            <div className={styles.subLine}>
              {phone && (
                <a className={styles.quietLink} href={`tel:${phone}`}>
                  {phone}
                </a>
              )}
              {phone && contact?.jobtitle && <span className={styles.dot}>·</span>}
              {contact?.jobtitle && (
                <span className={styles.subText} title={contact.jobtitle}>
                  {contact.jobtitle}
                </span>
              )}
            </div>
          )}

          {hasTags && !tagsOverflow && (
            <div className={styles.tagsRow} ref={tagsRowRef}>
              {siteName && (
                <Tag appearance="outline" size="extra-small" shape="rounded">
                  {siteName}
                </Tag>
              )}
              {tags.map((t, i) => (
                <Tag key={`${t.value}-${i}`} size="extra-small" shape="circular">
                  {t.value}
                </Tag>
              ))}
            </div>
          )}
        </div>

        <Menu>
          <MenuTrigger disableButtonEnhancement>
            <Button
              appearance="subtle"
              size="small"
              icon={<MoreVertical16Regular />}
              aria-label="Contact actions"
              className={styles.menu}
            />
          </MenuTrigger>
          <MenuPopover>
            <MenuList>
              {contact && (
                <MenuItem
                  icon={<Search16Regular />}
                  onClick={() => clickHidden(changeContactRef)}
                >
                  Change contact…
                </MenuItem>
              )}
              <MenuItem
                icon={<Search16Regular />}
                onClick={() => clickHidden(changeClientRef)}
              >
                Change client…
              </MenuItem>
              {haloUrl && (contact || client) && <MenuDivider />}
              {haloUrl && contact && (
                <MenuItem
                  icon={<Open16Regular />}
                  onClick={() => openHalo(`/customer?userid=${contact.id}`)}
                >
                  Open contact in HaloPSA
                </MenuItem>
              )}
              {haloUrl && client && (
                <MenuItem
                  icon={<Open16Regular />}
                  onClick={() => openHalo(`/customer?clientid=${client.id}`)}
                >
                  Open client in HaloPSA
                </MenuItem>
              )}
              {(contact || client) && (
                <>
                  <MenuDivider />
                  <MenuItem icon={<Note16Regular />} onClick={() => setNoteOpen(true)}>
                    Log note…
                  </MenuItem>
                </>
              )}
            </MenuList>
          </MenuPopover>
        </Menu>
      </div>

      {/* Unmatched callout with primary actions */}
      {!contact && (
        <MessageBar intent="warning">
          <MessageBarBody>
            <MessageBarTitle>No matching contact in HaloPSA</MessageBarTitle>{" "}
            {email.customerEmail} isn't linked to a contact yet.
          </MessageBarBody>
        </MessageBar>
      )}
      {!contact && (
        <div className={styles.actions}>
          <SearchPicker<HaloUser>
            triggerLabel="Find contact"
            triggerAppearance="primary"
            title="Find contact in HaloPSA"
            initialQuery={email.customerEmail}
            onSearch={searchContacts}
            onPick={pickContact}
          />
          <CreateContactDialog
            email={email}
            prefilledClient={client}
            onCreated={(newContact, newClient) => {
              onContactChange(newContact);
              if (newClient) onClientChange(newClient);
            }}
          />
        </div>
      )}

      {/* Stats strip — only when a contact is matched */}
      {contact && (
        <div className={styles.stats}>
          {statsLoading ? (
            <Skeleton className={styles.skeletonStats}>
              <SkeletonItem size={12} style={{ width: "30%" }} />
              <SkeletonItem size={12} style={{ width: "35%" }} />
              <SkeletonItem size={12} style={{ width: "30%" }} />
            </Skeleton>
          ) : (
            <>
              <Text size={200}>
                {stats?.openTicketCount ?? 0} open{" "}
                {stats?.openTicketCount === 1 ? "ticket" : "tickets"}
              </Text>
              <span className={styles.dot}>·</span>
              <Text size={200}>Last activity {lastActivityText}</Text>
              {accountManager && (
                <>
                  <span className={styles.dot}>·</span>
                  <Text size={200}>AM: {accountManager}</Text>
                </>
              )}
            </>
          )}
        </div>
      )}

      {/* Override pickers, triggered from the ⋮ menu. Their trigger buttons are
          hidden; the dialogs themselves render in a portal. */}
      {contact && (
        <div className={styles.hiddenTrigger} ref={changeContactRef} aria-hidden>
          <SearchPicker<HaloUser>
            triggerLabel="Change contact"
            triggerAppearance="subtle"
            title="Find contact in HaloPSA"
            initialQuery={email.customerEmail}
            onSearch={searchContacts}
            onPick={pickContact}
          />
        </div>
      )}
      <div className={styles.hiddenTrigger} ref={changeClientRef} aria-hidden>
        <SearchPicker<HaloClient>
          triggerLabel="Change client"
          triggerAppearance="subtle"
          title="Find client in HaloPSA"
          initialQuery={domain}
          onSearch={async (q) => {
            const clients = await searchClients(q);
            return clients.map<PickerItem<HaloClient>>((c) => ({
              key: c.id,
              primary: c.name,
              value: c,
            }));
          }}
          onPick={(c) => {
            onClientChange(c);
            if (contact && contact.client_id && contact.client_id !== c.id) {
              onContactChange(undefined);
            }
          }}
        />
      </div>

      <LogNoteDialog
        open={noteOpen}
        contact={contact}
        client={client}
        onClose={() => setNoteOpen(false)}
      />
    </div>
  );
}

// ---------- Create contact dialog ----------

interface CreateContactDialogProps {
  email: EmailContext;
  prefilledClient?: HaloClient;
  onCreated: (contact: HaloUser, client?: HaloClient) => void;
}

function CreateContactDialog({
  email,
  prefilledClient,
  onCreated,
}: CreateContactDialogProps) {
  const styles = useStyles();
  const [open, setOpen] = useState(false);

  // Form fields
  const [name, setName] = useState("");
  const [emailAddr, setEmailAddr] = useState("");
  const [phone, setPhone] = useState("");
  const [selectedClient, setSelectedClient] = useState<HaloClient | undefined>(undefined);

  // Client search for combobox
  const [clientQuery, setClientQuery] = useState("");
  const [clientOptions, setClientOptions] = useState<HaloClient[]>([]);
  const [clientLoading, setClientLoading] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | undefined>();

  // Reset & prefill on open
  useEffect(() => {
    if (!open) return;
    setName(email.customerName || "");
    setEmailAddr(email.customerEmail || "");
    setPhone("");
    setSelectedClient(prefilledClient);
    setClientQuery(prefilledClient?.name ?? "");
    setClientOptions(prefilledClient ? [prefilledClient] : []);
    setError(undefined);
    setSubmitting(false);
  }, [open, email.customerEmail, email.customerName, prefilledClient?.id]);

  // Debounced client search
  useEffect(() => {
    if (!open) return;
    if (clientQuery.trim().length < 2) {
      setClientOptions(selectedClient ? [selectedClient] : []);
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      setClientLoading(true);
      try {
        const res = await searchClients(clientQuery.trim());
        if (!cancelled) setClientOptions(res);
      } catch {
        /* leave list as-is */
      } finally {
        if (!cancelled) setClientLoading(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [clientQuery, open]);

  const handleSubmit = async () => {
    if (!name.trim() || !emailAddr.trim()) {
      setError("Name and email are required.");
      return;
    }
    if (!selectedClient) {
      setError("Pick a client first — Halo requires one for new contacts.");
      return;
    }
    setSubmitting(true);
    setError(undefined);
    try {
      // Halo requires a site_id alongside client_id when creating a user.
      // The client list response doesn't include main_site_id, so resolve it
      // via the client-detail endpoint right before the create call.
      let siteId = selectedClient.main_site_id;
      if (siteId == null) {
        try {
          const detail = await getClientDetails(selectedClient.id);
          siteId = detail.main_site_id;
        } catch {
          /* fall through; Halo will reject and surface its own error */
        }
      }
      const created = await createContact({
        name: name.trim(),
        emailaddress: emailAddr.trim(),
        client_id: selectedClient.id,
        site_id: siteId,
        phonenumber: phone.trim() || undefined,
      });
      // Halo's response may not echo back client_name; fill from local selection.
      if (selectedClient && !created.client_name) {
        created.client_name = selectedClient.name;
        created.client_id = selectedClient.id;
      }
      onCreated(created, selectedClient);
      setOpen(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(_, d) => setOpen(d.open)}>
      <DialogTrigger disableButtonEnhancement>
        <Button appearance="primary" size="small" icon={<PersonAdd24Regular />}>
          Create contact in Halo
        </Button>
      </DialogTrigger>
      <DialogSurface>
        <DialogBody>
          <DialogTitle>Create contact in HaloPSA</DialogTitle>
          <DialogContent>
            <div className={styles.dialogForm}>
              <Field label="Name" required>
                <Input
                  value={name}
                  onChange={(_, d) => setName(d.value)}
                  autoFocus
                />
              </Field>
              <Field label="Email" required>
                <Input
                  value={emailAddr}
                  type="email"
                  onChange={(_, d) => setEmailAddr(d.value)}
                />
              </Field>
              <Field label="Client">
                <Combobox
                  freeform
                  value={clientQuery}
                  selectedOptions={
                    selectedClient ? [String(selectedClient.id)] : []
                  }
                  placeholder="Search clients…"
                  onInput={(e) =>
                    setClientQuery((e.target as HTMLInputElement).value)
                  }
                  onOptionSelect={(_, d) => {
                    const id = d.optionValue ? Number(d.optionValue) : undefined;
                    const found = clientOptions.find((c) => c.id === id);
                    setSelectedClient(found);
                    if (found) setClientQuery(found.name);
                  }}
                >
                  {clientLoading && (
                    <Option value="__loading" disabled text="Searching…">
                      Searching…
                    </Option>
                  )}
                  {!clientLoading && clientOptions.length === 0 && (
                    <Option value="__empty" disabled text="No matches">
                      No matches
                    </Option>
                  )}
                  {clientOptions.map((c) => (
                    <Option key={c.id} value={String(c.id)} text={c.name}>
                      {c.name}
                    </Option>
                  ))}
                </Combobox>
              </Field>
              <Field label="Phone (optional)">
                <Input
                  value={phone}
                  type="tel"
                  onChange={(_, d) => setPhone(d.value)}
                />
              </Field>
              {error && (
                <Text size={200} style={{ color: tokens.colorPaletteRedForeground1 }}>
                  {error}
                </Text>
              )}
            </div>
          </DialogContent>
          <DialogActions>
            <Button
              appearance="secondary"
              onClick={() => setOpen(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button
              appearance="primary"
              onClick={handleSubmit}
              disabled={submitting || !name.trim() || !emailAddr.trim()}
              icon={submitting ? <Spinner size="tiny" /> : undefined}
            >
              {submitting ? "Creating…" : "Create"}
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}

// ---------- helpers ----------

function formatLastActivity(iso?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  const diffMs = Date.now() - d.getTime();
  const day = 24 * 60 * 60 * 1000;
  const days = Math.floor(diffMs / day);
  if (days <= 0) {
    const hours = Math.floor(diffMs / (60 * 60 * 1000));
    if (hours <= 0) return "just now";
    return `${hours}h ago`;
  }
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}
