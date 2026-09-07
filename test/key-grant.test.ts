import { describe, expect, it } from 'vitest';
import {
  REQUESTED_CAPABILITY_SCOPES,
  capabilityRefusedBy,
  sessionMayManageKeys,
} from '../src/auth/discovery';

/**
 * Key management is the extension's one administrative surface, and it is now
 * fenced by a capability the server grants only when someone ticks it.
 *
 * Two questions, deliberately separate, because conflating them is what the old
 * screen did. **May this session offer key management** is answered before any
 * request, from the grant. **Why did the server refuse** is answered from the
 * refusal, and the two answers do not always agree: a grant read from stale
 * storage can be optimistic, and only the server knows about role.
 */

const GRANT_WITH_KEYS = 'openid core.note:read capability.keys';
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
    // An unknown grant is not evidence of a missing capability. Guessing here
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
    // The property the whole family rests on: a capability is granted by being
    // named and by nothing else. A session holding everything on the data plane
    // still holds no administrative authority.
    expect(sessionMayManageKeys({ staticKey: false, granted: '*:write' })).toBe(false);
    expect(
      sessionMayManageKeys({ staticKey: false, granted: 'content:write metadata:write edge.*:write' }),
    ).toBe(false);
  });

  it('is not reached by a different capability', () => {
    expect(
      sessionMayManageKeys({ staticKey: false, granted: 'capability.webhooks capability.schema' }),
    ).toBe(false);
  });
});

describe('capabilityRefusedBy', () => {
  it('names the capability a refusal asked for', () => {
    // The server states it rather than the client inferring it, so a screen can
    // say "you did not grant this" instead of "you are not an admin" — two
    // different problems with two different fixes.
    const refusal = { details: { required_scope: 'capability.keys' } };
    expect(capabilityRefusedBy(refusal)).toBe('capability.keys');
  });

  it('says nothing about a refusal that named no capability', () => {
    // A role refusal. The distinction is the point: this must not turn every
    // 403 into an invitation to re-consent, which would send a member round the
    // consent screen forever without ever gaining the role they actually lack.
    expect(capabilityRefusedBy({ details: {} })).toBeUndefined();
    expect(capabilityRefusedBy(new Error('Admin access required'))).toBeUndefined();
    expect(capabilityRefusedBy(undefined)).toBeUndefined();
    expect(capabilityRefusedBy(null)).toBeUndefined();
  });

  it('refuses a value that is not a capability this build knows', () => {
    // Validated through the shared set rather than accepted as a string, so a
    // server naming something else cannot put an arbitrary literal on screen.
    expect(capabilityRefusedBy({ details: { required_scope: 'core.note:read' } })).toBeUndefined();
    expect(capabilityRefusedBy({ details: { required_scope: 'capability.nope' } })).toBeUndefined();
    expect(capabilityRefusedBy({ details: { required_scope: 42 } })).toBeUndefined();
  });
});

describe('what the extension asks for', () => {
  it('names exactly the capabilities its own surfaces use', () => {
    // Not a superset and not a mirror of what the server advertises. Key
    // management is the only administrative surface this extension has, so it
    // is the only capability it may ask a person to grant.
    expect([...REQUESTED_CAPABILITY_SCOPES]).toEqual(['capability.keys']);
  });
});
