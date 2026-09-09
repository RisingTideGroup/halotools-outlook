import { useEffect, useState } from "react";
import {
  Button,
  Combobox,
  Field,
  Option,
  Popover,
  PopoverSurface,
  PopoverTrigger,
  Tooltip,
  mergeClasses,
} from "@fluentui/react-components";
import {
  Pause12Regular,
  Play12Regular,
  ChevronDown12Regular,
  ArrowReset20Regular,
} from "@fluentui/react-icons";
import { getChargeRates, type HaloChargeRate } from "@iusehalo/halo-api";
import { useComposeStyles } from "./styles";

// ---------- Timer ----------
//
// Live MM:SS counter that auto-starts when the compose pane opens and
// persists across pane close/reopen via custom properties on the draft.
// Capped at 30 minutes (display freezes; accumulation stops) so a
// forgotten draft doesn't poison the time entry.
//
// On send, launchevent.js reads haloComposeTimeSeconds and
// haloComposeChargeRateId from the draft's custom properties and stamps
// them as time_taken (decimal hours) and chargerate_id on the action.
//
// Rendered as two compact header chips: the timer (click = pause/resume)
// and the charge rate (click = popover with the Charge rate Combobox and
// the Reset button).

const TIMER_TIME_PROP = "haloComposeTimeSeconds";
const TIMER_RUNNING_PROP = "haloComposeTimerRunning";
const CHARGE_RATE_PROP = "haloComposeChargeRateId";
const TIMER_CAP_SECONDS = 30 * 60;
const TIMER_PERSIST_INTERVAL_SECONDS = 5;
const TIMER_CAP_HINT =
  "Capped at 30:00 — a single email shouldn't bill more than half an hour.";

function formatMMSS(seconds: number): string {
  const capped = Math.min(seconds, TIMER_CAP_SECONDS);
  const m = Math.floor(capped / 60);
  const s = capped % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function TimerChip() {
  const styles = useComposeStyles();
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
  const rateName = selectedRate?.name ?? "No Charge";

  const timerButton = (
    <Button
      appearance="outline"
      size="small"
      shape="circular"
      icon={running ? <Pause12Regular /> : <Play12Regular />}
      aria-label={running ? "Pause timer" : "Resume timer"}
      title={capped ? undefined : running ? "Pause timer" : "Resume timer"}
      className={mergeClasses(styles.chip, styles.timerChip, capped && styles.timerChipCapped)}
      onClick={togglePause}
    >
      {formatMMSS(seconds)}
    </Button>
  );

  return (
    <div className={styles.headerRight}>
      {capped ? (
        <Tooltip content={TIMER_CAP_HINT} relationship="description" withArrow>
          {timerButton}
        </Tooltip>
      ) : (
        timerButton
      )}

      <Popover positioning="below-end" withArrow>
        <PopoverTrigger disableButtonEnhancement>
          <Button
            appearance="outline"
            size="small"
            shape="circular"
            icon={<ChevronDown12Regular />}
            iconPosition="after"
            className={styles.chip}
            aria-label={`Charge rate: ${rateName}. Open timer options`}
          >
            <span className={styles.chipText}>{rateName}</span>
          </Button>
        </PopoverTrigger>
        <PopoverSurface className={styles.popoverSurface}>
          <Field label="Charge rate">
            <Combobox
              inlinePopup
              value={rateName}
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
          {capped && <span className={styles.hint}>{TIMER_CAP_HINT}</span>}
          <div className={styles.popoverActions}>
            <Button
              appearance="subtle"
              size="small"
              icon={<ArrowReset20Regular />}
              aria-label="Reset timer"
              onClick={reset}
            >
              Reset timer
            </Button>
          </div>
        </PopoverSurface>
      </Popover>
    </div>
  );
}
