/**
 * What to do after a token endpoint refuses.
 *
 * Split out so it can be tested: the decision lives here and `marfa-oauth.ts`
 * only carries it out, because that module constructs an `OAuth.PKCEClient` at
 * import time and cannot be unit-tested at all.
 *
 * **Two failures that look alike and are not.** A dead grant means sign in
 * again with the same client. A dead client means the sign-in that follows
 * will dead-end too unless the stored registration goes with the tokens —
 * the authorize endpoint answers an unknown `client_id` by redirecting to the
 * server's own error page rather than back to the redirect URI, so no code and
 * no error ever reaches this extension and it simply waits.
 */
import { isDeadClientError } from '@withmarfa/sdk/auth';

export type RecoveryAction =
  /** The grant died. Drop the tokens and sign in again with the same client. */
  | 'reauthenticate'
  /** The client died. Drop the registration too, or the sign-in dead-ends. */
  | 'discard-client-then-reauthenticate'
  /** Transient. Keep everything and let the failure surface. */
  | 'surface';

/** The sentinel thrown when nothing was persisted to refresh against. */
export const REFRESH_STATE_MISSING = 'refresh_state_missing';

function codeOf(err: unknown): string | undefined {
  if (typeof err !== 'object' || err === null) return undefined;
  const candidate = err as { code?: unknown };
  return typeof candidate.code === 'string' ? candidate.code : undefined;
}

/**
 * After a refresh was refused.
 *
 * **`surface` is new behaviour and is the point of having a third answer.**
 * Every refresh failure used to drop the tokens, so a 503 from a server having
 * a bad minute cost a full sign-in and a consent screen. Only a refusal that
 * actually says the credential is finished should.
 */
export function afterRefreshFailure(err: unknown): RecoveryAction {
  if (err instanceof Error && err.message === REFRESH_STATE_MISSING) {
    return 'reauthenticate';
  }
  if (isDeadClientError(err)) return 'discard-client-then-reauthenticate';
  const code = codeOf(err);
  if (code === 'invalid_grant' || code === 'token_reuse_detected') {
    return 'reauthenticate';
  }
  return 'surface';
}

/**
 * After a code exchange was refused.
 *
 * The caller does not loop on the dead-client answer: it clears the
 * registration, says what happened, and lets the next launch register. One
 * browser round trip per thing the person asked for.
 */
export function afterExchangeFailure(err: unknown): RecoveryAction {
  if (isDeadClientError(err)) return 'discard-client-then-reauthenticate';
  return 'surface';
}
