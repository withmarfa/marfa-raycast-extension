import { describe, expect, it } from 'vitest';
import { classifyField, planCaptureForm, type PlannedField } from '../src/capture-plan';
import { alwaysShownFields, FORM_FIELD_PREFIX } from '../src/capture-values';
import { toTitleCase } from '../src/schema-fields';
import { schema } from './fixtures';

const f = (over: Record<string, unknown>) => ({ type: 'string', ...over }) as never;
const ctx = (over: Record<string, unknown> = {}) => ({
  required: false,
  toTitle: toTitleCase,
  ...over,
});
const kindOf = (type: string, over: Record<string, unknown> = {}) =>
  classifyField('field', f({ type, ...over }), ctx()).kind;

describe('classifyField', () => {
  it('maps every kind the platform declares', () => {
    // A total record in the source, so a kind the platform adds fails the
    // build. These assert the mapping is the intended one rather than merely
    // exhaustive.
    expect(kindOf('string')).toBe('text');
    expect(kindOf('number')).toBe('number');
    expect(kindOf('integer')).toBe('integer');
    expect(kindOf('boolean')).toBe('checkbox');
    expect(kindOf('url')).toBe('text');
    expect(kindOf('email')).toBe('text');
    expect(kindOf('datetime')).toBe('datetime');
    expect(kindOf('date')).toBe('date');
    expect(kindOf('object')).toBe('json');
  });

  it('falls back to JSON for a kind this build has never heard of', () => {
    // The wire is JSON and a server can send anything. A text box would accept
    // a value the server then refuses without saying why.
    expect(kindOf('geography')).toBe('json');
  });

  it('gives the type its own body field room to type in', () => {
    expect(classifyField('body', f({ type: 'string' }), ctx({ bodyField: 'body' })).kind).toBe(
      'textarea',
    );
    expect(classifyField('title', f({ type: 'string' }), ctx({ bodyField: 'body' })).kind).toBe(
      'text',
    );
  });

  it('reads an enum as a dropdown, and an empty one as a string', () => {
    expect(kindOf('enum', { enum_values: ['low', 'high'] })).toBe('dropdown');
    // The platform's own validator falls back to a bounded string here, so a
    // dropdown with nothing in it would be a control that cannot be satisfied.
    expect(kindOf('enum')).toBe('text');
    expect(kindOf('enum', { enum_values: [] })).toBe('text');
  });

  it('separates a list of scalars from a list of structures', () => {
    expect(kindOf('array', { items_type: 'string' })).toBe('list');
    expect(kindOf('array', { items_type: 'number' })).toBe('list');
    expect(kindOf('array', { items_type: 'string', enum_values: ['a', 'b'] })).toBe('tagpicker');
    expect(kindOf('array', { items_type: 'object' })).toBe('json');
    expect(kindOf('array')).toBe('json');
  });

  it('carries the description through as help text', () => {
    const planned = classifyField('privacy_status', f({ description: 'Who can see it' }), ctx());
    expect(planned.info).toBe('Who can see it');
    expect(planned.title).toBe('Privacy status');
  });
});

const EVENT = [
  schema('core.event', {
    label: 'Event',
    display_hints: { title_field: 'title', body_field: 'description' },
    fields: {
      title: f({ required: true }),
      description: f({}),
      starts_at: f({ type: 'datetime' }),
      ends_at: f({ type: 'datetime' }),
      duration: f({ type: 'number' }),
      place: f({}),
      latitude: f({ type: 'number' }),
      longitude: f({ type: 'number' }),
      url: f({ type: 'url' }),
      precision: f({ type: 'enum', enum_values: ['year', 'month', 'day', 'time'] }),
      status: f({}),
      notes: f({}),
      recurrence: f({ type: 'array', items_type: 'string' }),
      all_day: f({ type: 'boolean' }),
      timezone: f({}),
      end_timezone: f({}),
      original_starts_at: f({ type: 'datetime' }),
    },
  }),
];

const plan = (typeId = 'core.event', schemas = EVENT) =>
  planCaptureForm(schemas, typeId, {
    titleField: 'title',
    bodyField: 'description',
    toTitle: toTitleCase,
  });

const names = (fields: PlannedField[]) => fields.map((field) => field.name);

describe('planCaptureForm', () => {
  it('leads with the display hints, then everything required', () => {
    const result = plan();
    expect(names(result.primary).slice(0, 2)).toEqual(['title', 'description']);
    expect(result.primary[0].required).toBe(true);
  });

  it('shows a workable number of fields rather than all seventeen', () => {
    // A form is not a form at that length, and the fields past the first few
    // are ones a launcher capture almost never sets.
    const result = plan();
    expect(result.primary.length).toBeLessThan(10);
    expect(result.secondary.length).toBeGreaterThan(0);
    expect(names(result.primary).length + names(result.secondary).length).toBe(17);
  });

  it('never puts a required field behind the toggle', () => {
    // A hidden required field is a form that refuses to submit and does not say
    // where the problem is.
    const many = [
      schema('acme.wide', {
        fields: Object.fromEntries([
          ...Array.from({ length: 12 }, (_, i) => [`optional_${String(i)}`, f({})]),
          ['needed', f({ required: true })],
        ]),
      }),
    ];
    const result = planCaptureForm(many, 'acme.wide', { toTitle: toTitleCase });
    expect(names(result.primary)).toContain('needed');
    expect(result.secondary.every((field) => !field.required)).toBe(true);
  });

  it('demotes a JSON box and a field the schema excludes from search', () => {
    const registry = [
      schema('acme.thing', {
        fields: {
          name: f({}),
          raw: f({ type: 'object' }),
          etag: f({ searchable: false }),
        },
      }),
    ];
    const result = planCaptureForm(registry, 'acme.thing', { toTitle: toTitleCase });
    expect(names(result.primary)).toEqual(['name']);
    expect(names(result.secondary).sort()).toEqual(['etag', 'raw']);
  });

  it('names a field it cannot offer rather than dropping it', () => {
    // A control that silently did nothing would be worse than none, and a field
    // silently absent is worse than both.
    const registry = [
      schema('acme.odd', { fields: { title: f({}), source: f({}), version: f({}) } }),
    ];
    const result = planCaptureForm(registry, 'acme.odd', { toTitle: toTitleCase });
    expect(names(result.primary)).toEqual(['title']);
    expect(result.shadowed.sort()).toEqual(['source', 'version']);
  });

  it('says when it has never heard of the type', () => {
    const result = plan('acme.unknown');
    expect(result.known).toBe(false);
    expect(result.primary).toEqual([]);
  });

  it('plans a type it was never written for', () => {
    // The whole point. Nothing here knows what a YouTube playlist is.
    const playlist = [
      schema('google.youtube.playlist', {
        display_hints: { title_field: 'title', body_field: 'description' },
        fields: {
          playlist_id: f({ required: true }),
          title: f({ required: true }),
          description: f({}),
          item_count: f({ type: 'number' }),
          privacy_status: f({ type: 'enum', enum_values: ['public', 'unlisted', 'private'] }),
          published_at: f({ type: 'datetime' }),
          thumbnail_url: f({ type: 'url' }),
          etag: f({ searchable: false }),
        },
      }),
    ];
    const result = planCaptureForm(playlist, 'google.youtube.playlist', {
      titleField: 'title',
      bodyField: 'description',
      toTitle: toTitleCase,
    });
    expect(names(result.primary).slice(0, 3)).toEqual(['title', 'description', 'playlist_id']);
    const privacy = result.primary.find((field) => field.name === 'privacy_status');
    expect(privacy?.kind).toBe('dropdown');
    expect(privacy?.enumValues).toEqual(['public', 'unlisted', 'private']);
    expect(names(result.secondary)).toContain('etag');
  });
});

describe('what the form reserves for itself', () => {
  const reservedByForm = (name: string) => name.startsWith(FORM_FIELD_PREFIX);

  it("refuses a schema field that would collide with the form's own controls", () => {
    // The platform accepts a field literally named `__extra`, so the prefix is
    // only safe because the planner refuses one. Rendering it would put two
    // controls on one id and split a single value between them.
    const registry = [
      schema('acme.thing', { fields: { title: f({}), __extra: f({}), __raw: f({}) } }),
    ];
    const result = planCaptureForm(registry, 'acme.thing', {
      toTitle: toTitleCase,
      reservedByForm,
    });
    expect(names(result.primary)).toEqual(['title']);
    expect(result.shadowed.sort()).toEqual(['__extra', '__raw']);
  });

  it('renders a field called tags, now that the form no longer claims that id', () => {
    // Four shipped types declare one, and the extension's own tag box used to
    // own the id: typing item tags wrote the property and vice versa.
    const registry = [
      schema('readwise.highlight', {
        fields: { text: f({}), tags: f({ type: 'array', items_type: 'string' }) },
      }),
    ];
    const result = planCaptureForm(registry, 'readwise.highlight', {
      toTitle: toTitleCase,
      reservedByForm,
    });
    expect(names(result.primary)).toContain('tags');
    expect(result.shadowed).toEqual([]);
  });
});

describe('fields the form fills in on its own', () => {
  it('keeps them visible however far down the schema declares them', () => {
    // `core.event` declares seventeen fields and `timezone` is the fifteenth,
    // so an ordering rule alone put it behind the toggle. A hidden control that
    // defaults to the device zone writes a zone nobody chose, and an untouched
    // one writes none at all, which that field's own description says means the
    // schedule advances in UTC.
    const order = [
      'title',
      'description',
      'starts_at',
      'ends_at',
      'duration',
      'place',
      'latitude',
      'longitude',
      'url',
      'precision',
      'status',
      'notes',
      'recurrence',
      'all_day',
      'timezone',
      'end_timezone',
      'original_starts_at',
    ];
    const registry = [
      schema('core.event', {
        display_hints: { title_field: 'title', body_field: 'description' },
        fields: Object.fromEntries(
          order.map((name) => [name, f(name === 'title' ? { required: true } : {})]),
        ),
      }),
    ];
    const result = planCaptureForm(registry, 'core.event', {
      titleField: 'title',
      bodyField: 'description',
      toTitle: toTitleCase,
      alwaysShow: alwaysShownFields('core.event'),
    });
    expect(names(result.primary)).toContain('timezone');
    expect(names(result.primary)).toContain('end_timezone');
    expect(names(result.secondary)).not.toContain('timezone');
  });
});
