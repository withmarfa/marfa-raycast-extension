import { getPreferenceValues } from '@raycast/api';
import { withAccessToken } from '@raycast/utils';
import type { ComponentType } from 'react';
import { authorize, pkceClient } from './marfa-oauth';

interface Preferences {
  apiKey?: string;
}

function getPersonalAccessToken(): string | undefined {
  const { apiKey } = getPreferenceValues<Preferences>();
  const trimmed = apiKey?.trim();
  return trimmed || undefined;
}

export function withMarfaAccessToken<T extends (...args: never[]) => unknown>(command: T): T;
export function withMarfaAccessToken<T extends ComponentType<unknown>>(command: T): T;
export function withMarfaAccessToken(command: unknown): unknown {
  return withAccessToken({
    authorize,
    client: pkceClient,
    personalAccessToken: getPersonalAccessToken(),
  })(command as never);
}
