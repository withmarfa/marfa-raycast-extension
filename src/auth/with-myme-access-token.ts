import { getPreferenceValues } from '@raycast/api';
import { withAccessToken } from '@raycast/utils';
import type { ComponentType } from 'react';
import { authorize, pkceClient } from './myme-oauth';

interface Preferences {
  apiKey?: string;
}

function getPersonalAccessToken(): string | undefined {
  const { apiKey } = getPreferenceValues<Preferences>();
  const trimmed = apiKey?.trim();
  return trimmed || undefined;
}

export function withMymeAccessToken<T extends (...args: never[]) => unknown>(command: T): T;
export function withMymeAccessToken<T extends ComponentType<unknown>>(command: T): T;
export function withMymeAccessToken(command: unknown): unknown {
  return withAccessToken({
    authorize,
    client: pkceClient,
    personalAccessToken: getPersonalAccessToken(),
  })(command as never);
}
