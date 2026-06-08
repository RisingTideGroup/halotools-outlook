import { storage } from "./storage";

// Each MSP's admin registers their own Halo Connect app on their own HaloPSA instance,
// then enters the resulting Client ID + Halo base URL on first launch.
// We never see the secret; we only do PKCE public-client flows.

const KEY = "halo.tenantConfig.v1";

export interface TenantConfig {
  /** Base URL of the user's HaloPSA instance, e.g. https://halo.example.com (no trailing slash) */
  haloBaseUrl: string;
  /** OAuth Client ID for the Halo Connect Application the admin registered on their tenant */
  clientId: string;
  /** Optional scope override; defaults to "all" for v1 simplicity */
  scope?: string;
}

export interface StoredTokens {
  accessToken: string;
  refreshToken: string;
  /** Epoch millis when accessToken expires. */
  expiresAt: number;
  scope?: string;
}

const TOKENS_KEY = "halo.tokens.v1";

export function getConfig(): TenantConfig | undefined {
  return storage().get<TenantConfig>(KEY);
}

export async function setConfig(cfg: TenantConfig): Promise<void> {
  // Normalize: strip trailing slash, ensure https://
  const cleaned: TenantConfig = {
    ...cfg,
    haloBaseUrl: cfg.haloBaseUrl.replace(/\/+$/, ""),
  };
  if (!/^https:\/\//i.test(cleaned.haloBaseUrl)) {
    throw new Error("HaloPSA URL must start with https://");
  }
  await storage().set(KEY, cleaned);
}

export async function clearConfig(): Promise<void> {
  await storage().remove(KEY);
  await storage().remove(TOKENS_KEY);
}

export function getTokens(): StoredTokens | undefined {
  return storage().get<StoredTokens>(TOKENS_KEY);
}

export async function setTokens(t: StoredTokens): Promise<void> {
  await storage().set(TOKENS_KEY, t);
}

export async function clearTokens(): Promise<void> {
  await storage().remove(TOKENS_KEY);
  notifyAuthCleared();
}

// ---- Auth-cleared event ----
//
// Fires whenever tokens are wiped — explicit sign-out, refresh failure, or
// the API layer detecting a server-side auth failure (401/403 etc.). The
// task pane subscribes so it can flip back to the AuthScreen instead of
// showing a raw 4xx error in the middle of the UI.

type AuthClearedListener = () => void;
const authClearedListeners = new Set<AuthClearedListener>();

/** Subscribe to "tokens were cleared" events. Returns an unsubscribe fn. */
export function onAuthCleared(listener: AuthClearedListener): () => void {
  authClearedListeners.add(listener);
  return () => {
    authClearedListeners.delete(listener);
  };
}

function notifyAuthCleared(): void {
  for (const l of authClearedListeners) {
    try {
      l();
    } catch {
      /* one listener throwing must not break others */
    }
  }
}

// First-run bootstrap from URL params written by the Setup wizard.
// Manifest packaged via /outlook/setup/ embeds ?halo=...&clientId=... in
// the runtime page URL so the user never sees the in-app config screen.
// Honored only when no config is stored yet — never overwrites existing setup.
export async function applyUrlParamConfig(): Promise<boolean> {
  if (getConfig()) return false;
  const params = new URLSearchParams(window.location.search);
  const halo = params.get("halo");
  const clientId = params.get("clientId");
  if (!halo || !clientId) return false;
  try {
    await setConfig({ haloBaseUrl: halo, clientId });
  } catch {
    return false;
  }
  const url = new URL(window.location.href);
  url.searchParams.delete("halo");
  url.searchParams.delete("clientId");
  history.replaceState(null, "", url.pathname + (url.search ? url.search : "") + url.hash);
  return true;
}
