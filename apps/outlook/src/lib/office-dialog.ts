// Office Dialog implementation of the @iusehalo/halo-api DialogOpener interface.
//
// Outlook's task pane opens the OAuth authorize URL via Office.context.ui.displayDialogAsync.
// The callback page (auth/callback.html) parses ?code=... / ?error=... and relays the payload
// back to us via Office.context.ui.messageParent, which we surface as a DialogResultMessage.
//
// displayDialogAsync requires the initial URL to be at the add-in's own origin — not a
// subdomain, not a different domain even if listed in validDomains/AppDomains. The
// wrapper page at /outlook/auth/start.html bounces to the third-party authorize URL.

import type { DialogOpener, DialogResultMessage } from "@iusehalo/halo-api";

const REDIRECT_PATH = "/outlook/auth/callback.html";
const START_PATH = "/outlook/auth/start.html";
const ADDIN_ORIGIN = "https://tools.iusehalo.com";

export function redirectUri(): string {
  return ADDIN_ORIGIN + REDIRECT_PATH;
}

/** Wrap the third-party authorize URL in our same-origin start page. */
export function wrapAuthorizeUrl(authorizeUrl: string): string {
  return `${ADDIN_ORIGIN}${START_PATH}?to=${encodeURIComponent(authorizeUrl)}`;
}

/** Error thrown when the Office Dialog fails to complete sign-in. Carries the
 *  underlying Office error code AND the URL we attempted to open so the UI
 *  can show the admin where to test manually. */
export class AuthDialogError extends Error {
  /** Office error code from DialogEventReceived (e.g. 12002, 12004) or
   *  -1 when failure came from displayDialogAsync itself. */
  code: number;
  /** The URL we asked the dialog to load (our wrapper, which then bounces). */
  dialogUrl: string;
  /** The actual authorize URL inside the wrapper — what the admin should
   *  paste into a browser tab to see Halo's real response. */
  authorizeUrl: string;

  constructor(
    message: string,
    code: number,
    dialogUrl: string,
    authorizeUrl: string,
  ) {
    super(message);
    this.name = "AuthDialogError";
    this.code = code;
    this.dialogUrl = dialogUrl;
    this.authorizeUrl = authorizeUrl;
  }
}

/**
 * Map Office's numeric DialogEventReceived error codes to a human-readable
 * description of what most likely went wrong, biased toward what's actionable
 * for an MSP admin debugging their Halo Connect / SSO setup.
 *
 * Codes from the office.js spec: https://learn.microsoft.com/en-us/javascript/api/requirement-sets/common/dialog-api-requirement-sets
 */
function describeDialogError(code: number): string {
  switch (code) {
    case 12002:
      return "Couldn't load the sign-in page. The HaloPSA URL may be unreachable, or the authorize endpoint returned an error. Try the URL below in a regular browser tab to see HaloPSA's actual response.";
    case 12003:
      return "Invalid sign-in URL. Check that the HaloPSA URL you configured is correct (must be HTTPS).";
    case 12004:
      return "Sign-in tried to redirect to a domain Outlook doesn't trust. If your HaloPSA uses custom SSO (Okta, Auth0, custom SAML), the SSO domain needs to be added to the manifest. Microsoft + Google SSO are covered by default.";
    case 12005:
      return "Sign-in URL must be HTTPS.";
    case 12006:
      // User closed the dialog — distinct error path, not surfaced here.
      return "Sign-in cancelled.";
    case 12007:
      return "Sign-in dialog failed to open. This is usually a transient Office issue — try again, or restart Outlook.";
    default:
      return `Sign-in failed (Office dialog code ${code}). Try the URL below in a regular browser tab to see what HaloPSA returns.`;
  }
}

/** Singleton Office-dialog opener — pass into signIn(). */
export const officeDialogOpener: DialogOpener = {
  open(url: string): Promise<DialogResultMessage> {
    return new Promise((resolve, reject) => {
      // Recover the underlying authorize URL from our wrapper for error reporting.
      let authorizeUrl = url;
      try {
        const u = new URL(url);
        const to = u.searchParams.get("to");
        if (to) authorizeUrl = to;
      } catch {
        /* keep url as-is */
      }

      Office.context.ui.displayDialogAsync(
        url,
        { height: 60, width: 30, promptBeforeOpen: false },
        (asyncResult) => {
          if (asyncResult.status !== Office.AsyncResultStatus.Succeeded) {
            reject(
              new AuthDialogError(
                asyncResult.error?.message ?? "Failed to open auth dialog",
                -1,
                url,
                authorizeUrl,
              ),
            );
            return;
          }
          const dialog = asyncResult.value;

          dialog.addEventHandler(Office.EventType.DialogMessageReceived, (arg) => {
            dialog.close();
            try {
              // messageProperty is the JSON string posted from the callback page
              const data: DialogResultMessage = JSON.parse(
                (arg as { message: string }).message,
              );
              resolve(data);
            } catch (e) {
              reject(new Error(`Bad message from auth dialog: ${(e as Error).message}`));
            }
          });

          dialog.addEventHandler(Office.EventType.DialogEventReceived, (arg) => {
            const ev = arg as { error: number };
            dialog.close();
            if (ev.error === 12006) {
              // User-cancelled — surface as a plain Error (not AuthDialogError)
              // so the UI doesn't show the troubleshooting URL block for a
              // routine cancel.
              reject(new Error("Sign-in cancelled."));
              return;
            }
            reject(
              new AuthDialogError(
                describeDialogError(ev.error),
                ev.error,
                url,
                authorizeUrl,
              ),
            );
          });
        },
      );
    });
  },
};
