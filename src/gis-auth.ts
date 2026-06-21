/**
 * Google Identity Services (GIS) auth helper
 * Replaces Firebase SDK OAuth with the modern GIS library.
 *
 * The GIS library is loaded via a <script> tag in index.html.
 * This module wraps it with typed, Promise-based helpers.
 */

export interface GisUserProfile {
  sub: string;         // Google User ID (stable, unique)
  email: string;
  name: string;
  picture: string;
  email_verified: boolean;
}

declare global {
  interface Window {
    google: {
      accounts: {
        id: {
          initialize: (config: object) => void;
          prompt: (notification?: (n: any) => void) => void;
          renderButton: (parent: HTMLElement, options: object) => void;
          disableAutoSelect: () => void;
          revoke: (email: string, done: () => void) => void;
        };
        oauth2: {
          initTokenClient: (config: object) => { requestAccessToken: () => void };
        };
      };
    };
    __gisResolve?: (credential: string) => void;
    __gisReject?: (err: Error) => void;
  }
}

/**
 * Opens the Google One-Tap / pop-up account selector.
 * Returns the raw ID-token (JWT) string issued by Google.
 */
export function requestGoogleIdToken(clientId: string): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!window.google?.accounts?.id) {
      return reject(new Error("GIS library not loaded. Ensure the GSI script tag is present in index.html."));
    }

    // Store callbacks so the global handler can reach them
    window.__gisResolve = resolve;
    window.__gisReject = reject;

    window.google.accounts.id.initialize({
      client_id: clientId,
      callback: (response: { credential: string; error?: string }) => {
        if (response.error) {
          window.__gisReject?.(new Error(response.error));
        } else {
          window.__gisResolve?.(response.credential);
        }
        // Clean up globals
        delete window.__gisResolve;
        delete window.__gisReject;
      },
      // Force account picker each time for multi-role scenario
      auto_select: false,
      cancel_on_tap_outside: true,
    });

    window.google.accounts.id.prompt((notification: any) => {
      if (notification.isNotDisplayed() || notification.isSkippedMoment()) {
        // One-tap was suppressed; fall through – UI will render a button instead
        reject(new Error("GIS_PROMPT_SUPPRESSED"));
        delete window.__gisResolve;
        delete window.__gisReject;
      }
    });
  });
}

/**
 * Decodes the Google ID-token (JWT) WITHOUT verifying signature.
 * Signature verification MUST happen server-side via /api/auth/google.
 * This client-side decode is only used to display user info optimistically.
 */
export function decodeIdToken(idToken: string): GisUserProfile {
  try {
    const base64Url = idToken.split(".")[1];
    const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
    const jsonPayload = decodeURIComponent(
      atob(base64)
        .split("")
        .map((c) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2))
        .join("")
    );
    return JSON.parse(jsonPayload);
  } catch {
    throw new Error("Failed to decode Google ID token payload.");
  }
}

/** Sign out: disable auto-select so next visit shows the picker again. */
export function signOutGis(email: string): void {
  window.google?.accounts?.id?.disableAutoSelect();
  if (email) {
    window.google?.accounts?.id?.revoke(email, () => {
      console.log("GIS session revoked for", email);
    });
  }
}
