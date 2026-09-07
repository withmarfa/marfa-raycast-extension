import { describe, expect, it } from 'vitest';
import { keyRefusal } from '../src/key-refusal';

/**
 * Four surfaces refuse a key operation and all four used to say one thing,
 * because role was the only fence. Now there are two fences and two answers,
 * and the whole value of the split is that the wrong one is a dead end: the
 * consent screen cannot grant a role, so offering it to a member sends them
 * round a loop with no exit.
 */

const CAPABILITY_REFUSAL = { details: { required_scope: 'capability.keys' } };
const ROLE_REFUSAL = { details: {}, message: 'Admin access required' };

describe('keyRefusal', () => {
  it('offers re-consent when the server named a capability', () => {
    const refusal = keyRefusal(CAPABILITY_REFUSAL);
    expect(refusal.reconsentHelps).toBe(true);
    expect(refusal.title).toMatch(/not granted/i);
    expect(refusal.description).toMatch(/consent screen/i);
  });

  it('does not offer re-consent when the refusal was about role', () => {
    // The assertion that matters most here. A member sent to the consent
    // screen changes nothing and arrives back at the same refusal, so this
    // says the two answers cannot collapse into one.
    const refusal = keyRefusal(ROLE_REFUSAL);
    expect(refusal.reconsentHelps).toBe(false);
    expect(refusal.title).toMatch(/admin/i);
    expect(refusal.description).toMatch(/admin/i);
  });

  it('does not offer re-consent for a capability this extension never asks for', () => {
    // The subtler dead end, and the one that reads as a fix. Re-consent
    // requests `REQUESTED_CAPABILITY_SCOPES` and nothing else, so it can only
    // ever obtain `capability.keys`. Offering it for some other capability
    // sends a person round the consent screen to arrive at the same refusal —
    // the failure this split exists to remove, reached through a different
    // door. Names the literal instead, so whoever reads it can act.
    const refusal = keyRefusal({ details: { required_scope: 'capability.audit_read' } });
    expect(refusal.reconsentHelps).toBe(false);
    expect(refusal.description).toContain('capability.audit_read');
  });

  it('falls back to the role answer for anything it cannot read', () => {
    // Failing towards role is the safe direction: it tells someone to ask an
    // admin, which is never a loop, whereas guessing "not granted" sends a
    // person to a screen that may hold nothing for them.
    for (const notARefusal of [undefined, null, new Error('network'), {}, { details: null }]) {
      expect(keyRefusal(notARefusal).reconsentHelps).toBe(false);
    }
  });

  it('never returns an empty title or description', () => {
    // Both land in a toast or an empty state, where a blank string renders as
    // a lock icon with nothing beside it.
    for (const error of [CAPABILITY_REFUSAL, ROLE_REFUSAL, undefined]) {
      const refusal = keyRefusal(error);
      expect(refusal.title.length).toBeGreaterThan(0);
      expect(refusal.description.length).toBeGreaterThan(0);
    }
  });
});
