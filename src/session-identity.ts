import { ForbiddenError, UnauthorizedError } from '@withmarfa/sdk';

export interface SessionIdentity {
  authMode: 'oauth' | 'apiKey';
  /** The signed-in person, or a stand-in when they cannot be read. */
  identity: string;
  /** Why `identity` is not a person. Absent when it is one. */
  note?: string;
}

/**
 * What a session is authenticated as, and who it belongs to.
 *
 * **The credential in use decides the first of those, and the outcome of a
 * request decides only the second.** They were previously the same answer: a
 * failure to read the profile returned "API key", so every browser sign-in was
 * reported as a pasted static key. The profile route is gated on a scope no
 * shipped bundle grants, so that failure is the ordinary case rather than an
 * exceptional one, and the command whose whole purpose is telling an operator
 * what their session is gave the wrong answer every time. It cost an hour
 * before anyone doubted it.
 *
 * Pure and separate from the view because this rule is the point of the
 * command, and a rule worth stating is worth asserting.
 */
export function resolveSessionIdentity(input: {
  /** Whether a static key is configured, which is what the client branches on. */
  staticKey: boolean;
  profile?: { email: string; username?: string | null };
  error?: unknown;
}): SessionIdentity {
  if (input.staticKey) {
    return { authMode: 'apiKey', identity: 'API key' };
  }

  if (input.profile) {
    const { email, username } = input.profile;
    return { authMode: 'oauth', identity: username ? `${email} (@${username})` : email };
  }

  // Still OAuth. Whatever went wrong, nothing here has learned anything about
  // the credential, and saying otherwise is the defect this function exists to
  // remove.
  return { authMode: 'oauth', identity: 'Unavailable', note: describeFailure(input.error) };
}

function describeFailure(error: unknown): string {
  // Deliberately says what this session lacks rather than what the server
  // offers. Which bundles carry which scopes is a fact about a deployment on a
  // given day, and a message asserting it here would be wrong the moment one
  // changes, on a screen a person reads precisely when they are confused.
  if (error instanceof ForbiddenError) {
    return 'This sign-in was not granted access to your profile, which this reads.';
  }
  if (error instanceof UnauthorizedError) {
    return 'The server did not accept this session.';
  }
  if (error instanceof Error && error.message) return error.message;
  return 'The profile could not be read.';
}
