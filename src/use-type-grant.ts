import { useCachedPromise } from '@raycast/utils';
import { getGrantedScopes } from './auth/marfa-oauth';
import { typeReadableBySession } from './auth/discovery';
import { isStaticKeySession } from './client';

/**
 * Whether the current session may read a given type.
 *
 * Consent narrows per type now, so a filter can legitimately select something
 * this grant cannot see. Without this the list is simply empty, which reads as
 * "you have none of these" rather than "you did not grant access to these",
 * two very different things to be told.
 *
 * The rule itself lives beside the scope grammar it depends on, so it can be
 * asserted without a hook in the way. This binds it to the session.
 */
export function useTypeGrant(): (typeId: string) => boolean {
  const staticKey = isStaticKeySession();
  const { data: granted } = useCachedPromise(getGrantedScopes, [], { execute: !staticKey });
  return (typeId: string) => typeReadableBySession({ staticKey, granted }, typeId);
}
