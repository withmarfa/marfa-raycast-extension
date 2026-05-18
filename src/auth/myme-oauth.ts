/// <reference types="node" />
/**
 * OAuth (PKCE auth-code) wiring for the Myme Raycast extension.
 *
 * Uses Raycast's native `OAuth.PKCEClient` for the consent overlay UX (browser
 * open + redirect capture) and exposes a `TokenProvider` shim that satisfies
 * `MymeClient`'s OAuth contract while delegating token storage to Raycast's
 * encrypted token store.
 *
 * Server contract (Better Auth via Myme):
 *   - DCR endpoint:           POST /auth/oauth2/register
 *   - Authorization endpoint: /auth/oauth2/authorize
 *   - Token endpoint:         POST /auth/oauth2/token
 */
import { LocalStorage, OAuth } from '@raycast/api';
import type { TokenProvider } from '@mymehq/sdk/auth';

const PROVIDER_NAME = 'Myme';
const PROVIDER_ID = 'myme';
const PROVIDER_ICON = 'icon.png';

/**
 * Broad scope grammar so one session covers everything Raycast does
 * (capture, browse, search, tag, edges, Manage Keys). Admin-only paths
 * still gate on the principal's role (server-side, projected by T-178).
 */
const DEFAULT_SCOPES = [
  'openid',
  'offline_access',
  'profile',
  'core.*:read',
  'core.*:write',
  'edge.*:read',
  'edge.*:write',
  'metadata:read',
  'metadata:write',
  'metadata.types:read',
] as const;

/** Thrown when no credential is available. Commands catch this and render
 *  the "Sign in to Myme" empty state. */
export class MymeAuthMissingError extends Error {
  readonly code = 'auth_missing';
  constructor(message = 'Sign in to Myme to start using the extension.') {
    super(message);
    this.name = 'MymeAuthMissingError';
  }
}

function stripTrailingSlash(s: string): string {
  return s.replace(/\/+$/, '');
}

function clientIdStorageKey(issuer: string): string {
  return `myme.client_id:${stripTrailingSlash(issuer)}`;
}

/** Singleton — PKCEClient holds Raycast-side state. */
let cachedPkceClient: OAuth.PKCEClient | null = null;
function getPkceClient(): OAuth.PKCEClient {
  if (cachedPkceClient) return cachedPkceClient;
  cachedPkceClient = new OAuth.PKCEClient({
    redirectMethod: OAuth.RedirectMethod.Web,
    providerName: PROVIDER_NAME,
    providerIcon: PROVIDER_ICON,
    providerId: PROVIDER_ID,
    description: 'Sign in to your Myme account.',
  });
  return cachedPkceClient;
}

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
 * Raycast `LocalStorage` so a re-sign-in skips DCR. The `redirect_uris`
 * passed at registration time must include the exact URI Raycast uses on
 * `authorize`, otherwise the consent screen rejects with `invalid_request`.
 */
async function dcrRegister(issuer: string, redirectUri: string): Promise<string> {
  const res = await fetch(`${stripTrailingSlash(issuer)}/auth/oauth2/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_name: 'Myme for Raycast',
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

async function ensureClientId(issuer: string, redirectUri: string): Promise<string> {
  const stored = await LocalStorage.getItem<string>(clientIdStorageKey(issuer));
  if (stored) return stored;
  const id = await dcrRegister(issuer, redirectUri);
  await LocalStorage.setItem(clientIdStorageKey(issuer), id);
  return id;
}

/**
 * Drive the full sign-in flow: DCR (if needed), authorization request via
 * PKCEClient (Raycast opens the browser to the consent screen and captures
 * the redirect), code-for-tokens exchange, and persistence via
 * `pkceClient.setTokens()`.
 */
export async function signIn(issuer: string): Promise<void> {
  const stripped = stripTrailingSlash(issuer);
  const pkce = getPkceClient();

  // We need the redirectURI before DCR. PKCEClient picks a URI based on its
  // configured `redirectMethod`; building an authorization request first
  // surfaces it without invoking the browser.
  const probe = await pkce.authorizationRequest({
    endpoint: `${stripped}/auth/oauth2/authorize`,
    clientId: 'pending-dcr',
    scope: DEFAULT_SCOPES.join(' '),
  });
  const redirectUri = probe.redirectURI;

  const clientId = await ensureClientId(stripped, redirectUri);

  // Build the real authorization request now that we have a registered client.
  const request = await pkce.authorizationRequest({
    endpoint: `${stripped}/auth/oauth2/authorize`,
    clientId,
    scope: DEFAULT_SCOPES.join(' '),
  });

  const { authorizationCode } = await pkce.authorize(request);

  // Exchange the code for tokens.
  const res = await fetch(`${stripped}/auth/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: authorizationCode,
      code_verifier: request.codeVerifier,
      redirect_uri: request.redirectURI,
      client_id: clientId,
    }).toString(),
  });
  const body = (await res.json().catch(() => ({}))) as TokenResponseBody;
  if (!res.ok || !body.access_token) {
    throw new Error(
      `Token exchange failed (HTTP ${res.status}): ${body.error_description ?? body.error ?? 'unknown'}`,
    );
  }

  await pkce.setTokens({
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    expiresIn: body.expires_in,
    scope: body.scope,
  });
}

/**
 * Clear stored tokens. Keep the DCR `client_id` in LocalStorage so a
 * subsequent sign-in skips registration.
 */
export async function signOut(): Promise<void> {
  const pkce = getPkceClient();
  await pkce.removeTokens();
}

interface RaycastTokenProviderConfig {
  issuer: string;
  clientId: string;
  pkce: OAuth.PKCEClient;
}

/**
 * `TokenProvider` against the Raycast-backed PKCEClient store.
 * - `getAccessToken()` returns the current access token, refreshing
 *   proactively if `pkceClient.getTokens().isExpired()`.
 * - `refresh()` is single-flight: concurrent callers await the same
 *   in-flight refresh promise.
 * - On `invalid_grant` / `token_reuse_detected`, tokens are cleared and
 *   `onSignOut` handlers fire.
 */
class RaycastTokenProvider implements TokenProvider {
  private readonly issuer: string;
  private readonly clientId: string;
  private readonly pkce: OAuth.PKCEClient;
  private inflightRefresh: Promise<string> | null = null;
  private readonly signOutHandlers = new Set<() => void>();

  constructor(config: RaycastTokenProviderConfig) {
    this.issuer = stripTrailingSlash(config.issuer);
    this.clientId = config.clientId;
    this.pkce = config.pkce;
  }

  async getAccessToken(): Promise<string> {
    const tokens = await this.pkce.getTokens();
    if (!tokens) {
      throw new MymeAuthMissingError();
    }
    if (tokens.isExpired()) {
      return this.refresh();
    }
    return tokens.accessToken;
  }

  async refresh(): Promise<string> {
    if (this.inflightRefresh) return this.inflightRefresh;
    this.inflightRefresh = this.doRefresh().finally(() => {
      this.inflightRefresh = null;
    });
    return this.inflightRefresh;
  }

  private async doRefresh(): Promise<string> {
    const tokens = await this.pkce.getTokens();
    if (!tokens?.refreshToken) {
      this.fireSignOut();
      throw new MymeAuthMissingError('Refresh token missing — please sign in again.');
    }
    const res = await fetch(`${this.issuer}/auth/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: tokens.refreshToken,
        client_id: this.clientId,
      }).toString(),
    });
    const body = (await res.json().catch(() => ({}))) as TokenResponseBody;
    if (!res.ok || !body.access_token) {
      if (body.error === 'invalid_grant' || body.error === 'token_reuse_detected') {
        await this.pkce.removeTokens();
        this.fireSignOut();
      }
      throw new Error(
        `Token refresh failed (HTTP ${res.status}): ${body.error_description ?? body.error ?? 'unknown'}`,
      );
    }
    await this.pkce.setTokens({
      accessToken: body.access_token,
      // Better Auth rotates refresh tokens by default — trust the server's
      // returned refresh token; fall back to the previous one if the server
      // chose not to rotate.
      refreshToken: body.refresh_token ?? tokens.refreshToken,
      expiresIn: body.expires_in,
      scope: body.scope ?? tokens.scope,
    });
    return body.access_token;
  }

  onSignOut(handler: () => void): () => void {
    this.signOutHandlers.add(handler);
    return () => {
      this.signOutHandlers.delete(handler);
    };
  }

  async signOut(): Promise<void> {
    await this.pkce.removeTokens();
    this.fireSignOut();
  }

  private fireSignOut(): void {
    for (const handler of this.signOutHandlers) {
      try {
        handler();
      } catch {
        // Handler errors must not break sign-out.
      }
    }
  }
}

/**
 * Build a TokenProvider from the persisted Raycast token set. Returns null
 * when no session is stored (e.g. before first sign-in or after sign-out).
 */
export async function getTokenProvider(issuer: string): Promise<TokenProvider | null> {
  const stripped = stripTrailingSlash(issuer);
  const pkce = getPkceClient();
  const tokens = await pkce.getTokens();
  if (!tokens) return null;
  const clientId = await LocalStorage.getItem<string>(clientIdStorageKey(stripped));
  if (!clientId) return null;
  return new RaycastTokenProvider({ issuer: stripped, clientId, pkce });
}
