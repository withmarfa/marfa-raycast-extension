/**
 * Reading a token endpoint's answer as a value rather than as a throw.
 *
 * **The refusal code is the point.** Both call sites used to interpolate it
 * into a message string and throw a plain `Error`, so nothing downstream could
 * tell a dead client from an expired grant. That is why a client the server
 * had forgotten was unrecoverable from inside this extension: the one fact
 * that would have triggered a re-registration was discarded a line after it
 * arrived.
 *
 * Pure, and apart from the flow, for the reason `force-consent.ts` and
 * `authorize-url.ts` are: `marfa-oauth.ts` builds an `OAuth.PKCEClient` at
 * import time, so nothing in it can be unit-tested.
 */
import { oauthErrorFrom, type OAuthError } from '@withmarfa/sdk/auth';

export interface TokenResponseBody {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  error?: unknown;
  error_description?: unknown;
}

export type TokenOutcome =
  | {
      kind: 'tokens';
      accessToken: string;
      refreshToken?: string;
      expiresIn?: number;
      scope?: string;
    }
  | { kind: 'refused'; error: OAuthError };

/**
 * Turn a token or refresh response into an outcome.
 *
 * **A 2xx carrying no `access_token` is a refusal, not a success.** Both call
 * sites already treated it that way; this says so in the type rather than in a
 * condition each of them repeats.
 */
export function readTokenOutcome(status: number, body: unknown): TokenOutcome {
  const parsed = (body ?? {}) as TokenResponseBody;
  const ok = status >= 200 && status < 300;
  if (!ok || typeof parsed.access_token !== 'string' || !parsed.access_token) {
    return { kind: 'refused', error: oauthErrorFrom(status, parsed) };
  }
  return {
    kind: 'tokens',
    accessToken: parsed.access_token,
    refreshToken: parsed.refresh_token,
    expiresIn: parsed.expires_in,
    scope: parsed.scope,
  };
}
