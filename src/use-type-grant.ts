import { useCachedPromise } from '@raycast/utils';
import { getGrantedScopes } from './auth/marfa-oauth';
import { isTypeGranted } from './auth/discovery';

/**
 * Whether the current session may read a given type.
 *
 * Consent narrows per type now, so a filter can legitimately select
 * something this grant cannot see. Without this the list is simply empty,
 * which reads as "you have none of these" rather than "you did not grant
 * access to these" — two very different things to be told.
 */
export function useTypeGrant(): (typeId: string) => boolean {
  const { data: granted } = useCachedPromise(getGrantedScopes, []);
  return (typeId: string) => (granted ? isTypeGranted(granted, typeId) : true);
}
