import { useCachedPromise } from '@raycast/utils';
import { getGrantedScopes } from './auth/marfa-oauth';
import { sessionMayManageKeys } from './auth/discovery';
import { isStaticKeySession } from './client';

/**
 * Whether this session may be offered key management.
 *
 * The sibling of `useTypeGrant`, and deliberately the same shape: the rule
 * lives beside the scope grammar it depends on so it can be asserted without a
 * hook in the way, and this binds it to the session.
 *
 * Answers optimistically while the grant is still loading, which matters here
 * more than it does for a type filter. The alternative renders the refusal
 * state for a frame and then replaces it, so somebody who holds the permission
 * watches the command tell them they do not.
 */
export function useKeyGrant(): boolean {
  const staticKey = isStaticKeySession();
  const { data: granted } = useCachedPromise(getGrantedScopes, [], { execute: !staticKey });
  return sessionMayManageKeys({ staticKey, granted });
}
