import { getPreferenceValues } from '@raycast/api';
import { getAccessToken } from '@raycast/utils';
import { MarfaClient } from '@withmarfa/sdk';
import { authorize, normalizeServerUrl } from './auth/marfa-oauth';

interface Preferences {
  apiUrl: string;
  apiKey?: string;
}

let cached: { client: MarfaClient; key: string } | null = null;

/**
 * Build a `MarfaClient` from the current credential. Two paths:
 *
 *  1. Wrapped command (default), invoked inside `withMarfaAccessToken(...)`,
 *     so `getAccessToken()` returns the live token. The MarfaClient's
 *     `tokenProvider.getAccessToken` calls `authorize()` directly on each
 *     SDK call, ensuring transparent refresh-on-expiry without the SDK
 *     needing to know about our PKCE store.
 *  2. `apiKey` preference fallback, for dev and self-hosting cases where the
 *     operator pastes a static key into Preferences. The wrapper passes this
 *     through Raycast's personal-access-token path so OAuth is not forced.
 *
 * This function is synchronous: it builds the client object, but token
 * resolution happens asynchronously inside the SDK's transport layer on
 * each request via the `tokenProvider`.
 */
export function getClient(): MarfaClient {
  const { apiUrl, apiKey } = getPreferenceValues<Preferences>();
  // The SDK does no URL normalization of its own, so a scheme-less
  // preference value that OAuth happily accepts would make every data
  // call throw "Failed to parse URL" after a seemingly successful sign-in.
  const baseUrl = normalizeServerUrl(apiUrl);

  // Static-key escape hatch wins when explicitly set, which is useful for
  // smoke-testing without OAuth.
  if (apiKey?.trim()) {
    const key = `${baseUrl}:key:${apiKey}`;
    if (cached?.key === key) return cached.client;
    const client = new MarfaClient({ url: baseUrl, apiKey });
    cached = { client, key };
    return client;
  }

  // OAuth path, used from two places that differ. Inside a command,
  // `withAccessToken` has already put a token in a global before the body runs.
  // Inside an AI tool nothing has, and the Raycast documentation does not say
  // whether that wrapper applies to a tool entry point at all, so this resolves
  // without depending on one either way.
  const key = `${baseUrl}:oauth`;
  if (cached?.key === key) return cached.client;
  const client = new MarfaClient({
    url: baseUrl,
    tokenProvider: {
      async getAccessToken() {
        // Fast path: the token the wrapper already resolved. A freshness check
        // here would need an async read of the PKCE store on every call, so
        // expiry is handled by the wrapper on mount instead.
        try {
          const { token } = getAccessToken();
          return token;
        } catch {
          // No wrapper resolved a token, so resolve one here. Called per
          // request, deliberately: `authorize()` is also the refresh path, so
          // caching what it returns would hand out an expired token for the
          // life of the process. It short-circuits on a token that is still
          // valid, which is what makes repeating it cheap enough.
          return authorize();
        }
      },
    },
  });
  cached = { client, key };
  return client;
}

/** Drop the cached client. Useful after a credential rotation. */
export function invalidateClientCache(): void {
  cached = null;
}

/**
 * Whether this session is a pasted API key rather than a browser sign-in.
 *
 * The same preference `getClient` branches on, exported so a command can ask
 * the question without reaching for preferences itself and drifting from the
 * client's answer.
 *
 * It answers which credential is in use, and nothing about what that
 * credential may do. It used to answer both, because minting a key was refused
 * on any OAuth token and a pasted key was therefore the whole of the question.
 * That is no longer the rule: a sign-in holding `capability.keys` may mint one,
 * clamped to the reach the sign-in itself holds, so the key cannot outlive its
 * grant in authority even though it outlives it in time.
 *
 * **So do not reach for this to decide whether a key surface is available.**
 * `sessionMayManageKeys` is that question and consults the grant as well; this
 * one is still right for what it says, and wrong for what it used to imply.
 */
export function isStaticKeySession(): boolean {
  const { apiKey } = getPreferenceValues<Preferences>();
  return Boolean(apiKey?.trim());
}
