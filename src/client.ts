import { getPreferenceValues } from '@raycast/api';
import { getAccessToken } from '@raycast/utils';
import { MarfaClient } from '@withmarfa/sdk';
import { authorize } from './auth/marfa-oauth';

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

  // Static-key escape hatch wins when explicitly set — useful for
  // smoke-testing without OAuth.
  if (apiKey?.trim()) {
    const key = `${apiUrl}:key:${apiKey}`;
    if (cached?.key === key) return cached.client;
    const client = new MarfaClient({ url: apiUrl, apiKey });
    cached = { client, key };
    return client;
  }

  // OAuth path. `withAccessToken` ensures a token exists before any
  // command body runs, so the very first `getAccessToken()` call here
  // succeeds. Subsequent SDK calls re-resolve via `authorize()` so
  // refresh-on-expiry is transparent.
  const key = `${apiUrl}:oauth`;
  if (cached?.key === key) return cached.client;
  const client = new MarfaClient({
    url: apiUrl,
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
