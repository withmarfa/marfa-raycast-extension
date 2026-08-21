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
import { decideReconsent, resolveAuthConfig } from './discovery';

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

/** Singleton PKCEClient — keeps token storage consistent across command
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
 * The scope set last sent to the authorize endpoint for an issuer.
 *
 * Recorded after a successful token exchange whatever the server actually
 * granted, because it answers "what have we already asked this server for",
 * not "what did we get".
 */
function requestedScopesKey(issuer: string): string {
  return `marfa.requested_scopes:${stripTrailingSlash(issuer)}`;
}

async function rememberRequestedScopes(issuer: string, scopes: string[]): Promise<void> {
  await LocalStorage.setItem(requestedScopesKey(issuer), scopes.join(' '));
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
    LocalStorage.removeItem(requestedScopesKey(storedIssuer)),
  ]);
}

async function runFullAuthFlow(issuer: string): Promise<string> {
  const stripped = stripTrailingSlash(issuer);
  // Always re-read on a full sign-in, so consent is asked against what the
  // server offers now rather than a cached copy of what it offered before.
  const config = await resolveAuthConfig(stripped, { refresh: true });

  // Exactly one authorization request per sign-in. It mints the PKCE pair +
  // state and surfaces Raycast's redirect URI. Calling authorizationRequest a
  // second time (the old dynamic-client-registration "probe") re-mints the
  // PKCE state, so the verifier we later exchange no longer matches the
  // challenge Raycast actually sent in the URL — the token exchange then fails
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

  const authorizeUrl = new URL(config.authorizationEndpoint);
  authorizeUrl.searchParams.set('response_type', 'code');
  authorizeUrl.searchParams.set('client_id', clientId);
  authorizeUrl.searchParams.set('redirect_uri', request.redirectURI);
  authorizeUrl.searchParams.set('scope', scope);
  authorizeUrl.searchParams.set('code_challenge', request.codeChallenge);
  authorizeUrl.searchParams.set('code_challenge_method', 'S256');
  authorizeUrl.searchParams.set('state', request.state);

  const { authorizationCode } = await pkceClient.authorize({
    url: authorizeUrl.toString(),
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
  await rememberRequestedScopes(stripped, config.scopes);

  return body.access_token;
}

async function refreshExistingTokens(refreshToken: string): Promise<string> {
  const [issuer, clientId] = await Promise.all([
    LocalStorage.getItem<string>(ISSUER_STORAGE_KEY),
    LocalStorage.getItem<string>(CLIENT_ID_STORAGE_KEY),
  ]);
  if (!issuer || !clientId) {
    // Cached tokens predate the issuer/clientId persistence — fall through
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
  await pkceClient.setTokens({
    accessToken: body.access_token,
    refreshToken: body.refresh_token ?? refreshToken,
    expiresIn: body.expires_in,
    scope: body.scope,
  });
  return body.access_token;
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
 *  which the browser silently tolerates — so the sign-in page would open and
 *  consent succeed, yet every fetch() this extension makes (DCR, token
 *  exchange, refresh, SDK data calls) would throw. Default a scheme-less
 *  value to https and strip any trailing slash. */
export function normalizeServerUrl(value: string): string {
  const trimmed = value.trim();
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  return stripTrailingSlash(withScheme);
}

/** Resolve the configured Marfa issuer from preferences. Throws a clear
 *  error if unset — the user is prompted to set it on first run by
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
 * widens whenever types are added — a session minted last month can be
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
    lastRequested: await LocalStorage.getItem<string>(requestedScopesKey(issuer)),
    advertised: config.scopes,
    granted,
  });

  if (!decision.reconsent) {
    // Record the set even when there is nothing to gain, so the cheap
    // equality check short-circuits every launch after this one.
    if (decision.remember) await rememberRequestedScopes(issuer, config.scopes);
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
      // Refresh failed — drop the stale tokens and fall through to a
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
