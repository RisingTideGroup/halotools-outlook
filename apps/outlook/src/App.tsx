import { useEffect, useState, useCallback, lazy, Suspense } from "react";
import { makeStyles, tokens, Spinner, Text } from "@fluentui/react-components";
import { ConfigScreen } from "./components/ConfigScreen";
import { AuthScreen } from "./components/AuthScreen";
import { getConfig, getClientCache, onAuthCleared } from "@iusehalo/halo-api";
import { isAuthenticated } from "@iusehalo/halo-api";
import { getCurrentEmailContext, type EmailContext } from "./lib/office";

// Dashboard pulls in the bulk of the UI surface (pickers, dialogs, ticket list, log actions).
// Lazy-load it so first-launch config/auth flows ship a smaller bundle.
const Dashboard = lazy(() =>
  import("./components/Dashboard").then((m) => ({ default: m.Dashboard })),
);

type Phase = "loading" | "needs-config" | "needs-auth" | "ready";

const useStyles = makeStyles({
  root: {
    height: "100%",
    display: "flex",
    flexDirection: "column",
    backgroundColor: tokens.colorNeutralBackground1,
  },
  center: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: "12px",
    padding: "24px",
  },
});

export function App() {
  const styles = useStyles();
  const [phase, setPhase] = useState<Phase>("loading");
  const [email, setEmail] = useState<EmailContext | undefined>(undefined);

  // Compute the current phase from storage state
  const refreshPhase = useCallback(() => {
    if (!getConfig()) setPhase("needs-config");
    else if (!isAuthenticated()) setPhase("needs-auth");
    else {
      setPhase("ready");
      // Warm ClientCache once we're authenticated. Single ~3MB call that
      // gives us the agent record, agents list, mailboxes, control flags —
      // replaces several per-feature round-trips. Failure is non-fatal;
      // downstream code falls back to legacy paths (listAgents etc.).
      getClientCache().catch(() => {
        /* swallow — features that depend on it will fall back */
      });
    }
  }, []);

  // Re-read current email when Outlook selection changes
  const refreshEmail = useCallback(() => {
    getCurrentEmailContext()
      .then((ctx) => setEmail(ctx))
      .catch(() => setEmail(undefined));
  }, []);

  useEffect(() => {
    refreshPhase();
    refreshEmail();

    // Subscribe to item selection changes. Guarded because on an unpinned task pane's
    // very first open, Office.context.mailbox can still be initializing and the
    // addHandler call can throw before pinning establishes a persistent runtime.
    const mailbox = Office.context?.mailbox;
    const handler = () => refreshEmail();
    if (mailbox?.addHandlerAsync) {
      try {
        mailbox.addHandlerAsync(
          Office.EventType.ItemChanged,
          handler,
          (result) => {
            if (result.status !== Office.AsyncResultStatus.Succeeded) {
              console.warn("Failed to subscribe to ItemChanged:", result.error?.message);
            }
          },
        );
      } catch (e) {
        console.warn("ItemChanged subscribe threw:", (e as Error).message);
      }
    }

    return () => {
      try {
        Office.context?.mailbox?.removeHandlerAsync?.(Office.EventType.ItemChanged);
      } catch {
        /* nothing to clean up */
      }
    };
  }, [refreshPhase, refreshEmail]);

  // Flip back to AuthScreen the moment the API layer detects a server-side
  // auth failure and wipes tokens (401 after retry, 403, or a 400 body
  // containing an OAuth invalid/expired-token error). Without this the
  // component that fired the failed call would just render its own
  // MessageBar showing the raw 4xx and the user would be stuck.
  useEffect(() => onAuthCleared(refreshPhase), [refreshPhase]);

  if (phase === "loading") {
    return (
      <div className={styles.root}>
        <div className={styles.center}>
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

  // ready
  if (!email) {
    return (
      <div className={styles.root}>
        <div className={styles.center}>
          <Text>Open a message to see Halo context.</Text>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.root}>
      <Suspense
        fallback={
          <div className={styles.center}>
            <Spinner size="small" />
          </div>
        }
      >
        <Dashboard email={email} onSignedOut={refreshPhase} />
      </Suspense>
    </div>
  );
}
