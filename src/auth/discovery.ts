import { LocalStorage } from '@raycast/api';
import { expandBundlesToScopes, grantCoversScope } from '@withmarfa/shared';
import type { PermissionBundle } from '@withmarfa/shared';

/**
 * The server's own account of where its OAuth endpoints are and what an
 * application may ask for.
 *
 * Marfa serves an RFC 8414 authorization-server document and advertises its
 * permission bundles on it. Reading both is what lets one build of this
 * extension work against any instance: a self-host that mounts auth
 * somewhere else still signs in, and an instance whose type set differs
 * still grants everything it has.
 */

interface DiscoveryDocument {
  authorization_endpoint?: string;
  token_endpoint?: string;
  registration_endpoint?: string;
  marfa_permission_bundles?: PermissionBundle[];
}

export interface MarfaAuthConfig {
  authorizationEndpoint: string;
  tokenEndpoint: string;
  registrationEndpoint: string;
  scopes: string[];
  /** False when the server could not be reached and the fallback is in use. */
  fromServer: boolean;
}

/**
 * Scopes requested on every authorization, whatever the server advertises.
 *
 * An instance advertises permission bundles, and a bundle names item types:
 * it describes which *content* a grant may read and write. Several things
 * this extension does are not content. The detail view reads an item's
 * edges, tagging writes metadata, and every list reads the type registry.
 * Those are operations it performs against whatever content it is granted, and
 * which no bundle will ever mention. Asking for them alongside the expanded
 * bundles is not second-guessing the server, it is asking for the verbs to
 * go with the nouns.
 *
 * `offline_access` is here for a different reason, and is the one member
 * that is not an operation on a resource at all. No bundle declares it
 * because it is not a permission over data; without it every command would
 * send the user back through consent the moment the access token expired.
 * It stays in this list because the list is defined by *when* these are
 * asked for, always and unconditionally, rather than by what family they
 * belong to.
 *
 * These are deliberately not the platform's `capability.*` scopes, which are
 * a separate family naming administrative surfaces such as key management,
 * and which are granted only by being named individually. Nothing granted
 * unconditionally belongs in that family, so nothing from it belongs here.
 */
const ALWAYS_REQUESTED_SCOPES = [
  'offline_access',
  'edge.*:read',
  'edge.*:write',
  'metadata:read',
  'metadata:write',
  'metadata.types:read',
] as const;

/**
 * Used only when the discovery document cannot be read, whether from an
 * unreachable server or one predating bundles. Narrower than what a current Marfa
 * grants, which is the trade for signing in at all.
 */
const FALLBACK_SCOPES = [
  'openid',
  'profile',
  'core.*:read',
  'core.*:write',
  ...ALWAYS_REQUESTED_SCOPES,
] as const;

/**
 * **Path-aware, because the value passed here is the server URL and the
 * issuer is `<server>/auth`.** A Marfa deployment mounts its authorization
 * server under `/auth` and publishes that as its issuer identifier, and
 * RFC 8414 §3.1 forms the metadata URL by inserting the well-known segment
 * between host and issuer path, so the issuer's path is a suffix here rather
 * than a prefix.
 *
 * The bare-root form this used to request is a pre-spec alias the server
 * keeps only for clients already pinned to it, and it is going. **This
 * client fails quietly when it does**: `fetchDocument` swallows the error
 * and the caller falls back to `FALLBACK_SCOPES`, so sign-in keeps working
 * with a narrower grant and nothing says why. That is the harder failure to
 * diagnose of the two hand-rolled clients: the web app's equivalent fetch
 * hard-fails and names the instance.
 *
 * **Nothing here can catch a regression to the bare root.** This extension
 * has no test harness, so the value is held by this comment and by the
 * server's own path-aware registrations, and a wrong one would surface only
 * as a quietly narrowed grant on a live deployment.
 */
const DISCOVERY_PATH = '/.well-known/oauth-authorization-server/auth';

/** Long enough that launches are never gated on a network call, short
 *  enough that a bundle added to the server is picked up the next day. */
const DISCOVERY_TTL_MS = 24 * 60 * 60 * 1000;

function cacheKey(issuer: string): string {
  return `marfa.discovery:${issuer}`;
}

async function readCache(issuer: string): Promise<DiscoveryDocument | null> {
  const raw = await LocalStorage.getItem<string>(cacheKey(issuer));
  if (!raw) return null;
  try {
    const { fetchedAt, doc } = JSON.parse(raw) as { fetchedAt: number; doc: DiscoveryDocument };
    if (Date.now() - fetchedAt > DISCOVERY_TTL_MS) return null;
    return doc;
  } catch {
    return null;
  }
}

async function fetchDocument(issuer: string): Promise<DiscoveryDocument | null> {
  try {
    // Bounded: a captive portal or a wedged server would otherwise leave the
    // command on a spinner with nothing to show for it.
    const res = await fetch(`${issuer}${DISCOVERY_PATH}`, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;
    const doc = (await res.json()) as DiscoveryDocument;
    await LocalStorage.setItem(cacheKey(issuer), JSON.stringify({ fetchedAt: Date.now(), doc }));
    return doc;
  } catch {
    return null;
  }
}

/**
 * Resolve endpoints and scopes for an issuer.
 *
 * `refresh` forces a re-read, which a full sign-in does so that consent is
 * always asked against what the server offers right now rather than against
 * a day-old copy.
 */
export async function resolveAuthConfig(
  issuer: string,
  options: { refresh?: boolean } = {},
): Promise<MarfaAuthConfig> {
  const doc = options.refresh
    ? await fetchDocument(issuer)
    : ((await readCache(issuer)) ?? (await fetchDocument(issuer)));

  const bundles = doc?.marfa_permission_bundles ?? [];
  const scopes = bundles.length
    ? [...new Set([...expandBundlesToScopes(bundles), ...ALWAYS_REQUESTED_SCOPES])].sort()
    : [...FALLBACK_SCOPES];

  return {
    authorizationEndpoint: doc?.authorization_endpoint ?? `${issuer}/auth/oauth2/authorize`,
    tokenEndpoint: doc?.token_endpoint ?? `${issuer}/auth/oauth2/token`,
    registrationEndpoint: doc?.registration_endpoint ?? `${issuer}/auth/oauth2/register`,
    scopes,
    fromServer: Boolean(doc),
  };
}

/**
 * Which of `required` a granted scope string does not cover.
 *
 * **Coverage is the platform's question and this asks the platform.** It used
 * to walk the scope grammar here: parse each held scope, compare kinds, match
 * type patterns, and decide. That copy disagreed with the real rule on the
 * content category, where a grant of `content:read` covers every type through
 * a projection this had no arm for, and it reported the whole registry as
 * unreadable to a session that could read all of it. It also waved through any
 * requirement it could not parse, which is fail-open on the one axis where a
 * new scope family is most likely to appear.
 *
 * That is not a bug this copy happened to have. `grantCoversScope` carries a
 * docblock about five comparisons beside it that compared text, and about a
 * neighboring helper with the right shape being fail-open until a review found
 * it. A sixth was never going to end differently.
 *
 * Coverage rather than set difference is still the property that matters: a
 * token minted with `core.*:read` genuinely covers `core.note:read`, and
 * treating that as missing would re-prompt on every launch forever.
 *
 * The change with the widest reach is quieter than the content category and
 * worth naming. The copy returned on the first held pattern that matched with a
 * sufficient verb, so `core.*:write core.media.*:read` read as covering a write
 * to `core.media.book`. The request path resolves the other way, taking the
 * longest matching wildcard first, and refuses it. Answering yes where the
 * server says no is the direction that matters here, because what reads this
 * decides whether to tell someone their content is visible.
 */
export function missingScopes(granted: string | undefined, required: string[]): string[] {
  const held = (granted ?? '').split(/\s+/).filter(Boolean);

  // **A precondition, not a shortcut, and the one line here that is not the
  // platform's answer.** `grantCoversScope` reports an empty grant as covering
  // nothing, which is correct for the question it answers and wrong for this
  // one: a token whose scopes the server did not report is not evidence of a
  // narrow grant. Without this, an unknown grant reads as short of everything,
  // and the surface that consumes this decides from a shortfall. That is the
  // shape that once discarded the session on every launch and presented as
  // signing out immediately after signing in.
  if (held.length === 0) return [];

  return required.filter((scope) => !grantCoversScope(held, scope));
}

/**
 * Whether a grant permits reading a type at all.
 *
 * Consent can now narrow per type, which is the point of asking in bundles
 * rather than wildcards. The consequence is that a filter can legitimately
 * select a type this session cannot see, and an empty list is the worst
 * possible way to say so.
 */
export function isTypeGranted(granted: string | undefined, typeId: string): boolean {
  return missingScopes(granted, [`${typeId}:read`]).length === 0;
}

/**
 * Whether a session may read a type, for a surface that has to explain an
 * absence rather than render one.
 *
 * **Two of the three answers are "make no claim", and that is the whole
 * shape.** A pasted static key is not an OAuth grant, and the tokens from an
 * earlier browser sign-in survive in storage after one is set, so reading them
 * answers about a credential no request is using. An unknown grant is not
 * evidence of a narrow one either. Only a grant the server actually reported
 * can support saying a type is withheld, and saying it wrongly produces the
 * most confusing state the extension can reach: a filter reporting a type as
 * unshared while the call behind it returns that type normally.
 */
export function typeReadableBySession(
  session: { staticKey: boolean; granted: string | undefined },
  typeId: string,
): boolean {
  if (session.staticKey) return true;
  if (!session.granted) return true;
  return isTypeGranted(session.granted, typeId);
}

export interface ReconsentDecision {
  reconsent: boolean;
  /** Advertised scopes the grant does not cover. Informational when
   *  `reconsent` is false. */
  missing: string[];
  /** Record `advertised` as the last-requested set, whatever the outcome. */
  remember: boolean;
}

/**
 * Whether asking for consent again could actually change anything.
 *
 * The rule is **"has the advertisement changed since we last asked"**, not
 * "is the grant short of the advertisement". Those look equivalent and are
 * not, because a server may grant less than it advertises, and has. Whether
 * any given deployment does so today is not a fact this file can hold. Deciding
 * from the shortfall alone never terminates: each consent returns the same
 * grant, the next launch sees the same shortfall, and the session is
 * discarded on every launch forever. That shipped once; this is the guard.
 *
 * Asking again for a set already asked for cannot produce a different
 * answer, so it is never worth a person's attention.
 */
export function decideReconsent(input: {
  lastRequested: string | undefined;
  advertised: string[];
  granted: string | undefined;
}): ReconsentDecision {
  const advertised = input.advertised.join(' ');
  if (input.lastRequested === advertised) {
    return { reconsent: false, missing: [], remember: false };
  }

  const missing = missingScopes(input.granted, input.advertised);
  return { reconsent: missing.length > 0, missing, remember: true };
}
