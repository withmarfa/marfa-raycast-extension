import { ForbiddenError, UnauthorizedError } from '@withmarfa/sdk';
import { describe, expect, it } from 'vitest';
import { resolveSessionIdentity } from '../src/session-identity';

describe('resolveSessionIdentity', () => {
  it('reports a static key as a static key', () => {
    expect(resolveSessionIdentity({ staticKey: true })).toEqual({
      authMode: 'apiKey',
      identity: 'API key',
    });
  });

  it('names the person when it can read them', () => {
    expect(
      resolveSessionIdentity({
        staticKey: false,
        profile: { email: 'a@b.com', username: 'olive' },
      }),
    ).toEqual({ authMode: 'oauth', identity: 'a@b.com (@olive)' });

    expect(resolveSessionIdentity({ staticKey: false, profile: { email: 'a@b.com' } })).toEqual({
      authMode: 'oauth',
      identity: 'a@b.com',
    });

    // The server sends null rather than omitting it for an account with no
    // handle, and `null` is not a username to put in brackets.
    expect(
      resolveSessionIdentity({ staticKey: false, profile: { email: 'a@b.com', username: null } }),
    ).toEqual({ authMode: 'oauth', identity: 'a@b.com' });
  });

  it('never reads a failed profile as a static key', () => {
    // The whole point. A refusal says nothing about which credential is in use,
    // and reporting one as the other sent diagnosis at the API key preference
    // when the actual cause was a missing scope.
    for (const error of [
      new ForbiddenError('forbidden'),
      new UnauthorizedError('unauthorized'),
      new Error('socket hang up'),
      'not an error at all',
      undefined,
    ]) {
      expect(resolveSessionIdentity({ staticKey: false, error }).authMode).toBe('oauth');
    }
  });

  it('says why the identity is missing, differently for each reason', () => {
    const forbidden = resolveSessionIdentity({
      staticKey: false,
      error: new ForbiddenError('forbidden'),
    });
    expect(forbidden.identity).toBe('Unavailable');
    expect(forbidden.note).toMatch(/profile/i);

    // Both constructed with the same message on purpose. Asserting only that
    // the two notes differ passes whenever the messages do, which is true even
    // if the code stops distinguishing the classes and falls through to
    // `error.message` for both.
    const sameMessage = 'refused';
    const forbiddenSame = resolveSessionIdentity({
      staticKey: false,
      error: new ForbiddenError(sameMessage),
    });
    const unauthorizedSame = resolveSessionIdentity({
      staticKey: false,
      error: new UnauthorizedError(sameMessage),
    });
    expect(forbiddenSame.note).not.toBe(unauthorizedSame.note);
    expect(forbiddenSame.note).not.toBe(sameMessage);
    expect(unauthorizedSame.note).not.toBe(sameMessage);

    // An unexpected failure carries its own message rather than being flattened
    // into the same sentence as a permissions refusal.
    expect(
      resolveSessionIdentity({ staticKey: false, error: new Error('socket hang up') }).note,
    ).toBe('socket hang up');
  });

  it('always has something to say, whatever it was handed', () => {
    // A thrown string, or a rejection with no reason at all, still has to
    // render a row rather than the word "undefined".
    for (const error of ['a string', undefined, null, new Error('')]) {
      const resolved = resolveSessionIdentity({ staticKey: false, error });
      expect(resolved.note).toBeTruthy();
    }
  });

  it('puts the credential ahead of the profile, not beside it', () => {
    // Both branches are reachable with the same input, so their order is a
    // decision rather than an accident. Nothing passes both today because the
    // view returns before it fetches, but a caller that did must not have a
    // pasted key reported as a browser identity.
    expect(
      resolveSessionIdentity({ staticKey: true, profile: { email: 'a@b.com', username: 'olive' } }),
    ).toEqual({ authMode: 'apiKey', identity: 'API key' });

    expect(
      resolveSessionIdentity({ staticKey: true, error: new ForbiddenError('forbidden') }),
    ).toEqual({ authMode: 'apiKey', identity: 'API key' });

    // A profile that arrived outranks an error that also did: something was
    // read, so there is a person to name.
    expect(
      resolveSessionIdentity({
        staticKey: false,
        profile: { email: 'a@b.com' },
        error: new Error('later failure'),
      }),
    ).toEqual({ authMode: 'oauth', identity: 'a@b.com' });
  });

  it('carries no note when it has a person to show', () => {
    expect(
      resolveSessionIdentity({ staticKey: false, profile: { email: 'a@b.com' } }).note,
    ).toBeUndefined();
    expect(resolveSessionIdentity({ staticKey: true }).note).toBeUndefined();
  });
});
