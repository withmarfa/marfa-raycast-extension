import { getPreferenceValues } from '@raycast/api';
import { MymeClient } from '@mymehq/sdk';
import { getTokenProvider, MymeAuthMissingError } from './auth/myme-oauth';

interface Preferences {
  apiUrl: string;
  apiKey?: string;
}

let cached: { client: MymeClient; key: string } | null = null;

/**
 * Build a `MymeClient` from the operator's credential. Precedence:
 *  1. OAuth tokens present (Raycast PKCE-stored) → `tokenProvider`
 *  2. `apiKey` preference set → static key (dev / escape-hatch)
 *  3. Otherwise → throw `MymeAuthMissingError` so commands can render
 *     a "Sign in to Myme" empty state.
 *
 * Cached by `apiUrl + credential mode`; consumers should call this once
 * per render. `invalidateClientCache()` is called by sign-in / sign-out.
 */
export async function getClient(): Promise<MymeClient> {
  const { apiUrl, apiKey } = getPreferenceValues<Preferences>();
  if (!apiUrl) {
    throw new MymeAuthMissingError(
      'Server URL is not set. Open Preferences and set the Myme server URL.',
    );
  }

  const tokenProvider = await getTokenProvider(apiUrl);
  if (tokenProvider) {
    const key = `${apiUrl}:oauth`;
    if (cached?.key === key) return cached.client;
    const client = new MymeClient({ url: apiUrl, tokenProvider });
    cached = { client, key };
    return client;
  }

  if (apiKey?.trim()) {
    const key = `${apiUrl}:key:${apiKey}`;
    if (cached?.key === key) return cached.client;
    const client = new MymeClient({ url: apiUrl, apiKey });
    cached = { client, key };
    return client;
  }

  throw new MymeAuthMissingError();
}

/** Drop the cached client. Call after sign-in / sign-out. */
export function invalidateClientCache(): void {
  cached = null;
}

export { MymeAuthMissingError };
