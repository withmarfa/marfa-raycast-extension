import { useCachedPromise } from '@raycast/utils';
import { getGrantedScopes } from './auth/marfa-oauth';
import { isStaticKeySession } from './client';
import type { CredentialReach } from './key-presets';

/**
 * What the credential behind this session is known to hold.
 *
 * The sibling of `useKeyGrant`, reading the same two sources for a different
 * question: that one asks whether a surface may be offered, this one asks what
 * a key minted from here would copy.
 *
 * **`loading` is carried rather than collapsed into `granted`.** Both arrive as
 * "nothing known", and they mean opposite things: a grant still being read is
 * about to become an answer, while one the server never reported never will.
 * Collapsing them puts "the server did not report this sign-in's scopes" in
 * front of somebody for the frame before the real set arrives.
 */
export function useCredentialReach(): CredentialReach {
  const staticKey = isStaticKeySession();
  const { data: granted, isLoading } = useCachedPromise(getGrantedScopes, [], {
    execute: !staticKey,
  });
  return { staticKey, granted, loading: !staticKey && isLoading };
}
