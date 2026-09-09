import { LocalStorage } from '@raycast/api';
import { expandBundlesToScopes, grantCoversScope, isSpacePermission } from '@withmarfa/shared';
import type { SpacePermission, PermissionBundle } from '@withmarfa/shared';

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
 * These are deliberately not the platform's `space.*` permissions, which are
 * a separate family naming administrative surfaces such as key management,
 * and which are granted only by being named individually. Nothing granted
 * unconditionally belongs in that family, so nothing from it belongs here.
 * {@link REQUESTED_SPACE_PERMISSIONS} is where those go.
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
 * The administrative capabilities this extension asks for, which is exactly
 * the ones its own surfaces use.
 *
 * **Its own constant rather than a member of the list above, and the split is
 * the rule rather than tidiness.** That list is defined by being asked for
 * always and unconditionally; a space permission is granted by a person deciding to
 * tick it, and arriving inside an unconditional list is the one thing it must
 * never do. Both properties are true of the request that goes out — the two
 * sets are unioned a few lines below — so what the separation preserves is the
 * reason, which is the half that survives someone adding the next entry.
 *
 * **One member, and it stays one until a surface needs another.** Manage Keys
 * is the whole of this extension's administrative reach: `keys.list`,
 * `keys.create`, `keys.update` and `keys.revoke`. Type registration is fenced
 * by `metadata.types:write` above and is not a space permission, and listing types
 * is open to any authenticated caller. Asking for more would put permissions
 * on a consent screen that nothing here would ever spend.
 */
export const REQUESTED_SPACE_PERMISSIONS = ['space.keys'] as const;

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
  ...REQUESTED_SPACE_PERMISSIONS,
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
 * **Nothing catches a regression to the bare root, and the test suite is not
 * where that would change.** The suite covers pure logic, and this is a
 * constant spent on a network call: an assertion on its text would restate the
 * literal rather than check it against anything. So the value is held by this
 * comment and by the server's own path-aware registrations, and a wrong one
 * would surface only as a quietly narrowed grant on a live deployment.
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
  // A forced re-read falls back to the cache rather than to the hardcoded set.
  // The refresh exists so consent is asked against what the server offers now,
  // and a document that fails to load is not evidence that it offers less: a
  // day-old copy is far closer to the truth than the fallback, which is
  // narrower than any real instance and would mint exactly the narrow grant
  // this whole check exists to notice.
  const doc = options.refresh
    ? ((await fetchDocument(issuer)) ?? (await readCache(issuer)))
    : ((await readCache(issuer)) ?? (await fetchDocument(issuer)));

  // The capabilities are unioned in rather than left to the bundles, because a
  // bundle will never carry one: the server withholds a space permission from every
  // bundle deliberately, so that granting one is always a person ticking a row
  // rather than a side effect of accepting a group. An extension that waited
  // for a bundle to offer `space.keys` would wait forever and lose its
  // key surface the day the gate switched on.
  const bundles = doc?.marfa_permission_bundles ?? [];
  const scopes = bundles.length
    ? [
        ...new Set([
          ...expandBundlesToScopes(bundles),
          ...ALWAYS_REQUESTED_SCOPES,
          ...REQUESTED_SPACE_PERMISSIONS,
        ]),
      ].sort()
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

/**
 * Whether this session may be offered key management.
 *
 * **The same three-answer shape as {@link typeReadableBySession}, and for the
 * same reason.** A pasted static key is not an OAuth grant and the tokens from
 * an earlier browser sign-in survive in storage beside it; an unknown grant is
 * not evidence of a missing space permission. Both are "make no claim", and claiming
 * otherwise hides the extension's one administrative command from somebody who
 * holds the permission for it.
 *
 * **Optimism here is safe in a way it would not be on a write path**, which is
 * worth stating because the instinct is to fail closed. Nothing is decided by
 * this that the server does not decide again: a session that does not hold the
 * space permission is refused at the route, and the refusal names the literal, so the
 * cost of being wrong is a clear message rather than a silent escalation. The
 * cost of the opposite error is a command that vanishes with no way to ask why.
 */
export function sessionMayManageKeys(session: {
  staticKey: boolean;
  granted: string | undefined;
}): boolean {
  if (session.staticKey) return true;
  if (!session.granted) return true;
  return missingScopes(session.granted, ['space.keys']).length === 0;
}

/**
 * The space permission a refusal was asking for, when it was asking for one.
 *
 * **Two refusals wear one status code and need two different answers**, which
 * is the whole reason this reads the server's own words instead of guessing
 * from local state. A credential that simply does not hold the permission has
 * to be replaced with one that does; a session that was never granted it has to
 * re-consent, and the consent screen would do nothing at all for the first of
 * those. Sending it there anyway is a loop with no exit, because the thing it
 * lacks is not on that screen.
 *
 * Validated against the shared set rather than trusted as a string, so a
 * malformed or unexpected `required_scope` reads as "no space permission named" and
 * the surface falls back to explaining the credential rather than putting an
 * arbitrary literal in front of somebody.
 */
export function spacePermissionRefusedBy(error: unknown): SpacePermission | undefined {
  const required = scopeRefusedBy(error);
  if (required === undefined || !isSpacePermission(required)) return undefined;
  return required;
}

/**
 * The scope a refusal named, whatever family it belongs to.
 *
 * **Broader than {@link spacePermissionRefusedBy} because the creator ceiling
 * is.** A door refuses on a space permission, so validating against the shared
 * set is right there: an unexpected literal reads as "no permission named" and
 * the surface falls back to explaining the credential rather than putting an
 * arbitrary string in front of somebody. A mint refused for asking above its
 * creator names whatever the request reached for, which is a content scope as
 * often as a space one, and validating that away turns the one refusal that
 * says what to change into the one that says nothing.
 */
export function scopeRefusedBy(error: unknown): string | undefined {
  const details = (error as { details?: unknown } | null | undefined)?.details;
  if (!details || typeof details !== 'object') return undefined;
  const required = (details as Record<string, unknown>).required_scope;
  if (typeof required !== 'string' || required.trim() === '') return undefined;
  return required;
}

/**
 * What the last successful token exchange asked for, and what it was given.
 *
 * **Both halves, because either alone is the defect.** Recording only the
 * request says nothing about the outcome, which is how a grant narrower than
 * the offer became permanent and invisible: the extension wrote down the full
 * advertised set, the server issued a subset, and every launch afterwards
 * concluded there was nothing left to ask for. Recording only the grant cannot
 * tell a server that widened its offer from one that did not.
 */
export interface GrantRecord {
  advertised: string[];
  granted: string[];
}

export interface ReconsentDecision {
  reconsent: boolean;
  /** Advertised scopes the grant does not cover. Present whatever the outcome,
   *  because a shortfall nobody can act on is still a shortfall someone should
   *  be able to read. */
  missing: string[];
  /** The pair to persist now, or null when re-consenting, because that flow
   *  writes the actual outcome of its own exchange instead. */
  remember: GrantRecord | null;
}

/** Set equality. A server free to report `core.note:read` twice, or in a
 *  different order, has not changed what it granted, and treating either as a
 *  change would cost a browser sign-in per launch. */
const sameScopes = (a: readonly string[], b: readonly string[]) => {
  const norm = (xs: readonly string[]) => [...new Set(xs)].sort().join(' ');
  return norm(a) === norm(b);
};

/**
 * Whether asking for consent again could change anything.
 *
 * **The rule is "has anything changed since this exact ask produced this exact
 * answer", and the termination argument rests entirely on that.** A shortfall
 * alone cannot decide it: a server may issue less than it advertises, so each
 * consent returns the same grant, the next launch sees the same shortfall, and
 * the session is discarded forever. That shipped once, and presented as signing
 * out immediately after signing in.
 *
 * The guard that fixed it compared advertisements and never looked at the
 * grant, which terminates but is blind: a server that quietly narrows is
 * indistinguishable from one that granted everything. Comparing the pair
 * terminates for the same reason and stays honest, because a grant that comes
 * back short is recorded as short. A server that permanently refuses a scope
 * therefore costs exactly one consent screen ever, rather than one per launch
 * or none at all.
 *
 * **The live token is a hint and the record is authoritative.** A refresh
 * response may omit `scope` entirely when it matches the request, and reading
 * that absence as an empty grant would silently switch this whole check off an
 * hour after a sign-in that verified it working.
 *
 * A first launch after this shipped has no record. It writes one and asks
 * nothing, because a surprise consent screen on upgrade is indistinguishable
 * from a real detection, and one of those is worth a person's attention.
 */
export function decideReconsent(input: {
  record: GrantRecord | undefined;
  advertised: string[];
  /** The live token's scopes, when it reported any. */
  liveGranted: string[] | undefined;
}): ReconsentDecision {
  // An empty live report is not a report. A token carrying `scope: ""` splits
  // to an empty array rather than to undefined, so a nullish fallback alone
  // would read it as a grant of nothing and overwrite a recorded grant with
  // one, permanently silencing this check for that issuer.
  const live = input.liveGranted?.length ? input.liveGranted : undefined;
  const known = live ?? input.record?.granted;
  const granted = known ?? [];
  const pair: GrantRecord = { advertised: input.advertised, granted };
  const missing = missingScopes(granted.join(' '), input.advertised);

  // Nothing was reported and nothing was remembered, so there is nothing worth
  // writing down. Recording an empty grant here would assert a narrow one on no
  // evidence, and the empty-grant guard would then keep it silent forever.
  if (!known) return { reconsent: false, missing, remember: null };

  if (!input.record) return { reconsent: false, missing, remember: pair };
  if (missing.length === 0) return { reconsent: false, missing, remember: pair };

  const unchanged =
    sameScopes(input.record.advertised, pair.advertised) &&
    sameScopes(input.record.granted, pair.granted);

  // Asked before, answered the same way. Reporting it is all that is left.
  if (unchanged) return { reconsent: false, missing, remember: null };

  return { reconsent: true, missing, remember: null };
}

/**
 * What the server actually issued.
 *
 * **An absent `scope` means "as requested", not "nothing".** RFC 6749 section
 * 5.1 makes the field optional precisely when the grant matches the request, so
 * reading its absence as an empty set would be safe against a re-prompt loop
 * and would throw away the fact that the grant was full, which is exactly the
 * half a shortfall report depends on.
 */
export function scopesGranted(body: { scope?: string }, requested: readonly string[]): string[] {
  const reported = body.scope?.split(/\s+/).filter(Boolean);
  return reported?.length ? reported : [...requested];
}

/**
 * Whether a scope names read access to a kind of content.
 *
 * `ALWAYS_REQUESTED_SCOPES` and the identity scopes are the reason this
 * predicate exists. They ride along on every request and say nothing about
 * what content a session can see, so counting them as content produces
 * "cannot read 1" for a session that declined nothing but `offline_access`
 * and can in fact read everything. Telling someone their results are
 * incomplete when they are complete is the same harm as the reverse.
 */
export function isContentReadScope(scope: string): boolean {
  if (!scope.endsWith(':read')) return false;
  if ((ALWAYS_REQUESTED_SCOPES as readonly string[]).includes(scope)) return false;
  // A space permission carries no verb, so the `:read` test above already
  // excludes every well-formed one. The prefix check stays because a
  // malformed literal that somehow carried a verb would otherwise read as
  // content a person could be told about, which is the one thing this
  // predicate exists to prevent.
  return !scope.startsWith('space.');
}
