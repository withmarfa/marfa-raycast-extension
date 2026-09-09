/**
 * A consent screen owed to an issuer on its next sign-in: armed by a surface,
 * spent by the sign-in that shows it.
 *
 * **The separation is the fix rather than a limitation.** The sign-in it arms
 * opens the browser and waits for a redirect, and Raycast resolves that
 * redirect back into the extension worker waiting for it. A worker belongs to a
 * command, so awaiting the flow inside an action handler leaves it in something
 * the person is about to dismiss and Raycast is entitled to unload — a view
 * command is unloaded once it is popped, and in development mode a reload
 * replaces it outright. What came back from four consecutive consent screens on
 * a real install was not an authorization code but a failure to reach the
 * worker at all. Handing the round trip to the next command launch puts it back
 * inside the entry point where the same flow already completes.
 *
 * Its own module because that leaves one boolean, one key and one ordering,
 * which a test can state exactly — where the same three inside the sign-in flow
 * could not be reached at all, since that module builds an `OAuth.PKCEClient`
 * the moment it is imported.
 */
import { LocalStorage } from '@raycast/api';
import { normalizeServerUrl } from './issuer';

/**
 * Per issuer, so pointing the extension at a different server neither inherits
 * a question asked about another one nor loses the one asked about this one.
 * That is also what lets an issuer change leave the flag alone rather than
 * discarding it beside the tokens: it is already about the server it was asked
 * of, and dropping it would silently lose a question somebody asked.
 *
 * Normalized the same way the sign-in normalizes the Server URL preference,
 * rather than merely stripped, because the value reaching here is one a person
 * typed. A trailing slash or an omitted scheme is invisible to them and
 * load-bearing to a storage key, and a key that depended on its caller having
 * normalized first would hold that property only until somebody called it from
 * somewhere new.
 */
export function forceConsentStorageKey(issuer: string): string {
  return `marfa.force_consent:${normalizeServerUrl(issuer)}`;
}

/** Arm the consent screen. The caller signs the session out separately: a valid
 *  token short-circuits the sign-in before it can spend this, so leaving one in
 *  place would arm a question nothing would ever ask. */
export async function armConsentOnNextLaunch(issuer: string): Promise<void> {
  await LocalStorage.setItem(forceConsentStorageKey(issuer), true);
}

/** Whether this issuer is owed a consent screen. */
export async function consentIsOwed(issuer: string): Promise<boolean> {
  return Boolean(await LocalStorage.getItem<boolean>(forceConsentStorageKey(issuer)));
}

/**
 * Run the sign-in that answers the armed question and clear the flag only once
 * it has, which is the whole reason this wraps rather than returns.
 *
 * **Spending it up front is the failure mode.** A person who reaches the
 * consent screen and backs out has still not seen the thing they asked to see,
 * and a flag cleared before the exchange landed would send the next launch
 * straight past it with nothing left to say a question was ever asked.
 */
export async function spendOnCompletedExchange<T>(
  issuer: string,
  exchange: () => Promise<T>,
): Promise<T> {
  const result = await exchange();
  await LocalStorage.removeItem(forceConsentStorageKey(issuer));
  return result;
}
