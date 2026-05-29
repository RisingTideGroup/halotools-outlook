import { storage } from "@iusehalo/halo-api";

// Per-user, per-mailbox preferences. Roams with Outlook profile.
// Distinct from tenant config (haloUrl/clientId) because these are user-level choices.

const KEY = "halo.defaults.v1";

export interface UserDefaults {
  /** Default ticket type ID to use on Create */
  defaultTicketTypeId?: number;
  /** Default outcome string for Append actions on INCOMING email; defaults to "Email Received" */
  defaultAppendOutcome?: string;
  /** Default outcome string for Append actions on OUTGOING email (sent items); defaults to "Outgoing Email" */
  defaultOutgoingOutcome?: string;
  /** Whether attachments toggle defaults to on */
  includeAttachmentsByDefault?: boolean;
}

export function getDefaults(): UserDefaults {
  return storage().get<UserDefaults>(KEY) ?? {};
}

export async function setDefaults(d: UserDefaults): Promise<void> {
  await storage().set(KEY, d);
}

export async function clearDefaults(): Promise<void> {
  await storage().remove(KEY);
}
