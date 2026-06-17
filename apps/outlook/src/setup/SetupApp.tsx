import { useRef, useState } from "react";
import {
  Button,
  Field,
  Input,
  Text,
  Title1,
  Title3,
  Subtitle2,
  Body1,
  Body1Strong,
  MessageBar,
  MessageBarBody,
  MessageBarTitle,
  makeStyles,
  tokens,
  Card,
} from "@fluentui/react-components";
import {
  CheckmarkCircle24Filled,
  Copy24Regular,
  ArrowDownload24Regular,
  Sparkle24Regular,
  ArrowSync24Regular,
  ArrowLeft24Regular,
  ArrowUpload24Regular,
} from "@fluentui/react-icons";
import {
  buildPackageZip,
  downloadBlob,
  fetchTemplate,
  readExistingManifest,
} from "./package";

type Step = "choose" | "halo-url" | "register-app" | "client-id" | "done";
type Mode = "new" | "update";

// The generated manifest uses the shared /auth/callback (stamped callback=universal
// in package.ts), so that's the redirect URI admins register. The legacy
// /outlook/auth/callback.html still works for older deployed manifests.
const REDIRECT_URI = `${window.location.origin}/auth/callback`;
const MANIFEST_TEMPLATE_URL = "/outlook/manifest.json";
const BRAND_RED = "#EF3340";

const useStyles = makeStyles({
  page: {
    minHeight: "100vh",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "flex-start",
    padding: "48px 16px 32px",
    backgroundColor: tokens.colorNeutralBackground2,
    backgroundImage: `linear-gradient(180deg, ${tokens.colorNeutralBackground2} 0%, ${tokens.colorNeutralBackground3} 100%)`,
  },
  brandHeader: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "8px",
    marginBottom: "20px",
  },
  brandTitle: {
    fontWeight: tokens.fontWeightBold,
    color: tokens.colorNeutralForeground1,
  },
  brandSubtitle: {
    color: tokens.colorNeutralForeground3,
    textAlign: "center",
    maxWidth: "480px",
  },
  card: {
    width: "min(680px, 100%)",
    padding: "28px",
    display: "flex",
    flexDirection: "column",
    gap: "16px",
    boxShadow: "0 8px 32px rgba(0,0,0,0.06)",
  },
  steps: {
    display: "flex",
    gap: "8px",
    alignItems: "center",
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
  },
  stepActive: {
    color: BRAND_RED,
    fontWeight: tokens.fontWeightSemibold,
  },
  stepNumber: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: "20px",
    height: "20px",
    borderRadius: "50%",
    backgroundColor: tokens.colorNeutralBackground3,
    fontSize: "11px",
    fontWeight: tokens.fontWeightSemibold,
    marginRight: "6px",
  },
  stepNumberActive: {
    backgroundColor: BRAND_RED,
    color: "#fff",
  },
  helpText: {
    color: tokens.colorNeutralForeground3,
  },
  codeRow: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    backgroundColor: tokens.colorNeutralBackground3,
    padding: "8px 12px",
    borderRadius: tokens.borderRadiusMedium,
    fontFamily: "Consolas, monospace",
    fontSize: tokens.fontSizeBase200,
    wordBreak: "break-all",
  },
  buttonRow: {
    display: "flex",
    gap: "8px",
    justifyContent: "flex-end",
    marginTop: "8px",
  },
  successBody: {
    display: "flex",
    flexDirection: "column",
    gap: "12px",
  },
  ol: {
    margin: 0,
    paddingLeft: "20px",
    display: "flex",
    flexDirection: "column",
    gap: "6px",
  },
  // Mode-choice grid: two large, equal cards that the user clicks to pick a path.
  modeGrid: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: "16px",
    "@media (max-width: 540px)": {
      gridTemplateColumns: "1fr",
    },
  },
  modeCard: {
    display: "flex",
    flexDirection: "column",
    gap: "10px",
    padding: "20px",
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusXLarge,
    cursor: "pointer",
    backgroundColor: tokens.colorNeutralBackground1,
    transition: "transform 80ms, box-shadow 80ms, outline 80ms",
    textAlign: "left",
    outline: "1px solid transparent",
    outlineOffset: "-1px",
    ":hover": {
      outline: `2px solid ${BRAND_RED}`,
      boxShadow: `0 10px 24px rgba(239,51,64,0.12)`,
    },
  },
  modeIconWrap: {
    width: "40px",
    height: "40px",
    borderRadius: tokens.borderRadiusMedium,
    backgroundColor: "#FEE7E9",
    color: BRAND_RED,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  modeTitle: {
    fontWeight: tokens.fontWeightSemibold,
    fontSize: tokens.fontSizeBase400,
    color: tokens.colorNeutralForeground1,
  },
  modeBody: {
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground3,
    lineHeight: 1.4,
  },
  modeArrow: {
    marginTop: "auto",
    color: BRAND_RED,
    fontSize: tokens.fontSizeBase200,
    fontWeight: tokens.fontWeightSemibold,
  },
  backButton: {
    alignSelf: "flex-start",
    color: tokens.colorNeutralForeground3,
  },
  updatePanel: {
    display: "flex",
    flexDirection: "column",
    gap: "16px",
    padding: "16px",
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusLarge,
    backgroundColor: tokens.colorNeutralBackground1,
  },
  updatePanelDivider: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
    "::before": { content: '""', flex: 1, height: "1px", backgroundColor: tokens.colorNeutralStroke2 },
    "::after": { content: '""', flex: 1, height: "1px", backgroundColor: tokens.colorNeutralStroke2 },
  },
  primary: {
    backgroundColor: BRAND_RED,
    border: `1px solid ${BRAND_RED}`,
    color: "#fff",
    ":hover": {
      backgroundColor: "#d92733",
      color: "#fff",
    },
    ":hover:active": {
      backgroundColor: "#bb1f2b",
      color: "#fff",
    },
  },
});

function CopyableValue({ value }: { value: string }) {
  const styles = useStyles();
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div className={styles.codeRow}>
      <span style={{ flex: 1 }}>{value}</span>
      <Button
        size="small"
        appearance="subtle"
        icon={copied ? <CheckmarkCircle24Filled /> : <Copy24Regular />}
        onClick={copy}
        aria-label="Copy"
      >
        {copied ? "Copied" : "Copy"}
      </Button>
    </div>
  );
}

function StepIndicator({ step }: { step: Step }) {
  const styles = useStyles();
  const order: Array<{ key: Step; label: string }> = [
    { key: "halo-url", label: "Halo URL" },
    { key: "register-app", label: "Register app" },
    { key: "client-id", label: "Client ID" },
  ];
  const idx = order.findIndex((s) => s.key === step);
  return (
    <div className={styles.steps}>
      {order.map((s, i) => (
        <span key={s.key} className={idx === i ? styles.stepActive : undefined}>
          <span
            className={`${styles.stepNumber} ${idx === i ? styles.stepNumberActive : ""}`}
          >
            {i + 1}
          </span>
          {s.label}
          {i < order.length - 1 ? " →" : ""}
        </span>
      ))}
    </div>
  );
}

function BrandHeader() {
  const styles = useStyles();
  return (
    <div className={styles.brandHeader}>
      <img
        src="/outlook/assets/icon-128.png"
        alt=""
        width={64}
        height={64}
        style={{ borderRadius: "50%" }}
      />
      <Title1 className={styles.brandTitle}>Halo for Outlook</Title1>
      <Text className={styles.brandSubtitle}>
        Tenant-specific add-in packaging for your MSP. Generate a fresh deployment
        or update one you've already shipped.
      </Text>
      <details
        style={{
          marginTop: 8,
          maxWidth: 560,
          fontSize: tokens.fontSizeBase200,
          color: tokens.colorNeutralForeground2,
        }}
      >
        <summary
          style={{
            cursor: "pointer",
            color: BRAND_RED,
            fontWeight: tokens.fontWeightSemibold,
          }}
        >
          How this works
        </summary>
        <div style={{ marginTop: 8, lineHeight: 1.5 }}>
          <p style={{ margin: "0 0 8px" }}>
            This wizard builds a Microsoft 365 app package (.zip) that installs
            "Halo for Outlook" into your tenant. The package is tailored to
            your HaloPSA instance so users don't have to configure anything on
            first launch.
          </p>
          <p style={{ margin: "0 0 8px" }}>
            <strong>Three steps:</strong> tell us your HaloPSA URL, register an
            API application in Halo (we'll walk you through it), and paste the
            resulting Client ID. You'll get a zip to upload in M365 admin
            (Settings → Integrated apps).
          </p>
          <p style={{ margin: 0 }}>
            Nothing tenant-specific is stored on our servers. Tokens, ticket
            data, and email content go directly from your users' Outlook to
            your HaloPSA — our hosting only serves the static add-in code.
          </p>
        </div>
      </details>
    </div>
  );
}

export function SetupApp() {
  const styles = useStyles();
  const [step, setStep] = useState<Step>("choose");
  const [mode, setMode] = useState<Mode | undefined>();
  const [haloUrl, setHaloUrl] = useState("");
  const [clientId, setClientId] = useState("");
  // When set, the regenerated package keeps this GUID so M365 admin treats
  // the upload as an update to the existing deployment instead of a brand-new
  // app. Populated by readExistingManifest after an admin uploads their
  // current package.
  const [existingAppId, setExistingAppId] = useState<string | undefined>();
  // Pulled out of an uploaded zip so we can bump the patch on the regenerated
  // manifest — M365 admin's Update flow rejects same-or-lower versions.
  const [existingVersion, setExistingVersion] = useState<string | undefined>();
  // The version stamped into the most recently generated package. Shown on
  // the done page so admins can verify exactly what they're about to upload
  // matches the version their tenant will see in M365 admin.
  const [generatedVersion, setGeneratedVersion] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [building, setBuilding] = useState(false);

  const normalizedHalo = haloUrl.trim().replace(/\/+$/, "");
  const haloUrlValid = /^https:\/\/[^\s]+\.[^\s]+$/.test(normalizedHalo);

  const submitHaloUrl = () => {
    setError(undefined);
    if (!haloUrlValid) {
      setError("Enter a valid HaloPSA URL starting with https://");
      return;
    }
    setStep("register-app");
  };

  const pickMode = (m: Mode) => {
    setError(undefined);
    setMode(m);
    setStep("halo-url");
  };

  const reset = () => {
    setStep("choose");
    setMode(undefined);
    setHaloUrl("");
    setClientId("");
    setExistingAppId(undefined);
    setExistingVersion(undefined);
    setError(undefined);
  };

  const handleExistingPackage = async (file: File) => {
    setError(undefined);
    try {
      const extracted = await readExistingManifest(file);
      setExistingAppId(extracted.id);
      if (extracted.version) setExistingVersion(extracted.version);
      if (extracted.haloBaseUrl) setHaloUrl(extracted.haloBaseUrl);
      if (extracted.clientId) setClientId(extracted.clientId);
      // Both fields pulled — jump straight to the final step so the admin
      // just hits Download.
      if (extracted.haloBaseUrl && extracted.clientId) {
        setStep("client-id");
      } else if (extracted.haloBaseUrl) {
        setStep("register-app");
      }
    } catch (e) {
      setError(`Couldn't read package: ${(e as Error).message}`);
    }
  };

  const downloadPackage = async () => {
    setError(undefined);
    setBuilding(true);
    try {
      const template = await fetchTemplate(MANIFEST_TEMPLATE_URL);
      const result = await buildPackageZip(template, {
        haloBaseUrl: normalizedHalo,
        clientId: clientId.trim(),
        existingAppId,
        existingVersion,
      });
      const slug = new URL(normalizedHalo).hostname.replace(/\./g, "-");
      // Filename carries the version so an admin who saves multiple
      // generated packages can tell at a glance which one is which without
      // unzipping each. Update vs fresh prefix stays so the file's intent
      // is also clear from the filename alone.
      const prefix = existingAppId ? "halo-outlook-update" : "halo-outlook";
      const filename = `${prefix}-${slug}-v${result.version}.zip`;
      downloadBlob(result.blob, filename);
      setGeneratedVersion(result.version);
      setStep("done");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBuilding(false);
    }
  };

  return (
    <div className={styles.page}>
      <BrandHeader />
      <Card className={styles.card}>
        {step === "choose" && (
          <>
            <Title3>What are you doing?</Title3>
            <Body1 className={styles.helpText}>
              Pick the option that matches what you need — both produce a
              package you can upload in admin.microsoft.com → Integrated apps.
            </Body1>
            <div className={styles.modeGrid}>
              <button
                className={styles.modeCard}
                onClick={() => pickMode("new")}
                type="button"
              >
                <div className={styles.modeIconWrap}>
                  <Sparkle24Regular />
                </div>
                <div className={styles.modeTitle}>Set up a new deployment</div>
                <div className={styles.modeBody}>
                  First time deploying Halo for Outlook to your tenant.
                  We'll walk through Halo Connect setup and generate a fresh
                  app package with a new ID.
                </div>
                <div className={styles.modeArrow}>Start →</div>
              </button>

              <button
                className={styles.modeCard}
                onClick={() => pickMode("update")}
                type="button"
              >
                <div className={styles.modeIconWrap}>
                  <ArrowSync24Regular />
                </div>
                <div className={styles.modeTitle}>Update an existing deployment</div>
                <div className={styles.modeBody}>
                  Already shipped a package to M365 and want to push the latest
                  version. Upload your previous zip or paste the existing app
                  GUID — we'll keep the same ID so M365 treats it as an update.
                </div>
                <div className={styles.modeArrow}>Update →</div>
              </button>
            </div>
          </>
        )}

        {step !== "choose" && step !== "done" && (
          <>
            <Button
              appearance="subtle"
              size="small"
              className={styles.backButton}
              icon={<ArrowLeft24Regular />}
              onClick={reset}
            >
              Start over
            </Button>
            <StepIndicator step={step} />
          </>
        )}

        {step === "halo-url" && mode === "new" && (
          <>
            <Field
              label="HaloPSA URL"
              required
              hint="The base URL of your Halo instance, e.g. https://halo.yourcompany.com"
            >
              <Input
                value={haloUrl}
                onChange={(_, d) => setHaloUrl(d.value)}
                placeholder="https://halo.yourcompany.com"
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
                className={styles.primary}
                disabled={!haloUrl.trim()}
                onClick={submitHaloUrl}
              >
                Next
              </Button>
            </div>
          </>
        )}

        {step === "halo-url" && mode === "update" && (
          <div className={styles.updatePanel}>
            <Subtitle2>Identify the deployment you're updating</Subtitle2>
            <Body1 className={styles.helpText}>
              Either upload the zip you generated last time (we'll read the app
              ID, Halo URL, and Client ID out of it and skip you to the
              download), or paste the app ID from M365 admin and fill the
              other fields by hand.
            </Body1>
            <ExistingPackageUpload
              onPick={handleExistingPackage}
              onPasteId={(id) => {
                setExistingAppId(id);
                setError(undefined);
              }}
            />
            <div className={styles.updatePanelDivider}>
              <span>or fill in by hand</span>
            </div>
            <Field
              label="HaloPSA URL"
              required
              hint="Same URL the existing deployment uses."
            >
              <Input
                value={haloUrl}
                onChange={(_, d) => setHaloUrl(d.value)}
                placeholder="https://halo.yourcompany.com"
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
                className={styles.primary}
                disabled={!haloUrl.trim() || !existingAppId}
                onClick={submitHaloUrl}
              >
                Next
              </Button>
            </div>
          </div>
        )}

        {existingAppId && step !== "halo-url" && step !== "done" && (
          <MessageBar intent="info">
            <MessageBarBody>
              Update mode — reusing app ID <code>{existingAppId.slice(0, 8)}…</code>
              {existingVersion ? (
                <>
                  {" "}and bumping version from <code>{existingVersion}</code>.
                </>
              ) : (
                <> with a timestamp-based version (you didn't upload the prior zip).</>
              )}{" "}
              The package will replace the existing deployment in M365 admin
              instead of installing a new app.
            </MessageBarBody>
          </MessageBar>
        )}

        {step === "register-app" && (
          <>
            <Subtitle2>Register an API application in Halo</Subtitle2>
            <Body1>In your Halo instance, go to:</Body1>
            <Body1Strong>Configuration → Integrations → API</Body1Strong>
            <Body1>Click <em>New</em> and configure the application as follows:</Body1>
            <ol className={styles.ol}>
              <li><Body1>Application Name: <code>Outlook Add-in</code> (anything you like)</Body1></li>
              <li><Body1>Authentication Method: <code>Authorization Code (PKCE)</code></Body1></li>
              <li><Body1>Allowed Logins: check <strong>Allow Agent Logins</strong>. Leave <em>Allow End-User Logins</em> and <em>Allow Anonymous Access</em> unchecked.</Body1></li>
              <li>
                <Body1>Redirect URI — paste exactly:</Body1>
                <CopyableValue value={REDIRECT_URI} />
              </li>
              <li>
                <Body1>Permissions / Scopes: <code>all</code> (or the minimum needed for tickets, users, clients, actions, attachments)</Body1>
              </li>
              <li>
                <Body1>Under the application's CORS whitelist, add:</Body1>
                <CopyableValue value={window.location.origin} />
              </li>
              <li><Body1>Save the application, then copy the generated <strong>Client ID</strong>.</Body1></li>
            </ol>
            <div className={styles.buttonRow}>
              <Button appearance="secondary" onClick={() => setStep("halo-url")}>Back</Button>
              <Button appearance="primary" onClick={() => setStep("client-id")}>I've registered the app</Button>
            </div>
          </>
        )}

        {step === "client-id" && (
          <>
            <Field
              label="Client ID"
              required
              hint="From the API application you just registered in Halo"
            >
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
              <Button appearance="secondary" onClick={() => setStep("register-app")} disabled={building}>Back</Button>
              <Button
                appearance="primary"
                className={styles.primary}
                icon={<ArrowDownload24Regular />}
                disabled={!clientId.trim() || building}
                onClick={downloadPackage}
              >
                {building ? "Building…" : "Download package"}
              </Button>
            </div>
          </>
        )}

        {step === "done" && (
          <>
            <MessageBar intent="success">
              <MessageBarBody>
                <MessageBarTitle>
                  {existingAppId ? "Update package ready" : "Package ready"}
                  {generatedVersion ? ` — version ${generatedVersion}` : null}
                </MessageBarTitle>
                {existingAppId
                  ? "Upload it to Microsoft 365 — M365 will replace the existing deployment because the app ID matches."
                  : "Now upload it to Microsoft 365."}
                {existingVersion && generatedVersion ? (
                  <Body1 block style={{ marginTop: 6 }}>
                    Bumped from <strong>{existingVersion}</strong> →{" "}
                    <strong>{generatedVersion}</strong>. Microsoft 365 admin
                    requires the new version to be strictly greater than what's
                    deployed; this satisfies that.
                  </Body1>
                ) : null}
              </MessageBarBody>
            </MessageBar>
            <MessageBar intent="warning">
              <MessageBarBody>
                <MessageBarTitle>Keep this zip — you'll need it to publish updates</MessageBarTitle>
                Microsoft 365's Update flow requires the same app ID on every
                re-upload. Save the file somewhere you can find it again (a
                team drive works) so the next time you regenerate, you can
                drop it into the "Updating an existing deployment" path and
                we'll keep the ID and bump the version for you.
              </MessageBarBody>
            </MessageBar>
            <div className={styles.successBody}>
              <Subtitle2>Next: deploy to your tenant</Subtitle2>
              <ol className={styles.ol}>
                <li>
                  <Body1>
                    Sign in to{" "}
                    <a
                      href="https://admin.microsoft.com/Adminportal/Home#/Settings/IntegratedApps"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      admin.microsoft.com → Integrated apps
                    </a>{" "}
                    as a global or apps admin.
                  </Body1>
                </li>
                <li>
                  <Body1>
                    Click <strong>Upload custom apps</strong>.
                  </Body1>
                </li>
                <li>
                  <Body1>
                    <strong>App type: Microsoft Teams app</strong>{" "}
                    <em>(yes, Teams — this is the path that accepts the unified manifest zip and</em>{" "}
                    <em>also deploys to Outlook. The "Office Add-in" option only takes the legacy</em>{" "}
                    <em>XML format and won't work here).</em>
                  </Body1>
                </li>
                <li>
                  <Body1>
                    <strong>Upload an app package (.zip)</strong> → pick the file you just
                    downloaded.
                  </Body1>
                </li>
                <li>
                  <Body1>Assign to your team and finish the deployment.</Body1>
                </li>
                <li>
                  <Body1>
                    Also surface it in{" "}
                    <a
                      href="https://admin.teams.microsoft.com/policies/app-setup"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Teams admin → App setup policies
                    </a>{" "}
                    if you want it pre-pinned for users.
                  </Body1>
                </li>
              </ol>
              <Text className={styles.helpText}>
                Microsoft pushes the add-in to assigned users within a few hours. On first launch
                it auto-configures for your HaloPSA instance — no per-user setup.
              </Text>
              <div className={styles.buttonRow}>
                <Button onClick={reset}>Build another package</Button>
              </div>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}

function ExistingPackageUpload({
  onPick,
  onPasteId,
}: {
  onPick: (file: File) => void;
  onPasteId: (id: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [pastedId, setPastedId] = useState("");
  const [pasteError, setPasteError] = useState<string | undefined>();
  const [dragOver, setDragOver] = useState(false);
  const guidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  const submitId = () => {
    const trimmed = pastedId.trim();
    if (!guidRe.test(trimmed)) {
      setPasteError("Enter a GUID like 10344d7a-f46f-463c-a0fb-5fbf43b3d074");
      return;
    }
    setPasteError(undefined);
    onPasteId(trimmed);
  };

  return (
    <div
      style={{
        marginTop: 16,
        paddingTop: 12,
        borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      <Body1 style={{ color: tokens.colorNeutralForeground3 }}>
        Updating an existing deployment? Drop the .zip you generated last time —
        we'll read the app ID, Halo URL, and Client ID out of it and skip you
        straight to the download.
      </Body1>
      {/* Primary path: upload existing package. A bordered drop-zone with an
          icon makes this visually obvious; the previous subtle text button was
          easily missed. */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          if (!dragOver) setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const file = e.dataTransfer.files?.[0];
          if (file) onPick(file);
        }}
        style={{
          border: `2px dashed ${dragOver ? tokens.colorBrandStroke1 : tokens.colorNeutralStroke1}`,
          borderRadius: tokens.borderRadiusMedium,
          padding: "20px 16px",
          textAlign: "center",
          cursor: "pointer",
          background: dragOver ? tokens.colorBrandBackground2 : tokens.colorNeutralBackground2,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 6,
          transition: "background 120ms, border-color 120ms",
        }}
      >
        <ArrowUpload24Regular style={{ color: tokens.colorBrandForeground1 }} />
        <Body1Strong>Upload existing package</Body1Strong>
        <Body1 style={{ color: tokens.colorNeutralForeground3, fontSize: 12 }}>
          Drop a .zip or manifest.json here, or click to browse.
        </Body1>
        <input
          ref={inputRef}
          type="file"
          accept=".zip,.json,application/zip,application/json"
          style={{ display: "none" }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onPick(file);
            // Reset so re-picking the same file fires again.
            e.target.value = "";
          }}
        />
      </div>
      {/* Fallback path: paste the app ID. Visually demoted with a small "or"
          divider so admins reach for the upload first when they have the .zip. */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          marginTop: 4,
          color: tokens.colorNeutralForeground3,
        }}
      >
        <div style={{ flex: 1, height: 1, background: tokens.colorNeutralStroke2 }} />
        <Body1 style={{ color: tokens.colorNeutralForeground3, fontSize: 12 }}>
          or paste the app ID
        </Body1>
        <div style={{ flex: 1, height: 1, background: tokens.colorNeutralStroke2 }} />
      </div>
      <Field
        hint="Microsoft 365 admin → Integrated apps → Halo → app details. It's a GUID."
        validationState={pasteError ? "error" : undefined}
        validationMessage={pasteError}
      >
        <div style={{ display: "flex", gap: 6 }}>
          <Input
            value={pastedId}
            onChange={(_, d) => {
              setPastedId(d.value);
              if (pasteError) setPasteError(undefined);
            }}
            placeholder="10344d7a-f46f-463c-a0fb-5fbf43b3d074"
            style={{ flex: 1 }}
          />
          <Button
            appearance="secondary"
            size="small"
            disabled={!pastedId.trim()}
            onClick={submitId}
          >
            Use ID
          </Button>
        </div>
      </Field>
    </div>
  );
}
