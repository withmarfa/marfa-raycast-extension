import { describe, expect, it } from 'vitest';
import { decideReconsent, scopesGranted, type GrantRecord } from '../src/auth/discovery';

/**
 * The check that decides whether to send someone back through a consent screen.
 *
 * **It has failed in both directions and neither failure was loud.** Deciding
 * from a shortfall alone discarded the session on every launch, which presented
 * as signing out immediately after signing in. Deciding from the advertisement
 * alone terminated but went blind, and a grant narrower than the offer became
 * permanent and silent. So the tests that matter here are the ones that run the
 * decision more than once.
 */

/**
 * One launch, modeling exactly what production does with the decision.
 *
 * **The three outcomes are not interchangeable and conflating two of them is
 * how this helper first lied.** A decision carrying a record is written. A
 * decision to re-consent writes nothing here, because the exchange that follows
 * writes its own outcome. And a decision that is neither, which is the
 * "already asked, same answer" case, writes nothing and keeps what is stored.
 * Modeling that third case as though a consent screen had run and the server
 * had re-granted makes every sweep below settle for the wrong reason.
 */
interface Session {
  record: GrantRecord | undefined;
  /** What the live token reports, when it reports anything. */
  tokenScope: string[] | undefined;
}

function launch(
  session: Session,
  advertised: string[],
  serverGrants: string[],
): { reconsent: boolean; missing: string[]; next: Session } {
  const decision = decideReconsent({
    record: session.record,
    advertised,
    liveGranted: session.tokenScope,
  });

  if (decision.reconsent) {
    // Consent ran and an exchange completed, which is the site that records the
    // advertised set paired with whatever came back.
    return {
      reconsent: true,
      missing: decision.missing,
      next: { record: { advertised, granted: serverGrants }, tokenScope: serverGrants },
    };
  }

  return {
    reconsent: false,
    missing: decision.missing,
    next: { record: decision.remember ?? session.record, tokenScope: session.tokenScope },
  };
}

const READ_ONLY = ['core.note:read'];
const READ_AND_WRITE = ['core.note:read', 'core.note:write', 'core.highlight:read'];
const WIDER = [...READ_AND_WRITE, 'core.task:read'];

describe('a server that narrows and keeps narrowing', () => {
  it('asks once, then never again', () => {
    // The termination argument. A server may issue less than it advertises, so
    // a check deciding from the shortfall asks again on every launch forever.
    let session: Session = { record: { advertised: READ_ONLY, granted: READ_ONLY }, tokenScope: READ_ONLY };

    const first = launch(session, READ_AND_WRITE, READ_ONLY);
    expect(first.reconsent).toBe(true);
    session = first.next;

    // The consent returned the same narrow grant. It must not ask again.
    const second = launch(session, READ_AND_WRITE, READ_ONLY);
    expect(second.reconsent).toBe(false);

    // Silent, but not forgetful.
    expect(second.missing).toEqual(['core.note:write', 'core.highlight:read']);

    const third = launch(second.next, READ_AND_WRITE, READ_ONLY);
    expect(third.reconsent).toBe(false);
  });

  it('asks again only when the advertisement moves', () => {
    // The case the whole feature exists for: bundles widen as types are
    // registered, so a valid older session is missing a whole bundle.
    let session: Session = { record: { advertised: READ_ONLY, granted: READ_ONLY }, tokenScope: READ_ONLY };

    for (const advertised of [READ_AND_WRITE, WIDER]) {
      const asked = launch(session, advertised, advertised);
      expect(asked.reconsent).toBe(true);

      const settled = launch(asked.next, advertised, advertised);
      expect(settled.reconsent).toBe(false);
      expect(settled.missing).toEqual([]);
      session = settled.next;
    }
  });
});

describe('the answers that are "make no claim"', () => {
  it('says nothing on the first launch after this shipped', () => {
    // No record means this build has never seen an outcome for this issuer. A
    // consent screen here is indistinguishable from a real detection, and only
    // one of those is worth interrupting someone for.
    const first = launch({ record: undefined, tokenScope: READ_ONLY }, READ_AND_WRITE, READ_ONLY);
    expect(first.reconsent).toBe(false);
    expect(first.next.record).toEqual({ advertised: READ_AND_WRITE, granted: READ_ONLY });
  });

  it('records nothing when it has neither a report nor a memory', () => {
    // Writing an empty grant here would assert a narrow one on no evidence, and
    // the empty-grant guard would then keep it silent forever.
    const blind = launch({ record: undefined, tokenScope: undefined }, READ_AND_WRITE, READ_ONLY);
    expect(blind.reconsent).toBe(false);
    expect(blind.missing).toEqual([]);
    expect(blind.next.record).toBeUndefined();
  });

  it('treats an empty reported scope as no report, not as a grant of nothing', () => {
    // A token carrying `scope: ""` splits to an empty array rather than to
    // undefined, so a nullish fallback alone would overwrite a recorded grant
    // with nothing and silence this check permanently for that issuer.
    const record: GrantRecord = { advertised: READ_AND_WRITE, granted: READ_AND_WRITE };
    const emptied = launch({ record, tokenScope: [] }, READ_AND_WRITE, READ_ONLY);
    expect(emptied.next.record).toEqual(record);
    expect(emptied.missing).toEqual([]);
  });

  it('says nothing when the grant is broader than the advertisement', () => {
    const broad = launch(
      { record: { advertised: READ_AND_WRITE, granted: ['core.*:write'] }, tokenScope: ['core.*:write'] },
      READ_AND_WRITE,
      READ_AND_WRITE,
    );
    expect(broad.reconsent).toBe(false);
    expect(broad.missing).toEqual([]);
  });

  it('does not read a reordered or repeated grant as a change', () => {
    // A server free to report the same scopes twice, or in another order, has
    // not changed what it granted. Reading either as a change costs a browser
    // sign-in per launch.
    const record: GrantRecord = { advertised: READ_AND_WRITE, granted: READ_ONLY };
    const noisy = launch(
      { record, tokenScope: ['core.note:read', 'core.note:read'] },
      [...READ_AND_WRITE].reverse(),
      READ_ONLY,
    );
    expect(noisy.reconsent).toBe(false);
  });
});

describe('the live token is a hint and the record is authoritative', () => {
  it('falls back to the record when a refresh reported no scope', () => {
    // A refresh may omit `scope` when the grant matches the request. Reading
    // that as an empty grant would make this check go quiet about an hour after
    // a sign-in that had just verified it working.
    const record: GrantRecord = { advertised: READ_AND_WRITE, granted: READ_ONLY };
    const afterRefresh = launch({ record, tokenScope: undefined }, READ_AND_WRITE, READ_ONLY);
    expect(afterRefresh.missing).toEqual(['core.note:write', 'core.highlight:read']);
    expect(afterRefresh.reconsent).toBe(false);
  });

  it('prefers the live token when it did report one', () => {
    // A grant narrowed or revoked server-side shows up here first.
    const record: GrantRecord = { advertised: READ_AND_WRITE, granted: READ_AND_WRITE };
    const narrowed = launch({ record, tokenScope: READ_ONLY }, READ_AND_WRITE, READ_ONLY);
    expect(narrowed.reconsent).toBe(true);
  });
});

describe('it settles, over combinations nobody enumerated', () => {
  // The assertion that says the loop cannot come back. Each combination is
  // driven for eight launches against a fixed advertisement, and the seeded
  // record's advertisement varies independently, which is what makes the
  // "advertisement moved" transition actually occur rather than being a region
  // the decision is constant-false over.
  const SEEDS = [READ_ONLY, READ_AND_WRITE, WIDER];
  const GRANTS = [[], READ_ONLY, READ_AND_WRITE, ['core.*:read'], ['core.*:write']];

  function drive(seedAdvertised: string[], advertised: string[], held: string[], serverGrants: string[]) {
    let session: Session = {
      record: { advertised: seedAdvertised, granted: held },
      tokenScope: held.length ? held : undefined,
    };
    let asks = 0;
    for (let round = 0; round < 8; round++) {
      const result = launch(session, advertised, serverGrants);
      if (result.reconsent) asks++;
      session = result.next;
    }
    return asks;
  }

  const combinations = SEEDS.flatMap((seed) =>
    SEEDS.flatMap((advertised) =>
      GRANTS.flatMap((held) => GRANTS.map((grants) => ({ seed, advertised, held, grants }))),
    ),
  );

  it('never asks more than once for the same question', () => {
    const offenders = combinations
      .filter((c) => drive(c.seed, c.advertised, c.held, c.grants) > 1)
      .map((c) => `seed=${c.seed.length} ad=${c.advertised.length} held=${c.held.join(',')} grants=${c.grants.join(',')}`);
    expect(offenders).toEqual([]);
  });

  it('does ask, in enough of them that the sweep is not vacuous', () => {
    // A decision that never re-consents satisfies the loop above trivially, and
    // an earlier version of this sweep did exactly that: it held the seed and
    // the advertisement equal, so the only input that can flip the comparison
    // never varied and nothing ever asked.
    const asked = combinations.filter((c) => drive(c.seed, c.advertised, c.held, c.grants) === 1);
    expect(asked.length).toBeGreaterThan(20);
    expect(asked.length).toBeLessThan(combinations.length);
  });
});

describe('scopesGranted', () => {
  it('reads an absent scope as "what was asked for"', () => {
    // The spec makes the field optional exactly when the grant matches the
    // request. Reading the absence as an empty grant is safe against a loop and
    // throws away the fact that the grant was full, which is the half a
    // shortfall report depends on.
    expect(scopesGranted({}, READ_AND_WRITE)).toEqual(READ_AND_WRITE);
    expect(scopesGranted({ scope: '' }, READ_AND_WRITE)).toEqual(READ_AND_WRITE);
    expect(scopesGranted({ scope: '   ' }, READ_AND_WRITE)).toEqual(READ_AND_WRITE);
  });

  it('reads a reported scope as what was actually issued', () => {
    expect(scopesGranted({ scope: 'core.note:read core.task:read' }, READ_AND_WRITE)).toEqual([
      'core.note:read',
      'core.task:read',
    ]);
  });

  it('does not alias the requested array it falls back to', () => {
    // The result is persisted and the input is the live config. Returning the
    // same array would let a later mutation of one rewrite the other.
    const requested = [...READ_ONLY];
    expect(scopesGranted({}, requested)).not.toBe(requested);
  });
});
