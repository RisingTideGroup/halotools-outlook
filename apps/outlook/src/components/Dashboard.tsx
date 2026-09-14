import { useEffect, useState, useCallback } from "react";
import {
  Text,
  Spinner,
  makeStyles,
  tokens,
  Divider,
  Button,
  MessageBar,
  MessageBarBody,
  Menu,
  MenuTrigger,
  MenuList,
  MenuItem,
  MenuPopover,
} from "@fluentui/react-components";
import {
  MoreHorizontal24Regular,
  ArrowClockwise24Regular,
} from "@fluentui/react-icons";
import { ContactCard } from "./ContactCard";
import { RelatedTickets } from "./RelatedTickets";
import { LogActions } from "./LogActions";
import { SettingsScreen } from "./SettingsScreen";
import { ActivityFeed } from "./ActivityFeed";
import { UpdateBanner } from "./UpdateBanner";
import {
  findUserByEmail,
  findClientByDomain,
  listOpenTicketsForClient,
  listOpenOpportunitiesForClient,
  findTicketsForEmail,
  findTicketBySubjectTag,
} from "@iusehalo/halo-api";
import { signOut } from "@iusehalo/halo-api";
import { clearConfig, getCachedClientCache } from "@iusehalo/halo-api";
import { domainOf, type EmailContext } from "../lib/office";
import { setDiagContext } from "../lib/diagnostics";
import type { HaloUser, HaloClient, HaloTicket } from "@iusehalo/halo-api";

interface Props {
  email: EmailContext;
  onSignedOut: () => void;
}

const useStyles = makeStyles({
  root: {
    display: "flex",
    flexDirection: "column",
    height: "100%",
    overflowY: "auto",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "8px 12px",
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  body: {
    display: "flex",
    flexDirection: "column",
    gap: "12px",
    padding: "12px",
    flex: 1,
  },
  loading: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    flex: 1,
    gap: "8px",
  },
  brand: {
    fontWeight: tokens.fontWeightSemibold,
    fontSize: tokens.fontSizeBase300,
  },
  brandColumn: {
    display: "flex",
    flexDirection: "column",
    minWidth: 0,
  },
  agentLine: {
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground3,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
});

export function Dashboard({ email, onSignedOut }: Props) {
  const styles = useStyles();
  const [contact, setContact] = useState<HaloUser | undefined>();
  const [client, setClient] = useState<HaloClient | undefined>();
  const [openTickets, setOpenTickets] = useState<HaloTicket[]>([]);
  /** Ids Halo returned under domain=opportunities for the active client. */
  const [opportunityIds, setOpportunityIds] = useState<ReadonlySet<number>>(() => new Set());
  const [threadTickets, setThreadTickets] = useState<HaloTicket[]>([]);
  const [error, setError] = useState<string | undefined>();
  const [loadingResolve, setLoadingResolve] = useState(true);
  const [loadingTickets, setLoadingTickets] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Auto-resolve sender → contact + client whenever the open email changes.
  // Refresh button bumps `refreshTick` to trigger a re-run.
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoadingResolve(true);
    setError(undefined);
    setContact(undefined);
    setClient(undefined);
    setOpenTickets([]);
    setThreadTickets([]);

    (async () => {
      try {
        // For sent items / drafts, customerEmail is the recipient (the other
        // party); for inbox messages it's the sender. Looking up the agent's
        // own address against findUserByEmail would return nothing.
        const matchedContact = await findUserByEmail(email.customerEmail);
        if (cancelled) return;

        let matchedClient: HaloClient | undefined;
        if (matchedContact?.client_id) {
          matchedClient = {
            id: matchedContact.client_id,
            name: matchedContact.client_name ?? "",
          };
        } else {
          // Domain comes from the customer's email — for outgoing this is
          // the recipient's domain, not the agent's tenant domain.
          const domain = domainOf(email.customerEmail);
          if (domain) matchedClient = await findClientByDomain(domain);
        }
        if (cancelled) return;

        setContact(matchedContact);
        setClient(matchedClient);
        setDiagContext("resolve", {
          customerEmail: email.customerEmail,
          direction: email.direction,
          contact: matchedContact
            ? { id: matchedContact.id, name: matchedContact.name, client_id: matchedContact.client_id }
            : null,
          client: matchedClient ? { id: matchedClient.id, name: matchedClient.name } : null,
          via: matchedContact?.client_id ? "contact.client_id" : "client search by domain",
        });

        const threadIds = [
          email.internetMessageId,
          email.inReplyTo,
          ...email.references,
        ].filter((id): id is string => !!id);

        // Run RFC Message-ID and subject-tag lookups in parallel; merge + dedup.
        const rfcPromise: Promise<HaloTicket[]> = threadIds.length > 0
          ? findTicketsForEmail(threadIds).catch(() => [])
          : Promise.resolve([]);
        const tagPromise: Promise<HaloTicket[]> = findTicketBySubjectTag(email.subject)
          .then((t) => (t ? [t] : []))
          .catch(() => []);

        Promise.all([rfcPromise, tagPromise]).then(([rfc, tag]) => {
          if (cancelled) return;
          const seen = new Set<number>();
          const merged = [...rfc, ...tag].filter((t) => !seen.has(t.id) && seen.add(t.id));
          setThreadTickets(merged);
          setDiagContext("threadTickets", { ids: merged.map((t) => t.id), messageIds: threadIds.length });
        });
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      } finally {
        if (!cancelled) setLoadingResolve(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [email.customerEmail, email.internetMessageId, refreshTick]);

  // Refetch open tickets whenever the active client changes (auto or override)
  useEffect(() => {
    if (!client) {
      setOpenTickets([]);
      return;
    }
    let cancelled = false;
    setLoadingTickets(true);
    // Two calls in parallel: the full open list (domain=all) and the
    // opportunities-only list. The second is the authoritative "Sales" set —
    // it doesn't depend on the ticket-type list loading for this agent — and
    // anything in it that the first call missed is unioned in, so an
    // opportunity can't silently disappear from the pane.
    Promise.all([
      listOpenTicketsForClient(client.id),
      listOpenOpportunitiesForClient(client.id).catch((e) => {
        setDiagContext("openOpportunities", { clientId: client.id, error: (e as Error).message });
        return [] as HaloTicket[];
      }),
    ])
      .then(([all, opps]) => {
        if (cancelled) return;
        const seen = new Set(all.map((t) => t.id));
        const merged = [...all, ...opps.filter((t) => !seen.has(t.id))];
        setOpenTickets(merged);
        setOpportunityIds(new Set(opps.map((t) => t.id)));
        setDiagContext("openTickets", {
          clientId: client.id,
          count: merged.length,
          fromDomainAll: all.length,
          fromDomainOpportunities: opps.map((t) => t.id),
          tickets: merged.slice(0, 50).map((x) => ({ id: x.id, type: x.tickettype_id, status: x.status_id })),
        });
      })
      .catch((e) => {
        if (cancelled) return;
        setError((e as Error).message);
        setDiagContext("openTickets", { clientId: client.id, error: (e as Error).message });
      })
      .finally(() => !cancelled && setLoadingTickets(false));
    return () => {
      cancelled = true;
    };
  }, [client?.id]);

  const handleTicketUpdated = useCallback(
    async (updated: HaloTicket) => {
      // Optimistic local update for instant feedback
      setOpenTickets((prev) =>
        prev.map((t) => (t.id === updated.id ? { ...t, ...updated } : t)),
      );
      setThreadTickets((prev) =>
        prev.map((t) => (t.id === updated.id ? { ...t, ...updated } : t)),
      );
      // Then refetch open tickets so status changes (e.g., closed) remove tickets from the list
      if (client) {
        try {
          const [all, opps] = await Promise.all([
            listOpenTicketsForClient(client.id),
            listOpenOpportunitiesForClient(client.id).catch(() => [] as HaloTicket[]),
          ]);
          const seen = new Set(all.map((t) => t.id));
          setOpenTickets([...all, ...opps.filter((t) => !seen.has(t.id))]);
          setOpportunityIds(new Set(opps.map((t) => t.id)));
        } catch {
          /* keep optimistic state */
        }
      }
    },
    [client],
  );

  const handleSignOut = useCallback(async () => {
    await signOut();
    onSignedOut();
  }, [onSignedOut]);

  const handleReconfigure = useCallback(async () => {
    await clearConfig();
    onSignedOut();
  }, [onSignedOut]);

  if (settingsOpen) {
    return (
      <div className={styles.root}>
        <SettingsScreen
          onClose={() => setSettingsOpen(false)}
          onSignOut={handleSignOut}
          onReconfigure={handleReconfigure}
        />
      </div>
    );
  }

  // Exactly one thread-matched ticket → LogActions turns Append into
  // "Append to #<id>" with that ticket preselected.
  const primaryTicket = threadTickets.length === 1 ? threadTickets[0] : undefined;

  return (
    <div className={styles.root}>
      <UpdateBanner />
      <div className={styles.header}>
        <div className={styles.brandColumn}>
          <Text className={styles.brand}>
            {getCachedClientCache()?.control?.license_name ?? "HaloPSA"}
          </Text>
          {(() => {
            const a = getCachedClientCache()?.agent;
            if (!a) return null;
            const subtitle = a.jobtitle ? `${a.name} · ${a.jobtitle}` : a.name;
            return <Text className={styles.agentLine}>{subtitle}</Text>;
          })()}
        </div>
        <div style={{ display: "flex", gap: 4 }}>
          <Button
            appearance="subtle"
            size="small"
            icon={<ArrowClockwise24Regular />}
            onClick={() => setRefreshTick((n) => n + 1)}
            aria-label="Refresh"
            disabled={loadingResolve}
          />
          <Menu>
            <MenuTrigger disableButtonEnhancement>
              <Button
                appearance="subtle"
                size="small"
                icon={<MoreHorizontal24Regular />}
                aria-label="Menu"
              />
            </MenuTrigger>
            <MenuPopover>
              <MenuList>
                <MenuItem onClick={() => setSettingsOpen(true)}>Settings</MenuItem>
                <MenuItem onClick={handleSignOut}>Sign out</MenuItem>
                <MenuItem onClick={handleReconfigure}>Switch HaloPSA tenant</MenuItem>
              </MenuList>
            </MenuPopover>
          </Menu>
        </div>
      </div>

      {loadingResolve && (
        <div className={styles.loading}>
          <Spinner size="small" />
          <Text size={200}>Looking up {email.customerEmail}…</Text>
        </div>
      )}

      {!loadingResolve && error && (
        <div className={styles.body}>
          <MessageBar intent="error">
            <MessageBarBody>{error}</MessageBarBody>
          </MessageBar>
        </div>
      )}

      {!loadingResolve && !error && (
        <div className={styles.body}>
          {/* Compact contact header; overrides / Halo links / Log note live in its ⋮ menu. */}
          <ContactCard
            email={email}
            contact={contact}
            client={client}
            onContactChange={setContact}
            onClientChange={setClient}
          />

          {/* Primary actions sit above the ticket lists so they're always
              visible without scrolling, regardless of how many tickets a
              client has. */}
          <LogActions
            email={email}
            client={client}
            contact={contact}
            candidateTickets={[
              ...threadTickets,
              ...openTickets.filter((t) => !threadTickets.find((tt) => tt.id === t.id)),
            ]}
            preferAppend={threadTickets.length > 0}
            primaryTicket={primaryTicket}
            threadTickets={threadTickets}
          />

          <RelatedTickets
            threadTickets={threadTickets}
            openTickets={openTickets}
            opportunityIds={opportunityIds}
            loading={loadingTickets}
            scopeKey={client?.id}
            onTicketUpdated={handleTicketUpdated}
          />

          {(contact || client) && (
            <>
              <Divider />
              <ActivityFeed contact={contact} client={client} />
            </>
          )}
        </div>
      )}
    </div>
  );
}
