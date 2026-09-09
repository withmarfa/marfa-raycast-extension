import { beforeEach, describe, expect, it } from 'vitest';
import { LocalStorage } from '@raycast/api';
import {
  armConsentOnNextLaunch,
  consentIsOwed,
  forceConsentStorageKey,
  spendOnCompletedExchange,
} from '../src/auth/force-consent';

/**
 * The armed consent screen, which nothing covered while it lived inside the
 * sign-in module.
 *
 * It is one boolean in storage and every property that matters about it is an
 * ordering or a key shape, both of which a test can state exactly. What it
 * replaced ran the browser round trip inside an action handler and lost four
 * consecutive consent screens on a real install, so the value of arming rather
 * than asking is precisely that the asking happens somewhere else — which makes
 * "is it still armed" the only question left, and worth pinning.
 */
describe('force consent', () => {
  const issuer = 'https://marfa.example';

  beforeEach(async () => {
    await LocalStorage.clear();
  });

  describe('the key', () => {
    it('lands on the same key for every spelling of one server', () => {
      // The value reaching this comes from the Server URL preference, which a
      // person types. A trailing slash or an omitted scheme is invisible to
      // them and load-bearing to a storage key, so arming from one screen and
      // reading from another must not become two questions about one instance.
      expect(forceConsentStorageKey('https://marfa.example/')).toBe(
        forceConsentStorageKey(issuer),
      );
      expect(forceConsentStorageKey('marfa.example')).toBe(forceConsentStorageKey(issuer));
    });

    it('separates two servers, which is what lets an issuer change park it', () => {
      // Pointing the extension at a different server discards the tokens minted
      // by the old one. The armed question is not discarded with them: it is
      // keyed by issuer, so it is already about the server it was asked of, and
      // dropping it would silently lose a question someone asked.
      expect(forceConsentStorageKey('https://other.example')).not.toBe(
        forceConsentStorageKey(issuer),
      );
    });
  });

  it('owes nothing until something arms it', async () => {
    expect(await consentIsOwed(issuer)).toBe(false);
  });

  it('owes a consent screen once armed, on every spelling of that issuer', async () => {
    await armConsentOnNextLaunch('https://marfa.example/');

    expect(await consentIsOwed(issuer)).toBe(true);
  });

  it('arms only the issuer it was asked about', async () => {
    await armConsentOnNextLaunch(issuer);

    expect(await consentIsOwed('https://other.example')).toBe(false);
  });

  describe('spending it', () => {
    it('clears the flag only after the exchange resolves', async () => {
      await armConsentOnNextLaunch(issuer);
      const owedDuringExchange: boolean[] = [];

      const token = await spendOnCompletedExchange(issuer, async () => {
        owedDuringExchange.push(await consentIsOwed(issuer));
        return 'access-token';
      });

      expect(token).toBe('access-token');
      // Still owed while the browser round trip is in flight: a flag spent up
      // front is a question nobody answered, and the launch after a person
      // backs out of the consent screen would sail straight past it.
      expect(owedDuringExchange).toEqual([true]);
      expect(await consentIsOwed(issuer)).toBe(false);
    });

    it('leaves the flag armed when the exchange fails', async () => {
      await armConsentOnNextLaunch(issuer);

      await expect(
        spendOnCompletedExchange(issuer, () => Promise.reject(new Error('token exchange failed'))),
      ).rejects.toThrow('token exchange failed');

      expect(await consentIsOwed(issuer)).toBe(true);
    });
  });
});
