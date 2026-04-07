import { getPreferenceValues } from '@raycast/api';
import { MymeClient } from '@mymehq/sdk';

interface Preferences {
  apiUrl: string;
  apiKey: string;
}

export function getClient(): MymeClient {
  const { apiUrl, apiKey } = getPreferenceValues<Preferences>();
  return new MymeClient({ url: apiUrl, apiKey });
}
