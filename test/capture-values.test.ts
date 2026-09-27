import { describe, expect, it } from 'vitest';
import { planCaptureForm } from '../src/capture-plan';
import {
  buildCaptureProperties,
  captureDefaults,
  TYPES_WITH_RULES,
  valuesFromText,
} from '../src/capture-values';
import { toTitleCase } from '../src/schema-fields';
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
    // The server treats an optional field as nullish, so an empty string is a
    // value where none was meant.
    const result = build({ body: '   ', link: '', count: '' });
    expect(result).toEqual({ properties: { name: 'required' } });
  });

  it('trims a line of text, and sends a body as written', () => {
    // An indented first line is a code block in markdown.
    expect(build({ name: '  x  ', body: '    code\n' })).toEqual({
      properties: { name: 'x', body: '    code\n' },
    });
  });

  it('reads a date-time as an instant only when it names its offset', () => {
    expect(build({ when: '2026-03-15T14:00:00+01:00' })).toEqual({
      properties: { name: 'required', when: '2026-03-15T13:00:00.000Z' },
    });
    expect(build({ when: '2026-03-15' })).toEqual({
      properties: { name: 'required', when: '2026-03-15' },
    });
    expect(build({ when: '2026-03-15T14:00:00' })).toEqual({
      errors: { when: 'When needs a zone offset, such as Z or +01:00' },
    });
  });

  it('takes decimal numbers only', () => {
    expect(build({ count: '0x10' })).toEqual({ errors: { count: 'Count must be a number' } });
    expect(build({ count: '1e3' })).toEqual({ properties: { name: 'required', count: 1000 } });
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
    // Keyed by name, so an error about any field a schema declares has a place to show.
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
    // Reported against the field that is wrong, so an end-zone error never marks the start zone.
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

  it('fills in the zone from the device, for the one type that needs it', () => {
    // The form and the tool both read this, so an event captured by asking
    // carries the device's zone as one captured in the form does.
    expect(captureDefaults('core.event', 'Europe/London')).toEqual({ timezone: 'Europe/London' });
    expect(captureDefaults('core.note', 'Europe/London')).toEqual({});
    expect(captureDefaults('acme.never-seen', 'Europe/London')).toEqual({});
  });

  it('knows about exactly one type', () => {
    // Not to freeze it, but so growing it is a deliberate act with a name on
    // the diff. These are decorations over a form that works without them, not
    // the gate the list they replace was. Every per-type table feeds this,
    // including the device defaults: a fourth table added beside the others and
    // left out of this list would be a per-type rule nothing here can see.
    expect(TYPES_WITH_RULES).toEqual(['core.event']);
  });
});

describe('a type this server has no schema for', () => {
  const unknown = planCaptureForm([], 'acme.never-seen', { toTitle: toTitleCase });
  const buildUnknown = (values: Record<string, unknown>) =>
    buildCaptureProperties(unknown, 'acme.never-seen', values);

  it('is still capturable, through its properties as JSON', () => {
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

describe('values that arrive as text', () => {
  // An AI tool supplies strings where a form supplies whatever its control
  // emits. One validator answers for both, so this is where the two meet.
  const pairs = (o: Record<string, string>) =>
    Object.entries(o).map(([name, value]) => ({ name, value }));

  it('shapes each kind the way its control would have', () => {
    const values = valuesFromText(
      sink,
      pairs({ name: 'x', when: '2026-03-15T12:00:00.000Z', flag: 'true' }),
    );
    expect(values.when).toBe('2026-03-15T12:00:00.000Z');
    expect(values.flag).toBe(true);
    expect(valuesFromText(sink, pairs({ flag: 'yes' })).flag).toBe('yes');
    expect(build({ flag: 'yes' })).toEqual({ errors: { flag: 'Flag must be true or false' } });
    expect(values.name).toBe('x');
  });

  it('refuses an unreadable date rather than dropping it', () => {
    // A date dropped silently would leave a task with no due date and no one told.
    const values = valuesFromText(sink, pairs({ when: 'next tuesday' }));
    expect(values.when).toBe('next tuesday');
    expect(buildCaptureProperties(sink, 'acme.everything', { name: 'x', ...values })).toEqual({
      errors: { when: expect.stringContaining('not a date') },
    });
  });

  it('reads a date-only value as that calendar day, not as UTC midnight', () => {
    // `new Date('2026-03-15')` is midnight UTC, which is the 14th in the zone
    // this suite pins, and taking the local day of it then sent the wrong one.
    // The form never hit this because a picker hands over a Date already.
    const values = valuesFromText(sink, pairs({ name: 'x', day: '2026-03-15' }));
    expect(buildCaptureProperties(sink, 'acme.everything', values)).toEqual({
      properties: { name: 'x', day: '2026-03-15' },
    });
  });

  it('refuses an enum value the schema does not list', () => {
    // A dropdown constrains a person. Nothing constrains a caller sending text,
    // so this is the only place the values are checked before the server sees
    // them and answers with less context.
    const values = valuesFromText(sink, pairs({ name: 'x', pick: 'c' }));
    expect(buildCaptureProperties(sink, 'acme.everything', values)).toEqual({
      errors: { pick: expect.stringContaining('a, b') },
    });
  });

  it('refuses a field the type does not declare rather than dropping it', () => {
    // A model inventing a field should hear about it. Silently discarding it
    // means the capture looks like it worked and the value is simply gone.
    expect(() => valuesFromText(sink, pairs({ name: 'x', invented: 'y' }))).toThrow(/invented/);
  });

  it('reaches the same refusal a person would get for a missing required field', () => {
    const values = valuesFromText(sink, pairs({ body: 'no name given' }));
    expect(buildCaptureProperties(sink, 'acme.everything', values)).toEqual({
      errors: { name: expect.stringContaining('required') },
    });
  });
});
