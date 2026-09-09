import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalStorage } from '@raycast/api';
import {
  claimCovers,
  clientIdStorageKey,
  clientScopeStorageKey,
  ensureClientId,
} from '../src/auth/client-registration';

describe('claimCovers', () => {
  const needed = 'openid offline_access core.*:read space.keys';

  it('is false when nothing was recorded, so an unknown client is registered again', () => {
    // A client stored by a build that did not record its claim: the safe
    // answer is to register again, since the ceiling could be anything.
    expect(claimCovers(undefined, needed)).toBe(false);
  });

  it('is false when the claim is short, which is the case worth catching', () => {
    expect(claimCovers('openid offline_access core.*:read', needed)).toBe(false);
  });

  it('is true when the claim already holds everything asked for', () => {
    // What makes a repeated sign-in idempotent: an explicit re-consent the
    // person cancels and retries must not mint a client on every attempt.
    expect(claimCovers(needed, needed)).toBe(true);
    expect(claimCovers(`${needed} core.*:write`, needed)).toBe(true);
  });

  it('compares exactly, because the ceiling the server stores is compared exactly', () => {
    // A wildcard in the claim does not cover a literal beneath it. Answering
    // otherwise here would disagree with the surface that actually decides,
    // and the disagreement would show up as a permission silently missing.
    expect(claimCovers('core.*:read', 'core.note:read')).toBe(false);
  });

  it('is insensitive to spacing and order, since scope is an unordered set', () => {
    expect(claimCovers('space.keys   openid  offline_access core.*:read', needed)).toBe(true);
  });
});

/**
 * The wiring, not the predicate.
 *
 * `claimCovers` above has always been right; what shipped broken was where it
 * was consulted. An ordinary sign-in returned the stored client without looking
 * at the claim at all, so an install whose client predated a widened request
 * kept presenting a frozen ceiling, the server dropped the scopes above it
 * before drawing the consent screen, and the permission went missing with
 * nothing naming the cause. These assert the call, so moving the check back
 * behind a flag reddens rather than reading as a tidy-up.
 */
describe('ensureClientId', () => {
  const issuer = 'https://marfa.example';
  const registrationEndpoint = `${issuer}/auth/oauth2/register`;
  const redirectUri = 'https://raycast.com/redirect?packageName=Extension';
  const askedFor = 'openid offline_access core.*:read edge.*:read metadata:read space.keys';
  const narrower = 'openid offline_access core.*:read';

  let register: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    await LocalStorage.clear();
    register = vi.fn(
      async () =>
        ({
          ok: true,
          status: 201,
          json: async () => ({ client_id: 'fresh-client' }),
          text: async () => '',
        }) as unknown as Response,
    );
    vi.stubGlobal('fetch', register);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('registers again when the stored claim does not cover this sign-in', async () => {
    await LocalStorage.setItem(clientIdStorageKey(issuer), 'stale-client');
    await LocalStorage.setItem(clientScopeStorageKey(issuer), narrower);

    const id = await ensureClientId(issuer, registrationEndpoint, redirectUri, askedFor);

    expect(register).toHaveBeenCalledTimes(1);
    expect(id).toBe('fresh-client');
    // The new claim is recorded, so the next sign-in reuses this client rather
    // than registering a third one for the same request.
    expect(await LocalStorage.getItem(clientIdStorageKey(issuer))).toBe('fresh-client');
    expect(await LocalStorage.getItem(clientScopeStorageKey(issuer))).toBe(askedFor);
  });

  it('reuses a stored client whose claim covers everything asked for', async () => {
    await LocalStorage.setItem(clientIdStorageKey(issuer), 'standing-client');
    await LocalStorage.setItem(clientScopeStorageKey(issuer), `${askedFor} core.*:write`);

    const id = await ensureClientId(issuer, registrationEndpoint, redirectUri, askedFor);

    expect(register).not.toHaveBeenCalled();
    expect(id).toBe('standing-client');
  });

  it('registers again for a client stored without a recorded claim', async () => {
    // Written by a build that did not record one. Its ceiling could be
    // anything, and there is no way to ask the server what it is.
    await LocalStorage.setItem(clientIdStorageKey(issuer), 'unlabeled-client');

    const id = await ensureClientId(issuer, registrationEndpoint, redirectUri, askedFor);

    expect(register).toHaveBeenCalledTimes(1);
    expect(id).toBe('fresh-client');
  });

  it('registers when nothing is stored at all', async () => {
    const id = await ensureClientId(issuer, registrationEndpoint, redirectUri, askedFor);

    expect(register).toHaveBeenCalledTimes(1);
    expect(id).toBe('fresh-client');
  });

  it('declares the scope it is about to request, which is what sets the ceiling', async () => {
    await ensureClientId(issuer, registrationEndpoint, redirectUri, askedFor);

    const [url, init] = register.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(registrationEndpoint);
    expect(JSON.parse(String(init.body)) as Record<string, unknown>).toMatchObject({
      scope: askedFor,
      redirect_uris: [redirectUri],
    });
  });

  it('scopes the stored client to its issuer, so a second instance registers its own', async () => {
    await LocalStorage.setItem(clientIdStorageKey(issuer), 'standing-client');
    await LocalStorage.setItem(clientScopeStorageKey(issuer), askedFor);

    const other = 'https://other.example';
    const id = await ensureClientId(other, `${other}/auth/oauth2/register`, redirectUri, askedFor);

    expect(id).toBe('fresh-client');
    expect(await LocalStorage.getItem(clientIdStorageKey(issuer))).toBe('standing-client');
  });
});
