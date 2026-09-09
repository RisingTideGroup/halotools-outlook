import { useEffect, useState, useCallback } from "react";
import { Text, Spinner } from "@fluentui/react-components";
import { ConfigScreen } from "../components/ConfigScreen";
import { AuthScreen } from "../components/AuthScreen";
import { getConfig, isAuthenticated, getClientCache } from "@iusehalo/halo-api";
import { useComposeStyles } from "./styles";
import { TimerChip } from "./TimerChip";
import { LogOnSendCard } from "./LogOnSendCard";
import { InsertTools } from "./InsertTools";

// Compose-mode task pane. Layout, top to bottom:
//   1. Header — brand + timer / charge-rate chips (TimerChip.tsx)
//   2. "Log on send" card — staged target, Append / Create, recipients (LogOnSendCard.tsx)
//   3. Insert tools — Canned text / Ticket link / KB article tabs (InsertTools.tsx)

type Phase = "loading" | "needs-config" | "needs-auth" | "ready";

export function ComposeApp() {
  const styles = useComposeStyles();
  const [phase, setPhase] = useState<Phase>("loading");

  const refreshPhase = useCallback(async () => {
    if (!getConfig()) { setPhase("needs-config"); return; }
    if (!isAuthenticated()) { setPhase("needs-auth"); return; }
    // Warm ClientCache before rendering the ready UI so synchronous reads like
    // getChargeRates() find data already in the cache when sections mount.
    try { await getClientCache(); } catch { /* non-fatal; charge rates degrade to No Charge */ }
    setPhase("ready");
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
        <TimerChip />
      </div>
      <div className={styles.body}>
        <LogOnSendCard />
        <InsertTools />
      </div>
    </div>
  );
}
