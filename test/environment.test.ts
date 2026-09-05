import { describe, expect, it } from 'vitest';

/**
 * The suite's own preconditions, asserted rather than assumed.
 *
 * `vitest.config.mts` pins a timezone and a locale because several tests can
 * only distinguish a correct implementation from a broken one under them: the
 * date tests build their expectations from the runtime, so a runtime that
 * happens to match the literal being removed proves nothing, and the
 * daylight-saving case needs a zone that actually observes one.
 *
 * Both pins depend on the worker inheriting the environment at spawn, which is
 * true of the default pool and not of every pool. Nothing else in the suite
 * would fail if they stopped applying — the affected tests would simply go
 * quiet and keep passing, which is the worst way for a guard to die. These two
 * assertions are what make that loud.
 */
describe('the suite runs under the environment it pins', () => {
  it('is in a zone that observes daylight saving', () => {
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe('America/New_York');

    // The property that matters is not the name but the offset change, since
    // that is what the day-counting test needs in order to mean anything.
    const january = new Date('2026-01-15T12:00:00.000Z').getTimezoneOffset();
    const july = new Date('2026-07-15T12:00:00.000Z').getTimezoneOffset();
    expect(january).not.toBe(july);
  });

  it('is in a locale the source never hardcoded', () => {
    // en-US is the literal these tests exist to keep out of the source, so a
    // runtime resolving to it would make every delegation assertion vacuous.
    const locale = Intl.DateTimeFormat().resolvedOptions().locale;
    expect(locale).toBe('en-GB');
    expect(locale).not.toBe('en-US');
  });
});
