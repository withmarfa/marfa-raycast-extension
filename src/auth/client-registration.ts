/**
 * The dynamically registered OAuth client for an issuer, and the rule that
 * decides whether the stored one is still usable.
 *
 * **A registration freezes a ceiling, and nothing reads it back.** The server
 * stores the scope a registration declared and never widens it for the families
 * that matter here, and the authorize surface then *narrows* a request rather
 * than refusing it: a scope above the ceiling is dropped before the consent
 * screen is drawn. So a client registered by an older build of this extension
 * keeps working, keeps signing people in, and keeps quietly losing whatever the
 * extension has learned to ask for since. Nothing on the wire says so — the
 * consent screen simply never mentions the missing permission and the grant
 * comes back without it.
 *
 * Recording the scope claimed at registration is therefore the only way to know
 * whether registering again would change anything, and comparing that record
 * against the current request on **every** sign-in is the only way to notice in
 * time. An earlier build compared it only when a caller asked for a renewal,
 * which made the ordinary sign-in the one path that could never repair itself.
 *
 * Lives apart from the sign-in flow so a test can reach it: the flow builds an
 * `OAuth.PKCEClient` at import time, and nothing here needs one.
 */
import { LocalStorage } from '@raycast/api';
import { buildRegistrationBody } from './registration-body';
import { stripTrailingSlash } from './issuer';

export function clientIdStorageKey(issuer: string): string {
  return `marfa.client_id:${stripTrailingSlash(issuer)}`;
}

/** The scope the stored client was registered claiming. Kept because a
 *  ceiling is invisible from here — nothing reads it back — so this is the
 *  only way to know whether registering again would change anything. */
export function clientScopeStorageKey(issuer: string): string {
  return `marfa.client_scope:${stripTrailingSlash(issuer)}`;
}

/**
 * Whether a registration claiming `claimed` still covers everything `needed`
 * asks for.
 *
 * Exact membership, because the server compares its stored ceiling exactly —
 * every reader of a ceiling is a plain membership test, and treating a
 * wildcard here as covering a literal would disagree with the surface that
 * decides.
 *
 * **A client with no recorded claim covers nothing.** It was registered by a
 * build that did not write one down, so its ceiling could be anything, and the
 * one guess that is never wrong is the one that registers again.
 *
 * This is also what keeps a repeated sign-in idempotent. Without it, a person
 * who reaches the consent screen and cancels mints and abandons a client on
 * every retry, because nothing records that the client already standing has
 * claimed what is being asked for.
 */
export function claimCovers(claimed: string | undefined, needed: string): boolean {
  if (claimed === undefined) return false;
  const held = new Set(claimed.split(/\s+/).filter(Boolean));
  return needed
    .split(/\s+/)
    .filter(Boolean)
    .every((scope) => held.has(scope));
}

interface DcrResponse {
  client_id?: string;
}

/**
 * Dynamic-client-registration against the issuer's registration endpoint. The
 * `redirect_uris` passed here must include the exact URI the sign-in goes on to
 * use on `authorize`.
 *
 * **`scope` is not optional, and omitting it fails silently.** A registration
 * naming nothing receives the server's default bundle expansion, which by
 * design never carries a space permission, and every later sign-in is capped
 * there. Declaring it is what puts a permission in the row the consent screen
 * is built from.
 */
async function dcrRegister(
  registrationEndpoint: string,
  redirectUri: string,
  scope: string,
): Promise<string> {
  const res = await fetch(registrationEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(
      buildRegistrationBody({ clientName: 'Marfa for Raycast', redirectUri, scope }),
    ),
  });
  if (!res.ok) {
    throw new Error(`Client registration failed (HTTP ${res.status}): ${await res.text()}`);
  }
  const body = (await res.json()) as DcrResponse;
  if (!body.client_id) {
    throw new Error('Client registration response missing client_id');
  }
  return body.client_id;
}

/**
 * The client id for this issuer, registering one whenever the stored client
 * cannot carry what this sign-in is about to ask for.
 *
 * Reuse is conditional on the recorded claim covering the request, and on
 * nothing else. A stored id alone proves only that some registration once
 * happened; what it claimed is the half that decides whether the consent screen
 * will be able to offer everything this sign-in wants.
 */
export async function ensureClientId(
  issuer: string,
  registrationEndpoint: string,
  redirectUri: string,
  scope: string,
): Promise<string> {
  const stored = await LocalStorage.getItem<string>(clientIdStorageKey(issuer));
  if (stored) {
    const claimed = await LocalStorage.getItem<string>(clientScopeStorageKey(issuer));
    if (claimCovers(claimed, scope)) return stored;
  }
  const id = await dcrRegister(registrationEndpoint, redirectUri, scope);
  await LocalStorage.setItem(clientIdStorageKey(issuer), id);
  await LocalStorage.setItem(clientScopeStorageKey(issuer), scope);
  return id;
}
