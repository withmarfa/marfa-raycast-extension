import { LocalStorage } from '@raycast/api';
import { expandBundlesToScopes, parseScope, typeMatchesPattern } from '@withmarfa/shared';
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
 * edges, tagging writes metadata, and every list reads the type registry —
 * operations it performs against whatever content it is granted, and which
 * no bundle will ever mention. Asking for them alongside the expanded
 * bundles is not second-guessing the server, it is asking for the verbs to
 * go with the nouns.
 *
 * `offline_access` is here for a different reason, and is the one member
 * that is not an operation on a resource at all. No bundle declares it
 * because it is not a permission over data; without it every command would
 * send the user back through consent the moment the access token expired.
 * It stays in this list because the list is defined by *when* these are
 * asked for — always, unconditionally — rather than by what family they
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
 * Used only when the discovery document cannot be read — an unreachable
 * server, or one predating bundles. Narrower than what a current Marfa
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
 * between host and issuer path — so the issuer's path is a suffix here, not
 * a prefix.
 *
 * The bare-root form this used to request is a pre-spec alias the server
 * keeps only for clients already pinned to it, and it is going. **This
 * client fails quietly when it does**: `fetchDocument` swallows the error
 * and the caller falls back to `FALLBACK_SCOPES`, so sign-in keeps working
 * with a narrower grant and nothing says why. That is the harder failure to
 * diagnose of the two hand-rolled clients — the web app's equivalent fetch
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
 * Coverage rather than set difference, because a broader grant is not a
 * shortfall: a token minted with `core.*:read` genuinely covers
 * `core.note:read`, and treating that as missing would re-prompt on every
 * launch forever. Only a scope nothing held can satisfy counts.
 *
 * An unknown grant returns nothing missing. A token whose scope the server
 * did not report is not evidence of a narrow grant, and guessing would put
 * a consent screen in front of someone for no reason.
 */
export function missingScopes(granted: string | undefined, required: string[]): string[] {
  const held = (granted ?? '').split(/\s+/).filter(Boolean);
  if (held.length === 0) return [];

  const heldSet = new Set(held);
  const heldParsed = held.map(parseScope).filter((scope) => scope !== null);
  const satisfiesOperation = (heldOp: string, requiredOp: string) =>
    heldOp === 'write' || requiredOp === 'read';

  function isCovered(scope: string): boolean {
    if (heldSet.has(scope)) return true;

    const need = parseScope(scope);
    // An unparseable requirement is this extension's bug, not the grant's.
    if (!need) return true;

    // OIDC literals carry no read/write semantics, so exact membership is
    // the only test that means anything for them.
    if (need.kind === 'oidc') return false;

    for (const have of heldParsed) {
      if (have.kind !== need.kind) continue;
      if (!satisfiesOperation(have.operation, need.operation)) continue;

      if (need.kind === 'edge') {
        if (have.edgeType === '*' || have.edgeType === need.edgeType) return true;
        continue;
      }
      if (need.kind === 'metadata') {
        // A grant over the whole metadata namespace covers each
        // sub-resource under it.
        if (have.subresource === undefined || have.subresource === need.subresource) return true;
        continue;
      }
      // Item types, where a wildcard grant genuinely covers its subtree:
      // `core.*:read` satisfies `core.note:read`, and a token holding it is
      // not short. `typeMatchesPattern` is the platform's own rule for this
      // — note it takes a single pattern, where `matchesTypePattern` takes a
      // list, and passing a bare string to the latter silently matches on
      // the `*` character.
      if (typeMatchesPattern(need.typePattern, have.typePattern)) return true;
    }

    return false;
  }

  return required.filter((scope) => !isCovered(scope));
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
 * not, because a server may grant less than it advertises — production
 * advertises six scopes in its bundles that it does not issue. Deciding
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
