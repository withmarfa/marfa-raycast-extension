/**
 * Where this extension keeps its registration.
 *
 * **The rule for when a stored registration must be replaced is not tested
 * here any more.** It moved to `@withmarfa/sdk/auth`, with the cases that used
 * to live in this file, because it was written twice — once here and once in
 * the CLI — and the two answers drifted until one of them could repair a
 * client the server had forgotten and the other could not. Asserting it from
 * both sides is how they drift again.
 *
 * What is left is the half that is genuinely Raycast's: the storage keys an
 * existing install is holding, and the promise that clearing a registration
 * does not touch the session beside it.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LocalStorage } from '@raycast/api';
import { CLIENT_REGISTRATION_EPOCH } from '@withmarfa/sdk/auth';
import {
  clientEpochStorageKey,
  clientIdStorageKey,
  clientScopeStorageKey,
  RaycastClientRegistrationStore,
} from '../src/auth/client-registration';

const ISSUER = 'https://marfa.example';

describe('storage keys', () => {
  it('scopes every key to its issuer', () => {
    expect(clientIdStorageKey(ISSUER)).toBe('marfa.client_id:https://marfa.example');
    expect(clientScopeStorageKey(ISSUER)).toBe('marfa.client_scope:https://marfa.example');
    expect(clientEpochStorageKey(ISSUER)).toBe('marfa.client_epoch:https://marfa.example');
  });

  it('ignores a trailing slash, so one instance is not two records', () => {
    expect(clientIdStorageKey(`${ISSUER}/`)).toBe(clientIdStorageKey(ISSUER));
  });

  it('keeps the key names an existing install is already holding', () => {
    // Renaming these would orphan every registration in the field and mint a
    // replacement for each, with nothing able to revoke the old rows.
    expect(clientIdStorageKey(ISSUER).startsWith('marfa.client_id:')).toBe(true);
    expect(clientScopeStorageKey(ISSUER).startsWith('marfa.client_scope:')).toBe(true);
  });
});

describe('RaycastClientRegistrationStore', () => {
  let store: RaycastClientRegistrationStore;

  const record = {
    clientId: 'client-a',
    issuer: ISSUER,
    claimedScope: 'openid offline_access core.*:read',
    epoch: CLIENT_REGISTRATION_EPOCH,
  };

  beforeEach(async () => {
    await LocalStorage.clear();
    store = new RaycastClientRegistrationStore();
  });

  afterEach(async () => {
    await LocalStorage.clear();
  });

  it('round-trips a registration', async () => {
    await store.write(record);
    expect(await store.read(ISSUER)).toEqual(record);
  });

  it('reads nothing when none was ever written', async () => {
    expect(await store.read(ISSUER)).toBeNull();
  });

  it('will not hand one instance a registration made for another', async () => {
    await store.write(record);
    expect(await store.read('https://other.example')).toBeNull();
  });

  it('reads a record from before epochs existed as epoch 0', async () => {
    // **What every install affected by the hosted move is holding.** Reading
    // it as 0 is what makes the shared rule replace it, so an affected install
    // heals on its next sign-in rather than needing a reinstall.
    await LocalStorage.setItem(clientIdStorageKey(ISSUER), 'legacy-client');
    await LocalStorage.setItem(clientScopeStorageKey(ISSUER), 'openid');
    expect(await store.read(ISSUER)).toMatchObject({
      clientId: 'legacy-client',
      epoch: 0,
    });
  });

  it('reads a record with no recorded claim as claiming nothing', async () => {
    await LocalStorage.setItem(clientIdStorageKey(ISSUER), 'no-claim');
    expect(await store.read(ISSUER)).toMatchObject({ claimedScope: '' });
  });

  it('clears every part of a registration and nothing else', async () => {
    await store.write(record);
    // Something else entirely, standing in for the session beside it.
    await LocalStorage.setItem('marfa.token_issuer', ISSUER);

    await store.clear(ISSUER);

    expect(await store.read(ISSUER)).toBeNull();
    expect(await LocalStorage.getItem('marfa.client_scope:https://marfa.example')).toBeUndefined();
    expect(await LocalStorage.getItem('marfa.token_issuer')).toBe(ISSUER);
  });

  it('leaves another instance alone when one is cleared', async () => {
    await store.write(record);
    await store.write({ ...record, issuer: 'https://other.example', clientId: 'client-b' });

    await store.clear(ISSUER);

    expect(await store.read(ISSUER)).toBeNull();
    expect(await store.read('https://other.example')).toMatchObject({ clientId: 'client-b' });
  });
});
