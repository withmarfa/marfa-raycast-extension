import { describe, expect, it } from 'vitest';
import {
  REQUESTED_SPACE_PERMISSIONS,
  spacePermissionRefusedBy,
  sessionMayManageKeys,
} from '../src/auth/discovery';

/**
 * Key management is the extension's one administrative surface, and it is now
 * fenced by a space permission the server grants only when someone ticks it.
 *
 * Two questions, deliberately separate, because conflating them is what the old
 * screen did. **May this session offer key management** is answered before any
 * request, from the grant. **Why did the server refuse** is answered from the
 * refusal, and the two answers do not always agree: a grant read from stale
 * storage can be optimistic, and only the server knows what the credential in
 * hand actually holds.
 */

const GRANT_WITH_KEYS = 'openid core.note:read space.keys';
const GRANT_WITHOUT_KEYS = 'openid core.note:read core.note:write';

describe('sessionMayManageKeys', () => {
  it('makes no claim about a static-key session', () => {
    // The same rule as `typeReadableBySession`, and for the same reason: the
    // tokens from an earlier browser sign-in survive in storage after a key is
    // pasted, so reading them answers about a credential no request is using.
    expect(sessionMayManageKeys({ staticKey: true, granted: GRANT_WITHOUT_KEYS })).toBe(true);
    expect(sessionMayManageKeys({ staticKey: true, granted: undefined })).toBe(true);
  });

  it('makes no claim when the server reported no scopes', () => {
    // An unknown grant is not evidence of a missing permission. Guessing here
    // hides the whole command from someone who holds it, and the server's own
    // refusal is what says otherwise.
    expect(sessionMayManageKeys({ staticKey: false, granted: undefined })).toBe(true);
    expect(sessionMayManageKeys({ staticKey: false, granted: '' })).toBe(true);
  });

  it('answers from the grant when there is one to read', () => {
    expect(sessionMayManageKeys({ staticKey: false, granted: GRANT_WITH_KEYS })).toBe(true);
    expect(sessionMayManageKeys({ staticKey: false, granted: GRANT_WITHOUT_KEYS })).toBe(false);
  });

  it('is not reached by a wildcard, however broad', () => {
    // The property the whole family rests on: a space permission is granted by being
    // named and by nothing else. A session holding everything on the data plane
    // still holds no administrative authority.
    expect(sessionMayManageKeys({ staticKey: false, granted: '*:write' })).toBe(false);
    expect(
      sessionMayManageKeys({
        staticKey: false,
        granted: 'content:write metadata:write edge.*:write',
      }),
    ).toBe(false);
  });

  it('is not reached by a different permission', () => {
    expect(sessionMayManageKeys({ staticKey: false, granted: 'space.webhooks space.schema' })).toBe(
      false,
    );
  });
});

describe('spacePermissionRefusedBy', () => {
  it('names the permission a refusal asked for', () => {
    // The server states it rather than the client inferring it, so a screen can
    // say "you did not grant this" instead of "this credential cannot" — two
    // different problems with two different fixes.
    const refusal = { details: { required_scope: 'space.keys' } };
    expect(spacePermissionRefusedBy(refusal)).toBe('space.keys');
  });

  it('says nothing about a refusal that named no permission', () => {
    // A refusal from the credential itself. The distinction is the point: this
    // must not turn every 403 into an invitation to re-consent, which would send
    // somebody round the consent screen forever without ever gaining the
    // permission they actually lack.
    expect(spacePermissionRefusedBy({ details: {} })).toBeUndefined();
    expect(spacePermissionRefusedBy(new Error('Admin access required'))).toBeUndefined();
    expect(spacePermissionRefusedBy(undefined)).toBeUndefined();
    expect(spacePermissionRefusedBy(null)).toBeUndefined();
  });

  it('refuses a value that is not a permission this build knows', () => {
    // Validated through the shared set rather than accepted as a string, so a
    // server naming something else cannot put an arbitrary literal on screen.
    expect(
      spacePermissionRefusedBy({ details: { required_scope: 'core.note:read' } }),
    ).toBeUndefined();
    expect(spacePermissionRefusedBy({ details: { required_scope: 'space.nope' } })).toBeUndefined();
    expect(spacePermissionRefusedBy({ details: { required_scope: 42 } })).toBeUndefined();
  });
});

describe('what the extension asks for', () => {
  it('names exactly the capabilities its own surfaces use', () => {
    // Not a superset and not a mirror of what the server advertises. Key
    // management is the only administrative surface this extension has, so it
    // is the only permission it may ask a person to grant.
    expect([...REQUESTED_SPACE_PERMISSIONS]).toEqual(['space.keys']);
  });
});
