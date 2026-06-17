import { zipSync, unzipSync, strToU8, strFromU8 } from "fflate";
import { MANIFEST_VERSION } from "./version";

export interface TenantInput {
  haloBaseUrl: string;
  clientId: string;
  appName?: string;
  /**
   * Pre-existing manifest GUID. When set, the regenerated package keeps the
   * same `id` so M365 admin sees this as an update to the deployed app
   * instead of a brand-new install. Leave undefined for first-time setup.
   */
  existingAppId?: string;
  /**
   * The existing package's `version` field (e.g. "1.0.0.3"). Used to determine
   * the next revision: if the prior version's first three segments match the
   * current MANIFEST_VERSION, we increment the 4th segment; if they differ
   * (because MANIFEST_VERSION has since been bumped manually), we reset to
   * `${MANIFEST_VERSION}.0`. Leave undefined for first-time setup — that
   * starts at `${MANIFEST_VERSION}.0`.
   */
  existingVersion?: string;
}

export interface ExtractedManifestFields {
  /** GUID of the existing app — pass back as `existingAppId` to keep updates in place. */
  id: string;
  /** Existing `version` field, e.g. "0.1.0" — used to bump on the regenerated package. */
  version?: string;
  /** Pre-filled from the embedded ?halo= query param on the runtime page URL. */
  haloBaseUrl?: string;
  /** Pre-filled from the embedded ?clientId= query param. */
  clientId?: string;
}

interface ManifestIcon {
  size: number;
  url: string;
}

interface ManifestExtensionGroup {
  id: string;
  label: string;
  icons: ManifestIcon[];
  controls: Array<{
    id: string;
    type: string;
    label: string;
    icons: ManifestIcon[];
    supertip: { title: string; description: string };
    actionId: string;
  }>;
}

interface ManifestRibbon {
  contexts: string[];
  tabs: Array<{
    builtInTabId: string;
    groups: ManifestExtensionGroup[];
  }>;
}

interface Manifest {
  id: string;
  version: string;
  name: { short: string; full: string };
  validDomains?: string[];
  icons: { outline: string; color: string };
  extensions: Array<{
    runtimes: Array<{ id: string; code: { page: string } }>;
    ribbons?: ManifestRibbon[];
  }>;
  [k: string]: unknown;
}

function hostnameOf(url: string): string {
  return new URL(url).hostname;
}

/**
 * Produce the next 4-segment manifest version.
 *
 *  - If `prior` shares its first three segments with MANIFEST_VERSION, bump the
 *    4th segment (revision). M365 admin's update flow requires strictly-greater.
 *  - If `prior` differs (or is missing/malformed) — typically because someone
 *    manually bumped MANIFEST_VERSION since the last upload — reset to
 *    `${MANIFEST_VERSION}.0`. The first three segments increasing is enough to
 *    satisfy strictly-greater on its own, so a `.0` revision is fine.
 */
function nextVersion(prior: string | undefined): string {
  if (!prior) return `${MANIFEST_VERSION}.0`;
  const parts = prior.split(".");
  if (parts.length < 3 || parts.length > 4) return `${MANIFEST_VERSION}.0`;
  const priorBase = parts.slice(0, 3).join(".");
  if (priorBase !== MANIFEST_VERSION) return `${MANIFEST_VERSION}.0`;
  const rev = parts.length === 4 ? Number(parts[3]) : 0;
  if (!Number.isFinite(rev)) return `${MANIFEST_VERSION}.0`;
  return `${MANIFEST_VERSION}.${rev + 1}`;
}

/**
 * Build a per-tenant manifest by taking the generic published manifest
 * and overlaying tenant-specific fields:
 *  - GUID: keeps `input.existingAppId` when provided so M365 admin sees an
 *    update to the deployed app, otherwise mints a fresh one.
 *  - validDomains extended with the MSP's Halo host
 *  - Runtime page URL carries ?halo=...&clientId=... so the SPA self-configures
 *    on first launch and skips the in-app config screen
 */
export function buildManifest(template: Manifest, input: TenantInput): Manifest {
  const haloHost = hostnameOf(input.haloBaseUrl);

  const cloned: Manifest = JSON.parse(JSON.stringify(template));
  cloned.id = input.existingAppId ?? crypto.randomUUID();
  // Always compute the next version from the prior, falling back to
  // `${MANIFEST_VERSION}.0` when no prior is known. M365 admin rejects updates
  // whose version isn't strictly greater than what's deployed; nextVersion
  // guarantees that as long as MANIFEST_VERSION doesn't move backwards.
  cloned.version = nextVersion(input.existingVersion);

  // Runtime URLs carry the manifest version as `mv` so the running SPA can
  // detect when a newer manifest is available and prompt the admin to re-upload.
  // Compared first-three-segments-only against /outlook/latest.json's manifestVersion.
  const params = new URLSearchParams({
    halo: input.haloBaseUrl,
    clientId: input.clientId,
    mv: cloned.version,
    // Tenant-level OAuth callback selector. New/regenerated manifests use the
    // shared /auth/callback; the SPA reads this and self-configures. Existing
    // deployments (no param) stay on the legacy per-app callback until re-upload.
    callback: "universal",
  }).toString();

  const validDomains = new Set(cloned.validDomains ?? []);
  validDomains.add(haloHost);
  cloned.validDomains = Array.from(validDomains);

  if (input.appName) {
    cloned.name = {
      short: input.appName.slice(0, 30),
      full: input.appName,
    };
  }

  for (const ext of cloned.extensions ?? []) {
    for (const rt of ext.runtimes ?? []) {
      const u = new URL(rt.code.page);
      // Strip /index.html if present so the param URL is clean
      if (u.pathname.endsWith("/index.html")) {
        u.pathname = u.pathname.slice(0, -"index.html".length);
      }
      u.search = params;
      rt.code.page = u.toString();
    }
  }

  return cloned;
}

async function fetchBytes(url: string): Promise<Uint8Array> {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`Failed to fetch ${url}: ${r.status}`);
  return new Uint8Array(await r.arrayBuffer());
}

/**
 * Result of building the M365 admin upload zip. Includes the version we
 * stamped into the manifest so callers can show it in the UI and include
 * it in the download filename without re-parsing the zip.
 */
export interface PackageBuildResult {
  blob: Blob;
  /** The version stamped into the generated manifest (e.g. "1.0.1.0"). */
  version: string;
  /** The prior version (if any) passed in as input.existingVersion. */
  previousVersion?: string;
  /** The display name written into the manifest, for UI / filename. */
  appName: string;
}

/**
 * Produce the M365 admin upload zip. Contains the customized manifest at the
 * root plus the icon files the manifest references via relative paths.
 */
export async function buildPackageZip(
  template: Manifest,
  input: TenantInput,
): Promise<PackageBuildResult> {
  const manifest = buildManifest(template, input);
  const iconPaths = new Set<string>();
  if (manifest.icons?.outline) iconPaths.add(manifest.icons.outline);
  if (manifest.icons?.color) iconPaths.add(manifest.icons.color);

  const files: Record<string, Uint8Array> = {
    "manifest.json": strToU8(JSON.stringify(manifest, null, 2)),
  };

  // Icon paths in the manifest are relative to /outlook/manifest.json, not to
  // the wizard's own URL — anchor against the manifest's location explicitly.
  const iconBase = `${window.location.origin}/outlook/`;
  await Promise.all(
    Array.from(iconPaths).map(async (rel) => {
      const url = new URL(rel, iconBase).toString();
      files[rel] = await fetchBytes(url);
    }),
  );

  const zipped = zipSync(files, { level: 6 });
  return {
    blob: new Blob([zipped.buffer as ArrayBuffer], { type: "application/zip" }),
    version: manifest.version,
    previousVersion: input.existingVersion,
    appName: manifest.name.short,
  };
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function fetchTemplate(url: string): Promise<Manifest> {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`Failed to fetch manifest template: ${r.status}`);
  return (await r.json()) as Manifest;
}

/** Read a manifest.json out of a zip (or accept a raw manifest.json). */
function extractManifestJson(bytes: Uint8Array, filename: string): Manifest {
  // Raw JSON file path.
  if (filename.toLowerCase().endsWith(".json")) {
    return JSON.parse(strFromU8(bytes)) as Manifest;
  }
  // Zip path — look for manifest.json at any depth (Microsoft's zip flow
  // accepts it at the root, but some admins zip a folder; tolerate both).
  const entries = unzipSync(bytes);
  const key =
    Object.keys(entries).find((k) => k.toLowerCase() === "manifest.json") ??
    Object.keys(entries).find((k) => k.toLowerCase().endsWith("/manifest.json"));
  if (!key) throw new Error("No manifest.json found in the uploaded file.");
  return JSON.parse(strFromU8(entries[key])) as Manifest;
}

/**
 * Extract the existing app's GUID + embedded Halo URL / Client ID from a
 * previously-generated package (or a bare manifest.json). The wizard uses
 * this to pre-fill the form when an admin uploads their current deployment
 * to regenerate — keeping the same GUID so M365 treats it as an update,
 * not a fresh install.
 */
export async function readExistingManifest(file: File): Promise<ExtractedManifestFields> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const manifest = extractManifestJson(bytes, file.name);

  if (!manifest.id || typeof manifest.id !== "string") {
    throw new Error("Manifest is missing an `id` field.");
  }

  // Pull halo/clientId from the runtime page URL the previous wizard run baked in.
  let haloBaseUrl: string | undefined;
  let clientId: string | undefined;
  for (const ext of manifest.extensions ?? []) {
    for (const rt of ext.runtimes ?? []) {
      try {
        const u = new URL(rt.code.page);
        const h = u.searchParams.get("halo");
        const c = u.searchParams.get("clientId");
        if (h && !haloBaseUrl) haloBaseUrl = h;
        if (c && !clientId) clientId = c;
      } catch {
        /* malformed URL — skip */
      }
    }
  }

  const version =
    typeof manifest.version === "string" ? manifest.version : undefined;
  return { id: manifest.id, version, haloBaseUrl, clientId };
}
