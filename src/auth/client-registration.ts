/**
 * Where this extension keeps the client it registered, per issuer.
 *
 * **The rule for when a stored registration must be replaced is not here any
 * more.** It lives in `@withmarfa/sdk/auth`, alongside the registration call
 * and the repair, because it was written twice — once here and once in the
 * CLI — and the two answers drifted. The CLI learned to repair a client the
 * server had forgotten and this extension never did, which is what left it
 * presenting a dead id with no route back but a reinstall. What stays here is
 * the part that genuinely belongs to Raycast: where the record is kept.
 *
 * The key names are unchanged, so an existing install's record is found rather
 * than orphaned. The epoch is new and absent from every record written before
 * it, which reads as 0 and is what makes those installs re-register once.
 */
import { LocalStorage } from '@raycast/api';
import type { ClientRegistrationStore, StoredClientRegistration } from '@withmarfa/sdk/auth';
import { stripTrailingSlash } from './issuer';

export function clientIdStorageKey(issuer: string): string {
  return `marfa.client_id:${stripTrailingSlash(issuer)}`;
}

/** The scope the stored client was registered claiming. Kept because a
 *  ceiling is invisible from here — nothing reads it back — so this is the
 *  only way to know what the stored client can carry. */
export function clientScopeStorageKey(issuer: string): string {
  return `marfa.client_scope:${stripTrailingSlash(issuer)}`;
}

/** The registration epoch the stored client was written under. */
export function clientEpochStorageKey(issuer: string): string {
  return `marfa.client_epoch:${stripTrailingSlash(issuer)}`;
}

/**
 * Raycast's `LocalStorage`, behind the SDK's store contract.
 *
 * `clear` removes the registration and nothing else. The tokens live in
 * Raycast's own `OAuth.PKCEClient` store, and a client the server has
 * forgotten is a different failure from a session that has ended.
 */
export class RaycastClientRegistrationStore implements ClientRegistrationStore {
  async read(issuer: string): Promise<StoredClientRegistration | null> {
    const [clientId, claimed, epoch] = await Promise.all([
      LocalStorage.getItem<string>(clientIdStorageKey(issuer)),
      LocalStorage.getItem<string>(clientScopeStorageKey(issuer)),
      LocalStorage.getItem<string>(clientEpochStorageKey(issuer)),
    ]);
    if (!clientId) return null;
    return {
      clientId,
      issuer: stripTrailingSlash(issuer),
      claimedScope: claimed ?? '',
      // A record written before epochs existed carries none, and 0 is what
      // makes the rule treat it as one to replace.
      epoch: Number(epoch ?? 0) || 0,
    };
  }

  async write(record: StoredClientRegistration): Promise<void> {
    await Promise.all([
      LocalStorage.setItem(clientIdStorageKey(record.issuer), record.clientId),
      LocalStorage.setItem(clientScopeStorageKey(record.issuer), record.claimedScope),
      LocalStorage.setItem(clientEpochStorageKey(record.issuer), String(record.epoch)),
    ]);
  }

  async clear(issuer: string): Promise<void> {
    await Promise.all([
      LocalStorage.removeItem(clientIdStorageKey(issuer)),
      LocalStorage.removeItem(clientScopeStorageKey(issuer)),
      LocalStorage.removeItem(clientEpochStorageKey(issuer)),
    ]);
  }
}

/** What this extension is, as a registered OAuth client. */
export const RAYCAST_CLIENT_NAME = 'Marfa for Raycast';
