import { getPreferenceValues } from '@raycast/api';
import { MymeClient } from '@mymehq/sdk';

interface Preferences {
  apiUrl: string;
  apiKey: string;
}

let cached: { client: MymeClient; key: string } | null = null;

export function getClient(): MymeClient {
  const { apiUrl, apiKey } = getPreferenceValues<Preferences>();
  const key = `${apiUrl}:${apiKey}`;
  if (cached?.key === key) return cached.client;
  const client = new MymeClient({ url: apiUrl, apiKey });
  cached = { client, key };
  return client;
}
