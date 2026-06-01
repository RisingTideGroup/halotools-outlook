/**
 * Single source of truth for the manifest's user-facing version.
 *
 * Bump manually when the manifest CONTENT changes in a way that requires
 * the M365 admin to download and re-upload the .zip. Rules are documented
 * in CLAUDE.md under "Manifest version policy".
 *
 * The setup wizard turns this into a 4-segment Office version by appending
 * a revision (`.0`, `.1`, …) on every regeneration so each download is
 * strictly greater than the prior one — required by M365 admin's update
 * flow. The revision is invisible to the upgrade banner; only the first
 * three segments below are compared.
 */
export const MANIFEST_VERSION = "1.0.3";
