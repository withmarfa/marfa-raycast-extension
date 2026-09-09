import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalStorage } from '@raycast/api';
import {
  clientIdStorageKey,
  clientScopeStorageKey,
  ensureClientId,
  shouldRegisterAgain,
  uncoveredScopes,
} from '../src/auth/client-registration';

describe('uncoveredScopes', () => {
  const needed = 'openid offline_access core.*:read space.keys';

  it('names everything a short claim does not hold', () => {
    expect(uncoveredScopes('openid offline_access core.*:read', needed)).toEqual(['space.keys']);
  });

  it('is empty when the claim already holds everything asked for', () => {
    expect(uncoveredScopes(needed, needed)).toEqual([]);
    expect(uncoveredScopes(`${needed} core.*:write`, needed)).toEqual([]);
  });

  it('compares exactly, because the ceiling the server stores is compared exactly', () => {
    // A wildcard in the claim does not cover a literal beneath it. Answering
    // otherwise here would disagree with the surface that actually decides,
    // and the disagreement would show up as a permission silently missing.
    expect(uncoveredScopes('core.*:read', 'core.note:read')).toEqual(['core.note:read']);
  });

  it('is insensitive to spacing and order, since scope is an unordered set', () => {
    expect(uncoveredScopes('space.keys   openid  offline_access core.*:read', needed)).toEqual([]);
  });
});

/**
 * The rule, kept pure so both of its arms can be stated rather than inferred
 * from a storage double.
 *
 * **Two failures sit either side of this predicate and each is invisible from
 * the other's direction.** Comparing nothing froze a ceiling: an install whose
 * client predated a widened request kept presenting it, the server dropped the
 * scopes above it before drawing the consent screen, and the permission went
 * missing with nothing naming the cause. Comparing everything is the other
 * ditch: the server catches a stale ceiling up in place for any scope its
 * bundles publish, so re-registering on an ordinary bundle widening would
 * abandon a client row per user every time an operator registers a type, with
 * no route this extension can call to remove one.
 */
describe('shouldRegisterAgain', () => {
  const scope = 'openid offline_access core.note:read edge.*:read metadata:read space.keys';

  it('registers when nothing is stored', () => {
    expect(
      shouldRegisterAgain({
        storedClientId: undefined,
        claimed: undefined,
        scope,
        scopeFromServer: true,
      }),
    ).toBe(true);
  });

  it('registers for a stored client with no recorded claim', () => {
    // Written by a build that recorded none. Its ceiling could be anything and
    // nothing reads one back, so the one guess that is never wrong registers.
    expect(
      shouldRegisterAgain({
        storedClientId: 'unlabeled-client',
        claimed: undefined,
        scope,
        scopeFromServer: true,
      }),
    ).toBe(true);
  });

  it('registers when the uncovered set holds a space permission', () => {
    // The one family the server's own ceiling catch-up excludes, deliberately:
    // admitting it would let an unauthenticated request write an administrative
    // permission into a stored registration. So it is the only scope worth
    // registering again for, and the reason this whole comparison exists.
    expect(
      shouldRegisterAgain({
        storedClientId: 'stale-client',
        claimed: 'openid offline_access core.note:read edge.*:read metadata:read',
        scope,
        scopeFromServer: true,
      }),
    ).toBe(true);
  });

  it('reuses the stored client when the only gap is an ordinary bundle widening', () => {
    // An operator registered a type, so the bundles widened and this sign-in
    // asks for one scope more than the claim holds. The server widens the
    // stored ceiling in place during the very next authorize, so registering
    // here would mint and orphan a client row for a gap that repairs itself.
    expect(
      shouldRegisterAgain({
        storedClientId: 'standing-client',
        claimed: scope,
        scope: `${scope} core.recipe:read`,
        scopeFromServer: true,
      }),
    ).toBe(false);
  });

  it('reuses the stored client when the claim covers everything asked for', () => {
    expect(
      shouldRegisterAgain({
        storedClientId: 'standing-client',
        claimed: `${scope} core.*:write`,
        scope,
        scopeFromServer: true,
      }),
    ).toBe(false);
  });

  it('reuses the stored client outright when the scope set is the local fallback', () => {
    // A discovery document that failed to load leaves a set this code invented,
    // which neither covers nor is covered by the real one. Deciding from it
    // would re-register on every sign-in a flapping endpoint produced, in both
    // directions, and each pass would abandon the client the last one minted.
    expect(
      shouldRegisterAgain({
        storedClientId: 'standing-client',
        claimed: scope,
        scope: 'openid profile core.*:read core.*:write offline_access space.keys',
        scopeFromServer: false,
      }),
    ).toBe(false);
  });

  it('still registers on a fallback set when there is no client at all', () => {
    // Signing in against an unreachable document is worse than a narrow client
    // and better than no client; the narrow claim it records is corrected by
    // the first sign-in that reads a real document.
    expect(
      shouldRegisterAgain({
        storedClientId: undefined,
        claimed: undefined,
        scope: 'openid profile core.*:read core.*:write offline_access space.keys',
        scopeFromServer: false,
      }),
    ).toBe(true);
  });
});

/**
 * The wiring, not the rule.
 *
 * What shipped broken was where the comparison was consulted, so these assert
 * the call: moving the check back behind a flag, or dropping the claim write,
 * reddens rather than reading as a tidy-up.
 */
describe('ensureClientId', () => {
  const issuer = 'https://marfa.example';
  const registrationEndpoint = `${issuer}/auth/oauth2/register`;
  const redirectUri = 'https://raycast.com/redirect?packageName=Extension';
  const askedFor = 'openid offline_access core.note:read edge.*:read metadata:read space.keys';
  const withoutKeys = 'openid offline_access core.note:read edge.*:read metadata:read';

  let register: ReturnType<typeof vi.fn>;

  function call(overrides: Partial<Parameters<typeof ensureClientId>[0]> = {}) {
    return ensureClientId({
      issuer,
      registrationEndpoint,
      redirectUri,
      scope: askedFor,
      scopeFromServer: true,
      ...overrides,
    });
  }

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

  it('registers again when the stored claim is short a space permission', async () => {
    await LocalStorage.setItem(clientIdStorageKey(issuer), 'stale-client');
    await LocalStorage.setItem(clientScopeStorageKey(issuer), withoutKeys);

    const id = await call();

    expect(register).toHaveBeenCalledTimes(1);
    expect(id).toBe('fresh-client');
    // The new claim is recorded, so the next sign-in reuses this client rather
    // than registering a third one for the same request.
    expect(await LocalStorage.getItem(clientIdStorageKey(issuer))).toBe('fresh-client');
    expect(await LocalStorage.getItem(clientScopeStorageKey(issuer))).toBe(askedFor);
  });

  it('reuses the stored client when the gap is only bundle-published scopes', async () => {
    await LocalStorage.setItem(clientIdStorageKey(issuer), 'standing-client');
    await LocalStorage.setItem(clientScopeStorageKey(issuer), askedFor);

    const id = await call({ scope: `${askedFor} core.recipe:read` });

    expect(register).not.toHaveBeenCalled();
    expect(id).toBe('standing-client');
    // The claim still describes the registration that actually happened, so a
    // later sign-in short a space permission is still measured against it.
    expect(await LocalStorage.getItem(clientScopeStorageKey(issuer))).toBe(askedFor);
  });

  it('reuses a stored client whose claim covers everything asked for', async () => {
    await LocalStorage.setItem(clientIdStorageKey(issuer), 'standing-client');
    await LocalStorage.setItem(clientScopeStorageKey(issuer), `${askedFor} core.*:write`);

    const id = await call();

    expect(register).not.toHaveBeenCalled();
    expect(id).toBe('standing-client');
  });

  it('registers again for a client stored without a recorded claim', async () => {
    await LocalStorage.setItem(clientIdStorageKey(issuer), 'unlabeled-client');

    const id = await call();

    expect(register).toHaveBeenCalledTimes(1);
    expect(id).toBe('fresh-client');
  });

  it('registers when nothing is stored at all', async () => {
    const id = await call();

    expect(register).toHaveBeenCalledTimes(1);
    expect(id).toBe('fresh-client');
  });

  it('never rewrites a recorded claim from a fallback scope set', async () => {
    // The fallback is a set this code invented, so what it names is evidence
    // about nothing. Writing it over the claim would replace a record of a real
    // registration with a description of a request that never went out.
    await LocalStorage.setItem(clientIdStorageKey(issuer), 'standing-client');
    await LocalStorage.setItem(clientScopeStorageKey(issuer), askedFor);

    const id = await call({ scope: withoutKeys, scopeFromServer: false });

    expect(register).not.toHaveBeenCalled();
    expect(id).toBe('standing-client');
    expect(await LocalStorage.getItem(clientScopeStorageKey(issuer))).toBe(askedFor);
  });

  it('leaves the stored client and its claim untouched when registration fails', async () => {
    // A failed registration must not cost the client that is still working.
    // Writing the id or the claim before the response landed would replace a
    // usable registration with one the server never issued.
    await LocalStorage.setItem(clientIdStorageKey(issuer), 'stale-client');
    await LocalStorage.setItem(clientScopeStorageKey(issuer), withoutKeys);
    register.mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({}),
      text: async () => 'upstream unavailable',
    } as unknown as Response);

    await expect(call()).rejects.toThrow(/503/);

    expect(await LocalStorage.getItem(clientIdStorageKey(issuer))).toBe('stale-client');
    expect(await LocalStorage.getItem(clientScopeStorageKey(issuer))).toBe(withoutKeys);
  });

  it('declares the scope it is about to request, which is what sets the ceiling', async () => {
    await call();

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
    const id = await call({ issuer: other, registrationEndpoint: `${other}/auth/oauth2/register` });

    expect(id).toBe('fresh-client');
    expect(await LocalStorage.getItem(clientIdStorageKey(issuer))).toBe('standing-client');
  });
});
