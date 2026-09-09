/**
 * The dynamically registered OAuth client for an issuer, and the rule that
 * decides whether the stored one is still usable.
 *
 * **A registration freezes a ceiling, and nothing reads it back.** The server
 * stores the scope a registration declared, and the authorize surface then
 * *narrows* a request rather than refusing it: a scope above the ceiling is
 * dropped before the consent screen is drawn. So a client registered by an
 * older build of this extension keeps working, keeps signing people in, and
 * keeps quietly losing whatever the extension has learned to ask for since.
 * Nothing on the wire says so — the consent screen simply never mentions the
 * missing permission and the grant comes back without it.
 *
 * Recording the scope claimed at registration is therefore the only way to know
 * what the stored client can carry, and comparing that record against the
 * current request on **every** sign-in is the only way to notice in time. An
 * earlier build compared it only when a caller asked for a renewal, which made
 * the ordinary sign-in the one path that could never repair itself.
 *
 * **Comparing on every sign-in is not the same as registering on every
 * shortfall, and conflating the two is the opposite ditch.** The server catches
 * a stale ceiling up in place, during the very authorize that finds it short,
 * for any scope its permission bundles publish. An operator registering a type
 * widens the bundles and therefore widens this request, and that gap repairs
 * itself for free. Registering for it instead would mint and abandon a client
 * row per user every time a type is added, with no route this extension can
 * call to remove one: a refused sign-in is loud, an orphaned client is not.
 *
 * Lives apart from the sign-in flow so a test can reach it: the flow builds an
 * `OAuth.PKCEClient` at import time, and nothing here needs one.
 */
import { LocalStorage } from '@raycast/api';
import { isSpacePermission } from '@withmarfa/shared';
import { buildRegistrationBody } from './registration-body';
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

/**
 * Which scopes of `needed` a registration claiming `claimed` does not hold.
 *
 * Exact membership, because the server compares its stored ceiling exactly —
 * every reader of a ceiling is a plain membership test, and treating a
 * wildcard here as covering a literal would disagree with the surface that
 * decides.
 *
 * The uncovered list rather than a yes or no, because what to do about a gap
 * depends on which scopes are in it: the server repairs some of them itself
 * and refuses to repair others.
 */
export function uncoveredScopes(claimed: string, needed: string): string[] {
  const held = new Set(claimed.split(/\s+/).filter(Boolean));
  return needed
    .split(/\s+/)
    .filter(Boolean)
    .filter((scope) => !held.has(scope));
}

/**
 * Whether this sign-in has to register a client rather than reuse the stored
 * one. Pure, so both arms can be stated rather than inferred from storage.
 *
 * Three things make it true, and each is a different kind of not knowing.
 *
 * **No stored client**, which needs no explanation.
 *
 * **No recorded claim.** A build that did not write one down left an id whose
 * ceiling could be anything, and there is no route to ask the server what it
 * is. The one guess that is never wrong registers again.
 *
 * **A space permission among the uncovered scopes.** That family is excluded
 * from the server's ceiling catch-up, deliberately: admitting it would let an
 * unauthenticated request write an administrative permission into a stored
 * registration. So it is the only family a client has to be registered again to
 * obtain, and a gap holding nothing else is one the next authorize closes on
 * its own.
 *
 * `scopeFromServer` is false when the discovery document could not be read and
 * the caller is holding this repository's fallback list. **A scope set this
 * code invented is evidence about nothing**, least of all about a ceiling: it
 * neither covers nor is covered by what a real instance advertises, so deciding
 * from it would re-register on every sign-in a flapping endpoint produced, in
 * both directions, each pass abandoning the client the last one minted. A
 * stored client is reused untouched instead; only the case with no client at
 * all still registers, because signing in against an unreachable document is
 * worse than a narrow client and better than none.
 *
 * **One gap this cannot see, worth knowing before adding to the request.** The
 * catch-up covers what the bundles publish, and the bundles publish content
 * scopes; the operation scopes this extension unions in unconditionally
 * (`edge.*`, `metadata*`, `offline_access`) sit outside them, exactly as a
 * space permission does. They are safe here only because they are constant, so
 * any claim this build recorded already holds them. A future build adding one
 * without a space permission beside it would land in a gap this predicate calls
 * self-healing and the server would not repair.
 */
export function shouldRegisterAgain(session: {
  storedClientId: string | undefined;
  claimed: string | undefined;
  scope: string;
  scopeFromServer: boolean;
}): boolean {
  if (!session.storedClientId) return true;
  if (!session.scopeFromServer) return false;
  if (session.claimed === undefined) return true;
  return uncoveredScopes(session.claimed, session.scope).some(isSpacePermission);
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
 * The client id for this issuer, registering one whenever
 * {@link shouldRegisterAgain} says the stored one cannot carry what this
 * sign-in is about to ask for.
 *
 * Nothing is written until the server has answered, so a registration that
 * fails leaves the client that is still working exactly where it was.
 */
export async function ensureClientId(options: {
  issuer: string;
  registrationEndpoint: string;
  redirectUri: string;
  scope: string;
  /** False when the discovery document could not be read and `scope` is this
   *  repository's fallback list rather than the instance's own. */
  scopeFromServer: boolean;
}): Promise<string> {
  const { issuer, registrationEndpoint, redirectUri, scope, scopeFromServer } = options;
  const storedClientId = await LocalStorage.getItem<string>(clientIdStorageKey(issuer));
  const claimed = await LocalStorage.getItem<string>(clientScopeStorageKey(issuer));

  if (storedClientId && !shouldRegisterAgain({ storedClientId, claimed, scope, scopeFromServer })) {
    return storedClientId;
  }

  const id = await dcrRegister(registrationEndpoint, redirectUri, scope);
  await LocalStorage.setItem(clientIdStorageKey(issuer), id);
  await LocalStorage.setItem(clientScopeStorageKey(issuer), scope);
  return id;
}
