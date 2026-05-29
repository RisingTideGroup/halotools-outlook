import { useEffect, useState } from "react";
import {
  Text,
  Spinner,
  Button,
  makeStyles,
  tokens,
  Avatar,
} from "@fluentui/react-components";
import type { HaloUser, HaloClient, HaloFeedItem } from "@iusehalo/halo-api";
import { listFeed } from "@iusehalo/halo-api";
import { htmlToText } from "../lib/html";

interface Props {
  contact?: HaloUser;
  client?: HaloClient;
}

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
  row: {
    display: "flex",
    gap: "8px",
    padding: "8px 4px",
    borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
    alignItems: "flex-start",
  },
  body: {
    flex: 1,
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    gap: "2px",
  },
  headerRow: {
    display: "flex",
    alignItems: "baseline",
    gap: "6px",
    justifyContent: "space-between",
  },
  actor: {
    fontSize: tokens.fontSizeBase200,
    fontWeight: tokens.fontWeightSemibold,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  when: {
    fontSize: tokens.fontSizeBase100,
    color: tokens.colorNeutralForeground3,
    flexShrink: 0,
  },
  note: {
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground2,
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
  },
  outcomeTag: {
    display: "inline-block",
    padding: "1px 6px",
    fontSize: tokens.fontSizeBase100,
    color: tokens.colorNeutralForeground3,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusSmall,
    marginRight: "4px",
  },
  showMore: {
    alignSelf: "flex-start",
    marginTop: "4px",
  },
});

const INITIAL_LIMIT = 5;

export function ActivityFeed({ contact, client }: Props) {
  const styles = useStyles();
  const [items, setItems] = useState<HaloFeedItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!contact && !client) {
      setItems([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(undefined);
    // Prefer the user-scoped feed; if no contact matched, fall back to client.
    const scope = contact ? { user_id: contact.id } : { client_id: client!.id };
    listFeed(scope, 20)
      .then((data) => {
        if (!cancelled) setItems(data);
      })
      .catch((e) => {
        if (!cancelled) setError((e as Error).message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [contact?.id, client?.id]);

  const visible = expanded ? items : items.slice(0, INITIAL_LIMIT);

  return (
    <div className={styles.root}>
      <Text className={styles.label}>Recent activity</Text>
      {loading && (
        <div>
          <Spinner size="extra-tiny" />{" "}
          <Text size={200}>Loading activity…</Text>
        </div>
      )}
      {!loading && error && (
        <Text className={styles.empty}>Couldn't load: {error}</Text>
      )}
      {!loading && !error && items.length === 0 && (
        <Text className={styles.empty}>No recent activity.</Text>
      )}
      {visible.map((item) => (
        <FeedRow key={item.id} item={item} />
      ))}
      {items.length > INITIAL_LIMIT && (
        <Button
          size="small"
          appearance="subtle"
          className={styles.showMore}
          onClick={() => setExpanded((e) => !e)}
        >
          {expanded ? "Show less" : `Show ${items.length - INITIAL_LIMIT} more`}
        </Button>
      )}
    </div>
  );
}

function FeedRow({ item }: { item: HaloFeedItem }) {
  const styles = useStyles();
  const when = relativeTime(item.datetime);
  const actor = item.who_name?.trim() || "System";
  // Strip HTML if Halo gave us a rich note; the feed primarily renders text.
  const note = htmlToText(item.note || "");

  return (
    <div className={styles.row}>
      <Avatar
        name={actor}
        size={28}
        color={item.who_colour ? undefined : "colorful"}
        style={item.who_colour ? { backgroundColor: item.who_colour } : undefined}
        image={item.who_imgpath ? { src: item.who_imgpath } : undefined}
      />
      <div className={styles.body}>
        <div className={styles.headerRow}>
          <Text className={styles.actor}>{actor}</Text>
          <Text className={styles.when}>{when}</Text>
        </div>
        <div>
          {item.outcome && (
            <span className={styles.outcomeTag}>{item.outcome}</span>
          )}
          {note && <Text className={styles.note}>{note}</Text>}
          {!note && !item.outcome && (
            <Text className={styles.note} style={{ fontStyle: "italic" }}>
              (no details)
            </Text>
          )}
        </div>
      </div>
    </div>
  );
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const diffMs = Date.now() - then;
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  const mo = Math.floor(day / 30);
  if (mo < 12) return `${mo}mo ago`;
  return new Date(iso).toLocaleDateString();
}
