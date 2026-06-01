import { useState } from "react";
import {
  Button,
  Text,
  makeStyles,
  tokens,
  MessageBar,
  MessageBarBody,
  MessageBarTitle,
  Link,
} from "@fluentui/react-components";
import { Copy24Regular, Open24Regular } from "@fluentui/react-icons";
import { signIn } from "@iusehalo/halo-api";
import { clearConfig, getConfig } from "@iusehalo/halo-api";
import {
  officeDialogOpener,
  redirectUri,
  wrapAuthorizeUrl,
  AuthDialogError,
} from "../lib/office-dialog";

const useStyles = makeStyles({
  root: {
    display: "flex",
    flexDirection: "column",
    gap: "16px",
    padding: "20px",
    height: "100%",
    alignItems: "stretch",
    justifyContent: "center",
  },
  title: {
    fontSize: tokens.fontSizeBase500,
    fontWeight: tokens.fontWeightSemibold,
    textAlign: "center",
  },
  subtitle: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
    textAlign: "center",
  },
  buttons: {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
  },
  errorBlock: {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
  },
  troubleshootBox: {
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
    padding: "10px 12px",
    background: tokens.colorNeutralBackground2,
    display: "flex",
    flexDirection: "column",
    gap: "6px",
  },
  troubleshootHeading: {
    fontSize: tokens.fontSizeBase200,
    fontWeight: tokens.fontWeightSemibold,
  },
  authUrlRow: {
    display: "flex",
    alignItems: "center",
    gap: "4px",
    fontFamily: "monospace",
    fontSize: tokens.fontSizeBase100,
    background: tokens.colorNeutralBackground1,
    border: `1px solid ${tokens.colorNeutralStroke3}`,
    borderRadius: tokens.borderRadiusSmall,
    padding: "4px 6px",
    overflow: "hidden",
  },
  authUrlText: {
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  checklist: {
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground2,
    margin: 0,
    paddingLeft: "20px",
  },
});

interface Props {
  onAuthenticated: () => void;
  onReconfigure: () => void;
}

export function AuthScreen({ onAuthenticated, onReconfigure }: Props) {
  const styles = useStyles();
  // Track the AuthDialogError as a typed value (not just a message string)
  // so we can render the URL block + troubleshooting checklist underneath.
  const [error, setError] = useState<
    { message: string; details?: AuthDialogError } | undefined
  >();
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const cfg = getConfig();

  const handleSignIn = async () => {
    setError(undefined);
    setBusy(true);
    try {
      await signIn(officeDialogOpener, {
        redirectUri: redirectUri(),
        wrapAuthorizeUrl,
      });
      onAuthenticated();
    } catch (e) {
      const err = e as Error;
      setError({
        message: err.message,
        details: err instanceof AuthDialogError ? err : undefined,
      });
    } finally {
      setBusy(false);
    }
  };

  const handleReset = async () => {
    await clearConfig();
    onReconfigure();
  };

  const handleCopyUrl = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked — user can still long-press the URL */
    }
  };

  return (
    <div className={styles.root}>
      <Text className={styles.title}>Sign in to HaloPSA</Text>
      <Text className={styles.subtitle}>
        Connected to <strong>{cfg?.haloBaseUrl}</strong>
      </Text>

      {error && (
        <div className={styles.errorBlock}>
          <MessageBar intent="error">
            <MessageBarBody>
              <MessageBarTitle>Sign-in failed</MessageBarTitle>
              {error.message}
            </MessageBarBody>
          </MessageBar>

          {/* When the failure came from Outlook's dialog (rather than a
              user-cancel or token-exchange error), show the actual authorize
              URL so the admin can test it outside Outlook. Outlook's own
              banner inside the dialog says only "could not be started" with
              no detail — testing the URL directly surfaces HaloPSA's real
              response in 2 seconds. */}
          {error.details && (
            <div className={styles.troubleshootBox}>
              <Text className={styles.troubleshootHeading}>
                Test the sign-in URL directly
              </Text>
              <Text style={{ fontSize: tokens.fontSizeBase200 }}>
                Open this in a regular browser tab to see exactly what
                HaloPSA returns. If you get an error page (invalid client,
                redirect URI mismatch, etc.), fix it in your Halo Connect
                application config.
              </Text>
              <div className={styles.authUrlRow}>
                <span className={styles.authUrlText} title={error.details.authorizeUrl}>
                  {error.details.authorizeUrl}
                </span>
                <Button
                  appearance="subtle"
                  size="small"
                  icon={<Copy24Regular />}
                  aria-label="Copy URL"
                  onClick={() => handleCopyUrl(error.details!.authorizeUrl)}
                />
                <Link
                  href={error.details.authorizeUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Open URL in new tab"
                  style={{ display: "inline-flex" }}
                >
                  <Open24Regular />
                </Link>
              </div>
              {copied && (
                <Text style={{ fontSize: tokens.fontSizeBase100, color: tokens.colorPaletteGreenForeground1 }}>
                  Copied to clipboard
                </Text>
              )}
              <Text className={styles.troubleshootHeading} style={{ marginTop: 6 }}>
                Common causes
              </Text>
              <ul className={styles.checklist}>
                <li>Halo Connect app's <strong>redirect URI</strong> doesn't exactly match <code>{redirectUri()}</code></li>
                <li>Halo Connect <strong>client ID</strong> doesn't exist on this Halo tenant</li>
                <li>Halo URL is wrong or the Halo instance is unreachable</li>
                <li>Halo uses custom SSO (Okta, Auth0) whose domain isn't in the manifest</li>
              </ul>
            </div>
          )}
        </div>
      )}

      <div className={styles.buttons}>
        <Button appearance="primary" onClick={handleSignIn} disabled={busy}>
          {busy ? "Opening sign-in…" : "Sign in with HaloPSA"}
        </Button>
        <Button appearance="subtle" onClick={handleReset} disabled={busy}>
          Use a different HaloPSA tenant
        </Button>
      </div>
    </div>
  );
}
