import { describe, expect, it } from 'vitest';
import { creatorCeilingRefusal, keyRefusal } from '../src/key-refusal';

/**
 * Four surfaces refuse a key operation and all four used to say one thing,
 * because a rank was the only fence. There are three answers now, and the
 * whole value of the split is that two of them are dead ends: a consent screen
 * grants a sign-in one permission this extension asks for, so offering it for
 * any other permission, or for a credential that is not a sign-in at all,
 * sends somebody round a loop with no exit.
 */

const KEYS_PERMISSION_REFUSAL = { details: { required_scope: 'space.keys' } };
/**
 * A refusal that names no permission at all.
 *
 * The server names one wherever it checks one, so this is the credential's own
 * shortfall rather than a grant's — an API key pasted into Preferences that
 * does not hold `space.keys`, most often. No consent screen reaches a key.
 */
const UNNAMED_REFUSAL = { details: {}, message: 'Forbidden' };

describe('keyRefusal', () => {
  it('offers re-consent when the server named the permission it asks for', () => {
    const refusal = keyRefusal(KEYS_PERMISSION_REFUSAL);
    expect(refusal.reconsentHelps).toBe(true);
    expect(refusal.title).toMatch(/not granted/i);
    expect(refusal.description).toMatch(/consent screen/i);
  });

  it('does not offer re-consent when the refusal named no permission', () => {
    // The assertion that matters most here. A key sent to the consent screen
    // changes nothing and arrives back at the same refusal — a consent screen
    // grants a sign-in, and a key is not one — so this says the two answers
    // cannot collapse into one.
    const refusal = keyRefusal(UNNAMED_REFUSAL);
    expect(refusal.reconsentHelps).toBe(false);
    expect(refusal.description).toMatch(/space\.keys/);
    expect(refusal.description).not.toMatch(/consent screen to grant/i);
  });

  it('does not offer re-consent for a permission this extension never asks for', () => {
    // The subtler dead end, and the one that reads as a fix. Re-consent
    // requests `REQUESTED_SPACE_PERMISSIONS` and nothing else, so it can only
    // ever obtain `space.keys`. Offering it for some other permission
    // sends a person round the consent screen to arrive at the same refusal —
    // the failure this split exists to remove, reached through a different
    // door. Names the literal instead, so whoever reads it can act.
    const refusal = keyRefusal({ details: { required_scope: 'space.audit_read' } });
    expect(refusal.reconsentHelps).toBe(false);
    expect(refusal.description).toContain('space.audit_read');
  });

  it('falls back to the credential answer for anything it cannot read', () => {
    // Failing towards the credential is the safe direction: it tells someone to
    // present one that holds the permission, which is never a loop, whereas
    // guessing "not granted" sends a person to a screen that may hold nothing
    // for them.
    for (const notARefusal of [undefined, null, new Error('network'), {}, { details: null }]) {
      expect(keyRefusal(notARefusal).reconsentHelps).toBe(false);
    }
  });

  it('never returns an empty title or description', () => {
    // Both land in a toast or an empty state, where a blank string renders as
    // a lock icon with nothing beside it.
    for (const error of [KEYS_PERMISSION_REFUSAL, UNNAMED_REFUSAL, undefined]) {
      const refusal = keyRefusal(error);
      expect(refusal.title.length).toBeGreaterThan(0);
      expect(refusal.description.length).toBeGreaterThan(0);
    }
  });
});

/**
 * The refusal a form provokes by asking for more than the credential holds.
 *
 * Distinct from every answer above, and the distinction is what the create
 * form got wrong: reaching this refusal means the credential already passed the
 * key-management door, so telling somebody it cannot manage keys contradicts
 * the screen they are standing on.
 */
describe('creatorCeilingRefusal', () => {
  it('names the space permission the request reached past', () => {
    const message = creatorCeilingRefusal({ details: { required_scope: 'space.webhooks' } });
    expect(message).toContain('space.webhooks');
    expect(message).toMatch(/Everything you hold/);
  });

  it('names a content scope too, because a mint is measured on every axis', () => {
    // The creator ceiling is asked of the content maps as well as the eleven,
    // and validating the answer against the space set would turn the one
    // refusal that says what to change into the one that says nothing.
    expect(
      creatorCeilingRefusal({ details: { required_scope: 'core.media.book:write' } }),
    ).toContain('core.media.book:write');
  });

  it('declines the door refusal, which has its own answer and a way out', () => {
    // This form asks for no space permission at all, so a refusal naming
    // `space.keys` is the door rather than the ceiling. `keyRefusal` answers
    // that one and carries the consent screen with it.
    expect(creatorCeilingRefusal({ details: { required_scope: 'space.keys' } })).toBeUndefined();
  });

  it('declines anything that named no scope', () => {
    for (const notACeiling of [undefined, null, new Error('network'), {}, { details: {} }]) {
      expect(creatorCeilingRefusal(notACeiling)).toBeUndefined();
    }
  });
});
