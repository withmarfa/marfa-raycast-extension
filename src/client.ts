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
 *  1. Wrapped command (default) — invoked inside `withMarfaAccessToken(...)`,
 *     so `getAccessToken()` returns the live token. The MarfaClient's
 *     `tokenProvider.getAccessToken` calls `authorize()` directly on each
 *     SDK call, ensuring transparent refresh-on-expiry without the SDK
 *     needing to know about our PKCE store.
 *  2. `apiKey` preference fallback — for dev / self-hosting cases where the
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

  // Static-key escape hatch wins when explicitly set — useful for
  // smoke-testing without OAuth.
  if (apiKey?.trim()) {
    const key = `${baseUrl}:key:${apiKey}`;
    if (cached?.key === key) return cached.client;
    const client = new MarfaClient({ url: baseUrl, apiKey });
    cached = { client, key };
    return client;
  }

  // OAuth path. `withAccessToken` ensures a token exists before any
  // command body runs, so the very first `getAccessToken()` call here
  // succeeds. Subsequent SDK calls re-resolve via `authorize()` so
  // refresh-on-expiry is transparent.
  const key = `${baseUrl}:oauth`;
  if (cached?.key === key) return cached.client;
  const client = new MarfaClient({
    url: baseUrl,
    tokenProvider: {
      async getAccessToken() {
        // Fast path: read the token already in the `withAccessToken` global.
        try {
          const { token } = getAccessToken();
          // Cheap freshness check via the PKCE store would require an
          // async call; instead delegate to `authorize()` if the SDK
          // hits a 401 — but proactively, every call uses the latest
          // global token. `authorize()` is called by the HOC on mount
          // and on stale-token detection.
          return token;
        } catch {
          // getAccessToken throws outside a withAccessToken wrapper —
          // shouldn't happen in real flows, but the fallback is a fresh
          // `authorize()` run.
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
 * It decides what a command may offer, not what it may do. The server refuses
 * key minting on an OAuth token deliberately: an app granted narrow
 * permissions could otherwise mint an unrestricted key, and the key would
 * outlive the grant that produced it, so revoking the app would not revoke
 * the key. That refusal stays. This only stops the extension advertising an
 * action that is certain to be refused.
 */
export function isStaticKeySession(): boolean {
  const { apiKey } = getPreferenceValues<Preferences>();
  return Boolean(apiKey?.trim());
}
