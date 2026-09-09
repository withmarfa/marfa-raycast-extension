import { grantCoversScope } from '@withmarfa/shared';
import { describe, expect, it } from 'vitest';
import { isContentReadScope, missingScopes } from '../src/auth/discovery';

/**
 * The extension asks the platform whether a grant covers a scope, and this is
 * what keeps that true.
 *
 * Each case below states the rule as a person would describe it. That is what
 * says the behavior is right; it is not what stops the grammar being
 * reimplemented here, because a reimplementation that happens to agree on these
 * pairs passes them all. The differential block at the bottom is what guards
 * that, by comparing the two answers over combinations nobody enumerated.
 */

/** The extension's question, for one scope, so it can be compared directly. */
const covers = (held: string, required: string) => missingScopes(held, [required]).length === 0;

/** What the platform says about the same pair. */
const platformCovers = (held: string, required: string) =>
  grantCoversScope(held.split(' ').filter(Boolean), required);

/**
 * Asserts the stated rule, and pins it against the platform in the same breath.
 * The second assertion cannot fail on its own while the extension delegates, so
 * it is not the reimplementation guard; what it does buy is that a pair whose
 * expected value was written down wrongly fails here rather than encoding a
 * mistake as the rule.
 */
function expectAgreement(held: string, required: string, expected: boolean) {
  expect({ scope: required, covered: covers(held, required) }).toEqual({
    scope: required,
    covered: expected,
  });
  expect(platformCovers(held, required)).toBe(expected);
}

describe('the content category', () => {
  it('covers every type, which the extension used to deny outright', () => {
    // The divergence this replaced. A grant of the content category projects to
    // the global wildcard and reaches every type through it, and a matcher with
    // no arm for that kind reported the whole registry as unreadable to a
    // session that could read all of it.
    for (const type of ['core.note', 'core.highlight', 'user.recipe', 'google.youtube.channel']) {
      expectAgreement('content:read', `${type}:read`, true);
    }
  });

  it('reads write as covering read, and read as not covering write', () => {
    expectAgreement('content:write', 'content:read', true);
    expectAgreement('content:read', 'content:write', false);
  });

  it('is not reached by naming every type, which is the point of it', () => {
    // A row grant is a statement about named things; the parent is a statement
    // about the category. Promoting the first to the second would hand an
    // application types nobody approved.
    expectAgreement('core.note:read core.task:read', 'content:read', false);
  });
});

describe('item types', () => {
  it('reads a wildcard as covering its subtree and nothing outside it', () => {
    expectAgreement('core.*:read', 'core.note:read', true);
    expectAgreement('core.*:read', 'core.media.book:read', true);
    expectAgreement('core.*:read', 'user.recipe:read', false);
  });

  it('reads a write grant as covering the read', () => {
    expectAgreement('core.note:write', 'core.note:read', true);
    expectAgreement('core.note:read', 'core.note:write', false);
  });
});

describe('a narrower grant outranks a broader one', () => {
  it('refuses a write the request path would also refuse', () => {
    // The half of this change with the widest reach, and the one the old
    // matcher got backwards. It returned on the first held pattern that matched
    // with a sufficient verb, so a grant pairing a broad pattern with a narrower
    // one at a lower verb read as covering the broad verb everywhere. The
    // request path resolves the other way: exact, then the longest matching
    // subtree wildcard, then the global one. So the old answer was yes where the
    // server says no, which is the direction that matters, because the surface
    // that reads this decides whether to tell someone their content is visible.
    expectAgreement('core.*:write core.media.*:read', 'core.media.book:write', false);
    expectAgreement('*:write core.*:read', 'core.note:write', false);
    expectAgreement('edge.*:write edge.in-thread:read', 'edge.in-thread:write', false);
  });

  it('still covers the verb the narrower grant does carry', () => {
    // The precedence is about which entry wins, not about withholding what it
    // grants. The narrower read is still a read.
    expectAgreement('core.*:write core.media.*:read', 'core.media.book:read', true);
    expectAgreement('core.*:write core.media.*:read', 'core.task:write', true);
  });
});

describe('the families with no breadth', () => {
  it('reaches a space permission by naming it and by nothing else', () => {
    // The kind exists so a wildcard cannot reach an administrative surface. A
    // matcher answering otherwise reinstates the fail-open one level above the
    // place that kind was added to remove it.
    expectAgreement('space.webhooks', 'space.webhooks', true);
    expectAgreement('*:read *:write', 'space.webhooks', false);
    expectAgreement('content:write', 'space.webhooks', false);
  });

  it('reaches an OIDC literal by naming it and by nothing else', () => {
    expectAgreement('openid profile email', 'openid', true);
    expectAgreement('*:read', 'openid', false);
  });

  it('refuses a requirement it cannot parse rather than waving it through', () => {
    // The old copy returned "covered" for anything it failed to parse, which is
    // fail-open on the axis where a scope family nobody has thought of yet
    // would first appear.
    expectAgreement('core.*:read core.*:write', 'not a scope at all', false);
  });
});

describe('edges and metadata', () => {
  it('agrees with the platform on both', () => {
    expectAgreement('edge.*:read', 'edge.in-thread:read', true);
    expectAgreement('edge.in-thread:read', 'edge.references:read', false);
    expectAgreement('metadata:write', 'metadata.types:read', true);
    expectAgreement('metadata.types:read', 'metadata:write', false);
  });
});

describe('an unknown grant', () => {
  it('is reported as missing nothing, deliberately unlike the platform helper', () => {
    // The one place this does not defer, and it is a precondition rather than a
    // shortcut. The platform answers "covers nothing" for an empty grant, which
    // is right for its question. Here the caller decides whether to send a
    // person back through consent, and a token whose scopes the server did not
    // report is not evidence of a narrow grant. Deciding from that shortfall is
    // what once discarded the session on every launch.
    expect(missingScopes(undefined, ['core.note:read'])).toEqual([]);
    expect(missingScopes('', ['core.note:read'])).toEqual([]);
    expect(missingScopes('   ', ['core.note:read'])).toEqual([]);

    // Stated as a disagreement so that removing the guard, and thereby matching
    // the platform here, fails rather than reads as a tidy-up.
    expect(grantCoversScope([], 'core.note:read')).toBe(false);
  });
});

describe('the list shape', () => {
  it('returns every uncovered scope, in the order asked', () => {
    expect(
      missingScopes('core.note:read', ['core.note:read', 'core.task:read', 'core.highlight:read']),
    ).toEqual(['core.task:read', 'core.highlight:read']);
  });
});

describe('agreement over combinations nobody enumerated', () => {
  // The guard the cases above are not. Every hand-written pair can be satisfied
  // by a reimplementation that happens to agree on exactly those, which is how
  // the copy this replaced survived as long as it did: it was right about
  // wildcards and write-covers-read, and wrong about the two shapes nobody had
  // written down. Generating the cross product costs nothing and does not
  // depend on anyone having thought of the next divergence in advance.
  const HELD = [
    'core.note:read',
    'core.*:read',
    'core.*:write',
    '*:read',
    '*:write',
    '*:write core.*:read',
    'core.*:write core.media.*:read',
    'content:read',
    'content:write',
    'edge.*:read',
    'edge.*:write edge.in-thread:read',
    'metadata:read',
    'metadata.types:read',
    'openid profile email',
    'space.webhooks',
    'core.note:read space.webhooks openid',
  ];
  const REQUIRED = [
    'core.note:read',
    'core.note:write',
    'core.media.book:read',
    'core.media.book:write',
    'core.task:write',
    'user.recipe:read',
    'content:read',
    'content:write',
    'edge.in-thread:read',
    'edge.in-thread:write',
    'metadata:read',
    'metadata.types:read',
    'metadata.types:write',
    'openid',
    'offline_access',
    'space.webhooks',
    'space.connections',
    'not a scope',
  ];

  it('answers exactly what the platform answers, for every pair', () => {
    const disagreements = HELD.flatMap((held) =>
      REQUIRED.filter((required) => covers(held, required) !== platformCovers(held, required)).map(
        (required) => `${held} -> ${required}`,
      ),
    );
    expect(disagreements).toEqual([]);
  });

  it('covers enough of both answers to be worth running', () => {
    // A matrix that is all true, or all false, agrees with anything. This fails
    // if the inputs drift into only exercising one side.
    const answers = HELD.flatMap((held) => REQUIRED.map((required) => covers(held, required)));
    expect(answers.filter(Boolean).length).toBeGreaterThan(20);
    expect(answers.filter((a) => !a).length).toBeGreaterThan(20);
  });
});

describe('which scopes are content a person could be told about', () => {
  it('takes a read scope over a type', () => {
    expect(isContentReadScope('core.note:read')).toBe(true);
    expect(isContentReadScope('core.*:read')).toBe(true);
    expect(isContentReadScope('readwise.highlight:read')).toBe(true);
  });

  it('leaves out the scopes that ride along on every request', () => {
    // The reason this predicate exists. A shortfall is a scope list, and it
    // carries these whether or not any content is missing, so counting them
    // told a session that declined nothing but `offline_access` that its
    // search results were incomplete. Saying that when it is untrue is the
    // same harm as staying silent when it is true.
    expect(isContentReadScope('offline_access')).toBe(false);
    expect(isContentReadScope('edge.*:read')).toBe(false);
    expect(isContentReadScope('metadata:read')).toBe(false);
    expect(isContentReadScope('metadata.types:read')).toBe(false);
  });

  it('leaves out writes and administrative surfaces', () => {
    expect(isContentReadScope('core.note:write')).toBe(false);
    expect(isContentReadScope('edge.*:write')).toBe(false);
    // A well-formed space permission carries no verb at all, so the first
    // shape is the realistic one. The second is malformed and still refused,
    // which is the guard rather than the case.
    expect(isContentReadScope('space.keys')).toBe(false);
    expect(isContentReadScope('space.keys:read')).toBe(false);
    expect(isContentReadScope('openid')).toBe(false);
    expect(isContentReadScope('profile')).toBe(false);
  });

  it('reports nothing missing for a session short only of what always rides along', () => {
    // The end-to-end shape of the defect: this is what the note is computed
    // from, and it must be empty here or every search claims to be partial.
    // The grant deliberately holds none of the always-requested scopes, so a
    // predicate that let one through would report a shortfall here. An earlier
    // version did exactly that and every search claimed to be partial.
    const advertised = [
      'core.note:read',
      'core.note:write',
      'offline_access',
      'edge.*:read',
      'edge.*:write',
      'metadata:read',
      'metadata.types:read',
    ];
    expect(
      missingScopes('core.*:read core.note:write', advertised.filter(isContentReadScope)),
    ).toEqual([]);
  });

  it('still reports content the server offered and did not grant', () => {
    const advertised = ['core.note:read', 'readwise.highlight:read', 'offline_access'];
    expect(missingScopes('core.note:read', advertised.filter(isContentReadScope))).toEqual([
      'readwise.highlight:read',
    ]);
  });
});
