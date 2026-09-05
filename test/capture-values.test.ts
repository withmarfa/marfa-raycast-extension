import { describe, expect, it } from 'vitest';
import { planCaptureForm } from '../src/capture-plan';
import { buildCaptureProperties, TYPES_WITH_RULES } from '../src/capture-values';
import { toTitleCase } from '../src/helpers';
import { schema } from './fixtures';

const f = (over: Record<string, unknown> = {}) => ({ type: 'string', ...over }) as never;

const KITCHEN_SINK = [
  schema('acme.everything', {
    display_hints: { body_field: 'body' },
    fields: {
      name: f({ required: true }),
      body: f({}),
      count: f({ type: 'number' }),
      whole: f({ type: 'integer' }),
      flag: f({ type: 'boolean' }),
      link: f({ type: 'url' }),
      when: f({ type: 'datetime' }),
      day: f({ type: 'date' }),
      pick: f({ type: 'enum', enum_values: ['a', 'b'] }),
      lines: f({ type: 'array', items_type: 'string' }),
      counts: f({ type: 'array', items_type: 'number' }),
      raw: f({ type: 'object' }),
    },
  }),
];

const sink = planCaptureForm(KITCHEN_SINK, 'acme.everything', {
  bodyField: 'body',
  toTitle: toTitleCase,
});

const build = (values: Record<string, unknown>, typeId = 'acme.everything', plan = sink) =>
  buildCaptureProperties(plan, typeId, { name: 'required', ...values });

describe('what gets sent', () => {
  it('omits a blank rather than sending an empty string', () => {
    // Every write in the forms this replaces trimmed and omitted, and the
    // platform treats an optional field as nullish, so an empty string is a
    // value where none was meant.
    const result = build({ body: '   ', link: '', count: '' });
    expect(result).toEqual({ properties: { name: 'required' } });
  });

  it('trims what it does send', () => {
    expect(build({ body: '  hello  ' })).toEqual({
      properties: { name: 'required', body: 'hello' },
    });
  });

  it('writes an optional boolean only when it is true', () => {
    // False is the absence of the flag for every optional boolean in the
    // shipped schemas, and writing it states something nobody said.
    expect(build({ flag: false })).toEqual({ properties: { name: 'required' } });
    expect(build({ flag: true })).toEqual({ properties: { name: 'required', flag: true } });
  });

  it('sends a date as the day a person picked, not the UTC day', () => {
    // An ISO string sliced at ten characters is a different day for anyone west
    // of Greenwich after their afternoon. The suite pins a zone that has one.
    const evening = new Date('2026-03-15T23:30:00.000Z');
    const result = build({ day: evening });
    expect(result).toEqual({ properties: { name: 'required', day: '2026-03-15' } });
    expect(evening.toISOString().slice(0, 10)).toBe('2026-03-15');

    const afterMidnightUtc = new Date('2026-03-16T02:30:00.000Z');
    expect(build({ day: afterMidnightUtc })).toEqual({
      properties: { name: 'required', day: '2026-03-15' },
    });
  });

  it('sends a datetime as an instant', () => {
    const when = new Date('2026-03-15T12:00:00.000Z');
    expect(build({ when })).toEqual({
      properties: { name: 'required', when: '2026-03-15T12:00:00.000Z' },
    });
  });

  it('splits a list on newlines, never on commas', () => {
    // RFC 5545 recurrence rules contain commas, so splitting on them would
    // corrupt every event that has one.
    expect(build({ lines: 'RRULE:FREQ=WEEKLY;BYDAY=MO,WE\nEXDATE:20260101' })).toEqual({
      properties: {
        name: 'required',
        lines: ['RRULE:FREQ=WEEKLY;BYDAY=MO,WE', 'EXDATE:20260101'],
      },
    });
  });

  it('coerces a list to what the schema says its entries are', () => {
    expect(build({ counts: '1\n2\n3' })).toEqual({
      properties: { name: 'required', counts: [1, 2, 3] },
    });
  });

  it('drops blank lines from a list, and an all-blank list entirely', () => {
    expect(build({ lines: 'a\n\n  \nb' })).toMatchObject({
      properties: { lines: ['a', 'b'] },
    });
    expect(build({ lines: '\n  \n' })).toEqual({ properties: { name: 'required' } });
  });

  it('parses a JSON field, and only that field', () => {
    expect(build({ raw: '{"a":1}' })).toEqual({
      properties: { name: 'required', raw: { a: 1 } },
    });
  });
});

describe('what gets refused', () => {
  it('names every problem at once rather than the first', () => {
    // A form marking one field at a time makes a person submit repeatedly to
    // discover what else is wrong.
    const result = build({ count: 'twelve', whole: '1.5', raw: 'not json' });
    expect(result).toEqual({
      errors: {
        count: expect.stringContaining('number'),
        whole: expect.stringContaining('whole number'),
        raw: expect.stringContaining('JSON'),
      },
    });
  });

  it('refuses a missing required field, keyed by its own name', () => {
    // The whole reason errors are keyed by name. The shape this replaces had a
    // closed union of seven, so an error about an arbitrary field had nowhere
    // to go and the form silently did nothing.
    const result = buildCaptureProperties(sink, 'acme.everything', {});
    expect(result).toEqual({ errors: { name: expect.stringContaining('required') } });
  });

  it('refuses a URL that is not one', () => {
    expect(build({ link: 'not a url' })).toEqual({
      errors: { link: expect.stringContaining('URL') },
    });
  });

  it('accepts a required field that is present', () => {
    expect(build({})).toEqual({ properties: { name: 'required' } });
  });
});

const EVENT = [
  schema('core.event', {
    display_hints: { title_field: 'title', body_field: 'description' },
    fields: {
      title: f({ required: true }),
      description: f({}),
      starts_at: f({ type: 'datetime' }),
      ends_at: f({ type: 'datetime' }),
      timezone: f({}),
      end_timezone: f({}),
    },
  }),
];
const eventPlan = planCaptureForm(EVENT, 'core.event', {
  titleField: 'title',
  bodyField: 'description',
  toTitle: toTitleCase,
});
const buildEvent = (values: Record<string, unknown>) =>
  buildCaptureProperties(eventPlan, 'core.event', { title: 'Standup', ...values });

describe('the rules a schema states in prose and cannot express', () => {
  it('drops an end zone that is the same as the start zone', () => {
    // The field's own description says absent means the zone it started in, so
    // storing it twice states what the type defines as the default.
    expect(buildEvent({ timezone: 'Europe/London', end_timezone: 'Europe/London' })).toEqual({
      properties: { title: 'Standup', timezone: 'Europe/London' },
    });
  });

  it('keeps an end zone that genuinely differs', () => {
    expect(buildEvent({ timezone: 'Europe/London', end_timezone: 'America/New_York' })).toEqual({
      properties: {
        title: 'Standup',
        timezone: 'Europe/London',
        end_timezone: 'America/New_York',
      },
    });
  });

  it('refuses a zone that is not a zone, naming which one', () => {
    expect(buildEvent({ timezone: 'Mars/Olympus' })).toEqual({
      errors: { timezone: expect.stringContaining('Mars/Olympus') },
    });
    // Reported against the field that is wrong. The shape this replaces routed
    // both zone fields to one key, so an end-zone error marked the start zone.
    expect(buildEvent({ end_timezone: 'Mars/Olympus' })).toEqual({
      errors: { end_timezone: expect.stringContaining('Mars/Olympus') },
    });
  });

  it('refuses an end before a start', () => {
    expect(
      buildEvent({
        starts_at: new Date('2026-03-15T12:00:00.000Z'),
        ends_at: new Date('2026-03-15T09:00:00.000Z'),
      }),
    ).toEqual({ errors: { ends_at: expect.stringContaining('before') } });
  });

  it('knows about exactly one type', () => {
    // Not to freeze it, but so growing it is a deliberate act with a name on
    // the diff. These are decorations over a form that works without them, not
    // the gate the list they replace was.
    expect(TYPES_WITH_RULES).toEqual(['core.event']);
  });
});

describe('a type this server has no schema for', () => {
  const unknown = planCaptureForm([], 'acme.never-seen', { toTitle: toTitleCase });
  const buildUnknown = (values: Record<string, unknown>) =>
    buildCaptureProperties(unknown, 'acme.never-seen', values);

  it('is still capturable, through the payload it used to give everything', () => {
    // Not the default for anything any more, which is the change. It used to be
    // what two thirds of a registry got.
    expect(unknown.known).toBe(false);
    expect(unknown.primary).toEqual([]);
    expect(buildUnknown({ __raw: '{"anything":"goes"}' })).toEqual({
      properties: { anything: 'goes' },
    });
  });

  it('refuses what is not a JSON object', () => {
    expect(buildUnknown({ __raw: 'not json' })).toEqual({
      errors: { __raw: expect.stringContaining('valid JSON') },
    });
    expect(buildUnknown({ __raw: '[1,2]' })).toEqual({
      errors: { __raw: expect.stringContaining('object') },
    });
  });

  it('accepts an empty payload, since it has no requirements to check', () => {
    expect(buildUnknown({ __raw: '' })).toEqual({ properties: {} });
    expect(buildUnknown({})).toEqual({ properties: {} });
  });
});

describe('a list entry that does not parse', () => {
  it('is refused rather than sent as whatever it was', () => {
    // A number list quietly shipped the raw string, and a boolean list mapped
    // anything-but-true to false, which sends a value the person never stated
    // for a line they probably mistyped.
    expect(build({ counts: '1\nabc' })).toEqual({
      errors: { counts: expect.stringContaining('not a number') },
    });
  });

  it('refuses a whole number that is not whole', () => {
    const registry = [
      schema('acme.ints', { fields: { ns: f({ type: 'array', items_type: 'integer' }) } }),
    ];
    const plan = planCaptureForm(registry, 'acme.ints', { toTitle: toTitleCase });
    expect(buildCaptureProperties(plan, 'acme.ints', { ns: '1\n2.5' })).toEqual({
      errors: { ns: expect.stringContaining('whole number') },
    });
  });

  it('refuses a boolean list entry that is neither', () => {
    const registry = [
      schema('acme.flags', { fields: { fs: f({ type: 'array', items_type: 'boolean' }) } }),
    ];
    const plan = planCaptureForm(registry, 'acme.flags', { toTitle: toTitleCase });
    expect(buildCaptureProperties(plan, 'acme.flags', { fs: 'true\nmaybe' })).toEqual({
      errors: { fs: expect.stringContaining('true or false') },
    });
    expect(buildCaptureProperties(plan, 'acme.flags', { fs: 'true\nfalse' })).toEqual({
      properties: { fs: [true, false] },
    });
  });
});
