/**
 * Reading a token endpoint's refusal, and deciding what it costs.
 *
 * Both of these used to be unreachable from a test: the refusal code was
 * interpolated into a message string and thrown away, and the decision lived
 * inside a module that builds an `OAuth.PKCEClient` at import time. The
 * consequence was the bug — a client the server had forgotten was
 * indistinguishable from an expired grant, so the extension signed in again
 * with the same dead id, forever.
 */
import { describe, expect, it } from 'vitest';
import { OAuthError } from '@withmarfa/sdk/auth';
import { readTokenOutcome } from '../src/auth/token-response';
import {
  afterExchangeFailure,
  afterRefreshFailure,
  REFRESH_STATE_MISSING,
} from '../src/auth/recovery';

describe('readTokenOutcome', () => {
  it('reads a successful exchange', () => {
    const outcome = readTokenOutcome(200, {
      access_token: 'at',
      refresh_token: 'rt',
      expires_in: 3600,
      scope: 'openid',
    });
    expect(outcome).toEqual({
      kind: 'tokens',
      accessToken: 'at',
      refreshToken: 'rt',
      expiresIn: 3600,
      scope: 'openid',
    });
  });

  it('keeps the refusal code rather than a sentence about it', () => {
    const outcome = readTokenOutcome(400, {
      error: 'invalid_client',
      error_description: 'no such client',
    });
    expect(outcome.kind).toBe('refused');
    if (outcome.kind !== 'refused') throw new Error('unreachable');
    expect(outcome.error.code).toBe('invalid_client');
  });

  it('reads the structured shape the device routes return', () => {
    const outcome = readTokenOutcome(400, { error: { code: 'invalid_grant' } });
    if (outcome.kind !== 'refused') throw new Error('unreachable');
    expect(outcome.error.code).toBe('invalid_grant');
  });

  it('treats a 2xx carrying no access token as a refusal', () => {
    // The old code already did, in a condition each call site repeated. This
    // says it once, in the type.
    expect(readTokenOutcome(200, {}).kind).toBe('refused');
  });

  it('survives a body that is not JSON at all', () => {
    const outcome = readTokenOutcome(502, 'gateway sadness');
    if (outcome.kind !== 'refused') throw new Error('unreachable');
    expect(outcome.error.code).toBe('server_error');
  });
});

describe('afterRefreshFailure', () => {
  it('drops the registration too when the client is gone', () => {
    // Signing in again with a dead client dead-ends on the issuer's error
    // page, with no code and no error ever reaching the extension.
    expect(afterRefreshFailure(new OAuthError('invalid_client', 'gone'))).toBe(
      'discard-client-then-reauthenticate',
    );
  });

  it('keeps the client when only the grant died', () => {
    expect(afterRefreshFailure(new OAuthError('invalid_grant', 'expired'))).toBe(
      'reauthenticate',
    );
    expect(afterRefreshFailure(new OAuthError('token_reuse_detected', 'replayed'))).toBe(
      'reauthenticate',
    );
  });

  it('signs in again when nothing was persisted to refresh against', () => {
    expect(afterRefreshFailure(new Error(REFRESH_STATE_MISSING))).toBe('reauthenticate');
  });

  it('keeps everything when the failure says nothing about the credential', () => {
    // **This is new behaviour and the reason there are three answers.** Every
    // refresh failure used to drop the tokens, so a server having a bad minute
    // cost a full sign-in and a consent screen.
    expect(afterRefreshFailure(new OAuthError('temporarily_unavailable', '503'))).toBe(
      'surface',
    );
    expect(afterRefreshFailure(new Error('socket hang up'))).toBe('surface');
  });
});

describe('afterExchangeFailure', () => {
  it('drops the registration when the client is gone', () => {
    expect(afterExchangeFailure(new OAuthError('invalid_client', 'gone'))).toBe(
      'discard-client-then-reauthenticate',
    );
  });

  it('surfaces anything else rather than retrying into a second browser window', () => {
    expect(afterExchangeFailure(new OAuthError('invalid_grant', 'bad code'))).toBe('surface');
  });
});
