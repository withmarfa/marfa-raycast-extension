import { describe, expect, it } from 'vitest';
import { claimCovers, needsClientRenewal } from '../src/auth/client-renewal';
import { REQUESTED_CAPABILITY_SCOPES } from '../src/auth/discovery';

describe('needsClientRenewal', () => {
  it('is false for the ordinary shortfall, which the server repairs itself', () => {
    // The stored ceiling is caught up in place by the authorize hook for any
    // scope the bundles publish, so registering again would gain nothing and
    // abandon a client row on the server. This is the common case: it runs
    // whenever an operator adds a type and the bundles widen.
    expect(needsClientRenewal(['core.recipe:read', 'core.recipe:write'])).toBe(false);
    expect(needsClientRenewal(['metadata.tags:write', 'edge.about:read'])).toBe(false);
    expect(needsClientRenewal([])).toBe(false);
  });

  it('is true when a capability is missing, the one family that catch-up excludes', () => {
    for (const capability of REQUESTED_CAPABILITY_SCOPES) {
      expect(needsClientRenewal([capability])).toBe(true);
      expect(needsClientRenewal(['core.note:read', capability])).toBe(true);
    }
  });

  it('does not treat a scope that merely looks like one as a capability', () => {
    // The check is the shared grammar's, not a prefix match, so a literal the
    // server does not recognize cannot force a pointless registration.
    expect(needsClientRenewal(['capability.not_a_real_one'])).toBe(false);
  });
});

describe('claimCovers', () => {
  const needed = 'openid offline_access core.*:read capability.keys';

  it('is false when nothing was recorded, so an unknown client is renewed', () => {
    // A client stored by a build that did not record its claim: the safe
    // answer is to register again, since the ceiling could be anything.
    expect(claimCovers(undefined, needed)).toBe(false);
  });

  it('is false when the claim is short, which is the case worth catching', () => {
    expect(claimCovers('openid offline_access core.*:read', needed)).toBe(false);
  });

  it('is true when the claim already holds everything asked for', () => {
    // What makes a renewal idempotent: an explicit re-consent the person
    // cancels and retries must not mint a client on every attempt.
    expect(claimCovers(needed, needed)).toBe(true);
    expect(claimCovers(`${needed} core.*:write`, needed)).toBe(true);
  });

  it('compares exactly, because the ceiling the server stores is compared exactly', () => {
    // A wildcard in the claim does not cover a literal beneath it. Answering
    // otherwise here would disagree with the surface that actually decides,
    // and the disagreement would show up as a permission silently missing.
    expect(claimCovers('core.*:read', 'core.note:read')).toBe(false);
  });

  it('is insensitive to spacing and order, since scope is an unordered set', () => {
    expect(claimCovers('capability.keys   openid  offline_access core.*:read', needed)).toBe(true);
  });
});
