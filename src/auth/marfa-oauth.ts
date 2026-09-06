/// <reference types="node" />
/**
 * OAuth (PKCE auth-code) wiring for the Marfa Raycast extension.
 *
 * Canonical pattern (per https://developers.raycast.com/utilities/oauth.md):
 * every command is wrapped with `withAccessToken({ authorize, client })` from
 * `@raycast/utils`. The HOC invokes `authorize()` before the wrapped
 * component / function runs; the function returns the current access token,
 * minting one via PKCE consent on first use and refreshing silently
 * otherwise. The `client` parameter (our PKCE singleton) is what tells
 * Raycast to surface its built-in **Logout** option in extension settings.
 *
 * Endpoints and scopes both come from the server's own RFC 8414 discovery
 * document rather than being written down here; see `./discovery`. The
 * hardcoded paths that used to live in this comment are the fallback for a
 * server that does not serve one.
 */
import { getPreferenceValues, LocalStorage, OAuth, showToast, Toast } from '@raycast/api';
import {
  decideReconsent,
  isContentReadScope,
  missingScopes,
  resolveAuthConfig,
  scopesGranted,
} from './discovery';
import type { GrantRecord } from './discovery';
import { buildAuthorizeUrl } from './authorize-url';

const PROVIDER_NAME = 'Marfa';
const PROVIDER_ID = 'marfa';
const PROVIDER_ICON = 'icon.png';

interface Preferences {
  apiUrl?: string;
}

function stripTrailingSlash(s: string): string {
  return s.replace(/\/+$/, '');
}

function clientIdStorageKey(issuer: string): string {
  return `marfa.client_id:${stripTrailingSlash(issuer)}`;
}

/** Singleton PKCEClient, keeping token storage consistent across command
 *  invocations so tokens survive command boundaries. */
export const pkceClient = new OAuth.PKCEClient({
  redirectMethod: OAuth.RedirectMethod.Web,
  providerName: PROVIDER_NAME,
  providerIcon: PROVIDER_ICON,
  providerId: PROVIDER_ID,
  description: 'Sign in to your Marfa account.',
});

interface DcrResponse {
  client_id?: string;
}

interface TokenResponseBody {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
}

/**
 * Dynamic-client-registration. Persists the issued `client_id` per issuer in
 * Raycast `LocalStorage` so subsequent sign-ins (or token refreshes after a
 * Raycast restart) skip DCR. The `redirect_uris` passed at registration
 * time must include the exact URI Raycast uses on `authorize`.
 */
async function dcrRegister(registrationEndpoint: string, redirectUri: string): Promise<string> {
  const res = await fetch(registrationEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_name: 'Marfa for Raycast',
      redirect_uris: [redirectUri],
      grant_types: ['authorization_code', 'refresh_token'],
      token_endpoint_auth_method: 'none',
    }),
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

async function ensureClientId(
  issuer: string,
  registrationEndpoint: string,
  redirectUri: string,
): Promise<string> {
  const stored = await LocalStorage.getItem<string>(clientIdStorageKey(issuer));
  if (stored) return stored;
  const id = await dcrRegister(registrationEndpoint, redirectUri);
  await LocalStorage.setItem(clientIdStorageKey(issuer), id);
  return id;
}

/**
 * What the last successful token exchange asked for and was given, per issuer.
 *
 * The key is new because the value is a different question. The one it replaces
 * recorded only what had been asked for, on the reasoning that asking the same
 * thing twice cannot produce a different answer. True, and it made a grant
 * narrower than the offer permanent and silent: the full advertised set was
 * written down, a subset was issued, and every launch afterwards concluded
 * there was nothing left to ask for.
 */
function grantRecordKey(issuer: string): string {
  return `marfa.grant_record:${stripTrailingSlash(issuer)}`;
}

/** Written by the exchange that produced it, so it can only ever record an
 *  outcome that actually happened. */
function legacyRequestedScopesKey(issuer: string): string {
  return `marfa.requested_scopes:${stripTrailingSlash(issuer)}`;
}

async function readGrantRecord(issuer: string): Promise<GrantRecord | undefined> {
  const raw = await LocalStorage.getItem<string>(grantRecordKey(issuer));
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as Partial<GrantRecord>;
    // A record this build cannot read is no record. Treating a malformed one as
    // an empty grant would report every advertised scope as missing and send
    // someone through consent on the strength of a parse failure.
    if (!Array.isArray(parsed.advertised) || !Array.isArray(parsed.granted)) return undefined;
    return { advertised: parsed.advertised, granted: parsed.granted };
  } catch {
    return undefined;
  }
}

async function writeGrantRecord(issuer: string, record: GrantRecord): Promise<void> {
  await Promise.all([
    LocalStorage.setItem(grantRecordKey(issuer), JSON.stringify(record)),
    // The value it replaces answers a question nothing asks any more.
    LocalStorage.removeItem(legacyRequestedScopesKey(issuer)),
  ]);
}

/** Persist the issuer alongside tokens so refresh knows where to call. */
const ISSUER_STORAGE_KEY = 'marfa.token_issuer';
const CLIENT_ID_STORAGE_KEY = 'marfa.token_client_id';

/**
 * Raycast stores one token set per PKCE client, while the extension can point
 * at many Marfa instances. Never let a token minted by one issuer be sent to
 * another when the Server URL preference changes.
 */
async function discardTokensForDifferentIssuer(issuer: string): Promise<void> {
  const storedIssuer = await LocalStorage.getItem<string>(ISSUER_STORAGE_KEY);
  if (!storedIssuer || stripTrailingSlash(storedIssuer) === issuer) return;

  await Promise.all([
    pkceClient.removeTokens(),
    LocalStorage.removeItem(ISSUER_STORAGE_KEY),
    LocalStorage.removeItem(CLIENT_ID_STORAGE_KEY),
    LocalStorage.removeItem(clientIdStorageKey(storedIssuer)),
    LocalStorage.removeItem(grantRecordKey(storedIssuer)),
    LocalStorage.removeItem(legacyRequestedScopesKey(storedIssuer)),
  ]);
}

async function runFullAuthFlow(
  issuer: string,
  options: { forceConsent?: boolean } = {},
): Promise<string> {
  const stripped = stripTrailingSlash(issuer);
  // Always re-read on a full sign-in, so consent is asked against what the
  // server offers now rather than a cached copy of what it offered before.
  const config = await resolveAuthConfig(stripped, { refresh: true });

  // Exactly one authorization request per sign-in. It mints the PKCE pair +
  // state and surfaces Raycast's redirect URI. Calling authorizationRequest a
  // second time (the old dynamic-client-registration "probe") re-mints the
  // PKCE state, so the verifier we later exchange no longer matches the
  // challenge Raycast actually sent in the URL, so the token exchange fails
  // right after Raycast shows "Successfully connected", and no token is stored,
  // which presents to the user as an immediate re-prompt to sign in. Instead we
  // register the dynamic client against this single request's redirect URI,
  // then hand-build the authorize URL with the real client_id while keeping
  // this request's challenge/state/redirect intact. This is the documented
  // AuthorizationOptions custom-URL path.
  const scope = config.scopes.join(' ');
  const request = await pkceClient.authorizationRequest({
    endpoint: config.authorizationEndpoint,
    clientId: 'pending-dcr',
    scope,
  });

  const clientId = await ensureClientId(stripped, config.registrationEndpoint, request.redirectURI);

  const { authorizationCode } = await pkceClient.authorize({
    url: buildAuthorizeUrl({
      endpoint: config.authorizationEndpoint,
      clientId,
      redirectUri: request.redirectURI,
      scope,
      codeChallenge: request.codeChallenge,
      state: request.state,
      forceConsent: options.forceConsent,
    }),
  });

  // A token exchange that hangs (proxy, captive portal, dead server) would
  // otherwise leave the command stuck on a spinner with no error; bound it.
  const res = await fetch(config.tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: authorizationCode,
      code_verifier: request.codeVerifier,
      redirect_uri: request.redirectURI,
      client_id: clientId,
    }).toString(),
    signal: AbortSignal.timeout(20000),
  });
  const body = (await res.json().catch(() => ({}))) as TokenResponseBody;
  if (!res.ok || !body.access_token) {
    throw new Error(
      `Token exchange failed (HTTP ${res.status}): ${body.error_description ?? body.error ?? 'unknown'}`,
    );
  }

  await pkceClient.setTokens({
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    expiresIn: body.expires_in,
    scope: body.scope,
  });
  await LocalStorage.setItem(ISSUER_STORAGE_KEY, stripped);
  await LocalStorage.setItem(CLIENT_ID_STORAGE_KEY, clientId);
  // Only when the advertised set is the server's own. A document that failed to
  // load leaves the hardcoded fallback in `config.scopes`, and a record saying
  // that is what was advertised is simply false. Writing nothing leaves the
  // next launch to record the pair from a document it could actually read.
  //
  // **This is not what stops a re-consent loop, and reading it that way would
  // invite removing the thing that does.** What stops one is `resolveAuthConfig`
  // falling back to the cache on a forced re-read: the check that decides to
  // re-consent reads the cached document, so if it saw a server advertisement
  // then a cache exists, and the exchange resolves the same set rather than the
  // fallback. That is what lets the record it writes match what the next launch
  // compares against. Without it, the two paths resolve different advertised
  // sets, the pair never matches, and every launch forces a fresh sign-in.
  if (config.fromServer) {
    await writeGrantRecord(stripped, {
      advertised: config.scopes,
      granted: scopesGranted(body, config.scopes),
    });
  }

  return body.access_token;
}

async function refreshExistingTokens(refreshToken: string): Promise<string> {
  const [issuer, clientId] = await Promise.all([
    LocalStorage.getItem<string>(ISSUER_STORAGE_KEY),
    LocalStorage.getItem<string>(CLIENT_ID_STORAGE_KEY),
  ]);
  if (!issuer || !clientId) {
    // Cached tokens predate the issuer/clientId persistence, so fall through
    // to a full sign-in.
    throw new Error('refresh_state_missing');
  }
  const { tokenEndpoint } = await resolveAuthConfig(issuer);
  const res = await fetch(tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: clientId,
    }).toString(),
  });
  const body = (await res.json().catch(() => ({}))) as TokenResponseBody;
  if (!res.ok || !body.access_token) {
    throw new Error(
      `Token refresh failed (HTTP ${res.status}): ${body.error_description ?? body.error ?? 'unknown'}`,
    );
  }
  // The scope is carried forward when the response omits it. RFC 6749 section
  // 5.1 makes it optional on a refresh whose grant matches the request, so
  // writing the absence through would empty the stored scope roughly an hour
  // after a sign-in, and every surface that explains an absence would quietly
  // stop being able to. A verification run immediately after signing in would
  // see none of it.
  const existing = await pkceClient.getTokens();
  await pkceClient.setTokens({
    accessToken: body.access_token,
    refreshToken: body.refresh_token ?? refreshToken,
    expiresIn: body.expires_in,
    scope: body.scope ?? existing?.scope,
  });
  return body.access_token;
}

/**
 * Which advertised scopes this session's grant does not cover.
 *
 * The shortfall exists whether or not anything can be done about it, and a
 * person told their content is not shared needs somewhere to read what else
 * is not. It runs the same decision the re-consent check runs, so the two
 * cannot drift into disagreeing about what is missing.
 *
 * Empty when there is nothing missing, and also when there is no basis to say:
 * no server document, no grant reported, no configured issuer.
 *
 * Not free of side effects, despite reading like it. Resolving the config on a
 * cold or expired cache fetches the discovery document and stores it, so
 * opening this screen can install a newer advertisement that the next command
 * launch then acts on. That is the same caching every other caller gets and is
 * not worth a second code path, but it does mean this is a read that can arm a
 * consent prompt.
 */
/**
 * Content this session was offered and not given, from the stored record.
 *
 * **Deliberately not `getGrantShortfall`.** That one resolves the auth config,
 * which reads the discovery document and caches it when the copy has aged out,
 * so calling it installs a newer advertisement that the next launch acts on.
 * That is a fair trade on an operator screen someone opened on purpose. On the
 * read path of an AI tool it means asking what was captured today can arm a
 * consent prompt that appears later with nothing connecting it to anything the
 * person did. This reads LocalStorage and stops.
 *
 * It also asks a narrower question. The shortfall is a scope list carrying
 * `offline_access` and every write scope, and none of those are content.
 */
export async function getUnreadableContent(): Promise<string[]> {
  try {
    const record = await readGrantRecord(getIssuer());
    // No record is not evidence of a narrow grant, and neither is a grant the
    // server never reported. Both are the unknown case, and the whole point of
    // this file is that unknown does not mean missing.
    if (!record || record.granted.length === 0) return [];
    return missingScopes(record.granted.join(' '), record.advertised.filter(isContentReadScope));
  } catch {
    return [];
  }
}

export async function getGrantShortfall(): Promise<string[]> {
  try {
    const issuer = getIssuer();
    const config = await resolveAuthConfig(issuer);
    if (!config.fromServer) return [];
    const tokens = await pkceClient.getTokens();
    return decideReconsent({
      record: await readGrantRecord(issuer),
      advertised: config.scopes,
      liveGranted: tokens?.scope?.split(/\s+/).filter(Boolean),
    }).missing;
  } catch {
    // A surface that cannot name a shortfall says nothing, rather than
    // reporting the failure to look as a finding.
    return [];
  }
}

/**
 * The scopes the current session actually holds, for surfaces that need to
 * explain an absence rather than render one. Empty when signed out or when
 * the server reported no scope, both of which mean "no basis to claim
 * anything is missing".
 */
export async function getGrantedScopes(): Promise<string | undefined> {
  const tokens = await pkceClient.getTokens();
  return tokens?.scope;
}

/** Accept a host typed without a scheme (e.g. "api.marfa.so"). Node's
 *  fetch/URL parser rejects scheme-less URLs with "Failed to parse URL",
 *  which the browser silently tolerates, so the sign-in page would open and
 *  consent succeed, yet every fetch() this extension makes (DCR, token
 *  exchange, refresh, SDK data calls) would throw. Default a scheme-less
 *  value to https and strip any trailing slash. */
export function normalizeServerUrl(value: string): string {
  const trimmed = value.trim();
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  return stripTrailingSlash(withScheme);
}

/** Resolve the configured Marfa issuer from preferences. Throws a clear
 *  error if unset. The user is prompted to set it on first run by
 *  Raycast's required-preference UX. */
function getIssuer(): string {
  const { apiUrl } = getPreferenceValues<Preferences>();
  const trimmed = apiUrl?.trim();
  if (!trimmed) {
    throw new Error(
      'Server URL is not set. Open Raycast → Extensions → Marfa and set the Server URL.',
    );
  }
  return normalizeServerUrl(trimmed);
}

/**
 * Re-consent when a live grant is genuinely narrower than what the server
 * now offers.
 *
 * Marfa derives its permission bundles from the type registry, so the set
 * widens whenever types are added, so a session minted last month can be
 * missing a whole bundle while remaining perfectly valid. Left alone, the
 * missing content simply does not appear, which is indistinguishable from
 * an empty library and is exactly the failure this wave exists to fix.
 *
 * Two things keep it from becoming a nuisance. Coverage rather than set
 * difference means a broader older grant is never treated as short, and the
 * discovery document is cached, so the common case costs nothing. The toast
 * fires before the browser opens: being sent to a consent screen with no
 * explanation is its own small betrayal.
 */
async function reconsentIfServerOffersMore(
  issuer: string,
  granted: string | undefined,
): Promise<string | null> {
  const config = await resolveAuthConfig(issuer);
  if (!config.fromServer) return null;

  const decision = decideReconsent({
    record: await readGrantRecord(issuer),
    advertised: config.scopes,
    liveGranted: granted?.split(/\s+/).filter(Boolean),
  });

  if (!decision.reconsent) {
    // Written even when there is nothing to gain, because that is what makes
    // the next launch cheap and, more importantly, what terminates: a shortfall
    // this has already been asked about is one it will not ask about again.
    if (decision.remember) await writeGrantRecord(issuer, decision.remember);
    return null;
  }

  await showToast({
    style: Toast.Style.Animated,
    title: 'Marfa needs a fresh sign-in',
    message: `This server offers ${String(decision.missing.length)} permissions your last sign-in did not grant.`,
  });
  await pkceClient.removeTokens();
  return runFullAuthFlow(issuer);
}

/**
 * Ask for consent again, on a session the server would otherwise wave through.
 *
 * **`prompt=consent`, and deliberately not a revoke.** Revoking looked like the
 * answer and is not: the plugin's revoke marks the refresh token and deletes
 * the access tokens beside it, and touches the consent row not at all. Both
 * consent gates read only that row, so a revoke signs the person out and the
 * next authorization is waved through on exactly the grant it was supposed to
 * clear. The one route that does cascade is a browser-session route this client
 * cannot reach.
 *
 * OIDC has a word for this and the server honours it ahead of the lookup, so
 * nothing is destroyed to get a question asked. A cancelled consent leaves the
 * session exactly as it was.
 */
export async function reauthorize(): Promise<string> {
  return runFullAuthFlow(getIssuer(), { forceConsent: true });
}

/**
 * Returns a valid access token, minting one on first use and refreshing
 * silently on expiry. Shaped to satisfy `withAccessToken({ authorize })`.
 *
 * Sign-out is handled by Raycast's built-in Logout preference, which
 * Raycast auto-surfaces in extension settings once `pkceClient.setTokens()`
 * has been called.
 */
export async function authorize(): Promise<string> {
  const issuer = getIssuer();
  await discardTokensForDifferentIssuer(issuer);
  const existing = await pkceClient.getTokens();

  if (existing?.accessToken && !existing.isExpired()) {
    const widened = await reconsentIfServerOffersMore(issuer, existing.scope);
    return widened ?? existing.accessToken;
  }

  if (existing?.refreshToken) {
    try {
      return await refreshExistingTokens(existing.refreshToken);
    } catch (err) {
      // Refresh failed, so drop the stale tokens and fall through to a
      // full sign-in. The user gets one extra consent click rather than
      // an opaque error.
      if (err instanceof Error && err.message === 'refresh_state_missing') {
        // No issuer/clientId persisted; fall through.
      } else {
        await pkceClient.removeTokens();
      }
    }
  }

  return runFullAuthFlow(issuer);
}
