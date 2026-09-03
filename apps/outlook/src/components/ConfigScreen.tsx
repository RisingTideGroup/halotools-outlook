import { useState } from "react";
import {
  Button,
  Field,
  Input,
  Text,
  makeStyles,
  tokens,
  MessageBar,
  MessageBarBody,
} from "@fluentui/react-components";
import { setConfig } from "@iusehalo/halo-api";

const useStyles = makeStyles({
  root: {
    display: "flex",
    flexDirection: "column",
    gap: "16px",
    padding: "20px",
    height: "100%",
    overflowY: "auto",
  },
  title: {
    fontSize: tokens.fontSizeBase500,
    fontWeight: tokens.fontWeightSemibold,
  },
  helpText: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
  },
  buttonRow: {
    display: "flex",
    gap: "8px",
    marginTop: "8px",
  },
});

interface Props {
  onConfigured: () => void;
}

export function ConfigScreen({ onConfigured }: Props) {
  const styles = useStyles();
  // Derived from where the add-in is actually served so the registration values
  // are correct on prod, a dev deployment, or a self-hosted origin.
  const origin = window.location.origin;
  const [haloUrl, setHaloUrl] = useState("");
  const [clientId, setClientId] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setError(undefined);
    setSaving(true);
    try {
      await setConfig({ haloBaseUrl: haloUrl.trim(), clientId: clientId.trim() });
      onConfigured();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={styles.root}>
      <Text className={styles.title}>Connect to HaloPSA</Text>
      <Text className={styles.helpText}>
        Your HaloPSA administrator should register an Application in Halo Config →
        Integrations → Halo Connect → API, with Authorization Code grant, PKCE enabled, and
        redirect URIs of <strong>{origin}/outlook/auth/callback.html</strong>{" "}
        and <strong>{origin}/auth/callback</strong>{" "}
        (the second is the universal callback shared by Outlook, the MCP server for AI
        assistants, and any future iusehalo tools — register once, never touch again).
        Add <strong>{origin}</strong> to the app's CORS whitelist.
      </Text>

      <Field label="HaloPSA URL" required hint="e.g. https://halo.yourcompany.com">
        <Input
          value={haloUrl}
          onChange={(_, d) => setHaloUrl(d.value)}
          placeholder="https://halo.yourcompany.com"
          autoComplete="off"
        />
      </Field>

      <Field label="Client ID" required hint="From the Halo Connect Application">
        <Input
          value={clientId}
          onChange={(_, d) => setClientId(d.value)}
          placeholder="00000000-0000-0000-0000-000000000000"
          autoComplete="off"
        />
      </Field>

      {error && (
        <MessageBar intent="error">
          <MessageBarBody>{error}</MessageBarBody>
        </MessageBar>
      )}

      <div className={styles.buttonRow}>
        <Button
          appearance="primary"
          disabled={!haloUrl.trim() || !clientId.trim() || saving}
          onClick={save}
        >
          {saving ? "Saving…" : "Continue"}
        </Button>
      </div>
    </div>
  );
}
