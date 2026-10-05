import { describe, expect, it } from 'vitest';
import { captureFormModel, initialValue } from '../src/capture-form';
import { buildCaptureProperties, parseAdditionalProperties } from '../src/capture-values';
import { buildRegistry } from '../src/display';
import { schema } from './fixtures';

const f = (over: Record<string, unknown> = {}) => ({ type: 'string', ...over }) as never;

const registry = buildRegistry([
  schema('core.bookmark', {
    display_hints: { title_field: 'title', body_field: 'body' },
    fields: {
      url: f({ type: 'url' }),
      body: f(),
      title: f(),
      source_url: f({ type: 'url' }),
      image_url: f({ type: 'url' }),
    },
  }),
  schema('acme.clip', {
    fields: { source_url: f({ type: 'url' }), cover_url: f({ type: 'url' }) },
  }),
  schema('core.note', {
    display_hints: { title_field: 'title', body_field: 'body' },
    fields: {
      body: f({ required: true }),
      title: f(),
      language: f({ format: 'bcp47' }),
      notes: f(),
    },
  }),
  schema('user.journal', { parent: 'core.note', fields: { mood: f({ required: true }) } }),
  schema('core.file', {
    display_hints: { title_field: 'title' },
    fields: {
      blob_ref: f({ required: true }),
      mime_type: f({ required: true }),
      title: f(),
      url: f({ type: 'url' }),
    },
  }),
  schema('core.file.image', { parent: 'core.file', fields: { width: f({ type: 'integer' }) } }),
  schema('core.event', {
    display_hints: { title_field: 'title', body_field: 'description' },
    fields: {
      title: f({ required: true }),
      description: f(),
      starts_at: f({ type: 'datetime' }),
      ends_at: f({ type: 'datetime' }),
      timezone: f(),
      end_timezone: f(),
      priority: f({ type: 'enum', enum_values: ['low', 'high'], required: true }),
    },
  }),
  schema('acme.card', { fields: { cover: f({ type: 'thumbnail' }), name: f({ maxLength: 5 }) } }),
]);

const names = (fields: { name: string }[]) => fields.map((field) => field.name);

describe('a note’s form', () => {
  it('leads with the body alone and offers no title, since the first line names a note', () => {
    const { plan, isNote } = captureFormModel(registry, 'core.note');
    expect(isNote).toBe(true);
    expect(names(plan.primary)).toEqual(['body']);
    expect(names(plan.secondary)).toEqual(['language', 'notes']);
  });

  it('keeps what a type beneath a note requires in front', () => {
    const { plan, isNote } = captureFormModel(registry, 'user.journal');
    expect(isNote).toBe(true);
    expect(names(plan.primary)).toEqual(['body', 'mood']);
  });

  it('can be written before the registry arrives', () => {
    const { plan } = captureFormModel(buildRegistry(undefined), 'core.note');
    expect(plan.known).toBe(true);
    expect(names(plan.primary)).toEqual(['body']);
    expect(buildCaptureProperties(plan, 'core.note', { body: 'Hello' })).toEqual({
      properties: { body: 'Hello' },
    });
    expect(buildCaptureProperties(plan, 'core.note', { body: ' ' })).toEqual({
      errors: { body: 'Body is required' },
    });
  });
});

describe('where a copied link goes', () => {
  it('to the field named url, or else the first URL field declared', () => {
    expect(captureFormModel(registry, 'core.bookmark').urlField).toBe('url');
    expect(captureFormModel(registry, 'acme.clip').urlField).toBe('source_url');
    expect(captureFormModel(registry, 'core.note').urlField).toBeUndefined();
  });
});

describe('a file’s form', () => {
  it('offers a picker in place of the fields an upload supplies, inherited ones too', () => {
    for (const typeId of ['core.file', 'core.file.image']) {
      const { plan, takesFile } = captureFormModel(registry, typeId);
      expect(takesFile).toBe(true);
      expect(names([...plan.primary, ...plan.secondary])).not.toContain('blob_ref');
      expect(names([...plan.primary, ...plan.secondary])).not.toContain('mime_type');
    }
    expect(captureFormModel(registry, 'core.file.image').plan.primary.map((f) => f.name)).toContain(
      'width',
    );
    expect(captureFormModel(registry, 'core.event').takesFile).toBe(false);
  });
});

describe('what a control starts on', () => {
  const field = (typeId: string, name: string) => {
    const { plan } = captureFormModel(registry, typeId);
    const found = [...plan.primary, ...plan.secondary].find((f) => f.name === name);
    if (!found) throw new Error(`no ${name}`);
    return found;
  };

  it('an event’s start zone is the device’s, and its end zone the same as the start', () => {
    expect(initialValue(field('core.event', 'timezone'), 'core.event', 'Europe/London')).toBe(
      'Europe/London',
    );
    expect(initialValue(field('core.event', 'end_timezone'), 'core.event', 'Europe/London')).toBe(
      '',
    );
  });

  it('a required enum starts on its first value, since it has no “not set”', () => {
    expect(initialValue(field('core.event', 'priority'), 'core.event', 'UTC')).toBe('low');
  });

  it('a thumbnail starts with no file chosen', () => {
    expect(initialValue(field('acme.card', 'cover'), 'acme.card', 'UTC')).toEqual([]);
  });
});

describe('what the server would refuse, refused first', () => {
  const plan = captureFormModel(registry, 'acme.card').plan;

  it('an event that ends before it starts, even from a revived draft’s text', () => {
    const event = captureFormModel(registry, 'core.event').plan;
    expect(
      buildCaptureProperties(event, 'core.event', {
        title: 'x',
        priority: 'low',
        starts_at: '2026-10-02T09:00:00.000Z',
        ends_at: '2026-10-02T08:00:00.000Z',
      }),
    ).toEqual({ errors: { ends_at: 'The end is before the start' } });
  });

  it('in an edit, a rule across fields only when one of its fields changed', () => {
    const event = captureFormModel(registry, 'core.event').plan;
    const stored = { title: 'x', priority: 'low', timezone: 'Etc/GMT+5' };
    expect(buildCaptureProperties(event, 'core.event', { ...stored, title: 'y' }, stored)).toEqual({
      properties: { ...stored, title: 'y' },
    });
    expect(
      buildCaptureProperties(event, 'core.event', { ...stored, timezone: 'Mars/Base' }, stored),
    ).toEqual({ errors: { timezone: 'Mars/Base is not a recognized time zone' } });
  });

  it('a tag picker value its enum does not list', () => {
    const tags = {
      primary: [
        {
          name: 'diet',
          kind: 'tagpicker' as const,
          title: 'Diet',
          required: false,
          rawType: 'array',
          enumValues: ['vegan', 'vegetarian'],
        },
      ],
      secondary: [],
      shadowed: [],
      known: true,
    };
    expect(buildCaptureProperties(tags, 'x.y', { diet: ['keto'] })).toEqual({
      errors: { diet: 'Diet takes only: vegan, vegetarian' },
    });
  });

  it('a string past its length', () => {
    expect(buildCaptureProperties(plan, 'acme.card', { name: 'toolong' })).toEqual({
      errors: { name: 'Name takes at most 5 characters' },
    });
  });

  it('a thumbnail that is not an image’s data URI', () => {
    const result = buildCaptureProperties(plan, 'acme.card', {
      cover: 'https://example.org/a.png',
    });
    expect(result).toEqual({
      errors: { cover: 'Cover: A thumbnail must be a PNG, JPEG or WebP data URI in base64' },
    });
  });
});

describe('additional properties', () => {
  it('reads key: value lines, with booleans and numbers', () => {
    expect(
      parseAdditionalProperties('mood: tired\n# skipped\ncount: 3\nfinal: true\nempty:'),
    ).toEqual({
      properties: { mood: 'tired', count: 3, final: true },
    });
  });

  it('refuses a field the type declares, which has its own checked control', () => {
    expect(parseAdditionalProperties('url: nope', ['url', 'title'])).toEqual({
      error: 'Line 1: "url" is a field of this type; set it above',
    });
    expect(parseAdditionalProperties('links: x')).toEqual({
      error: 'Line 1: "links" is a field of this type; set it above',
    });
  });

  it('keeps a number that would not survive the trip as text', () => {
    expect(parseAdditionalProperties('zip: 01234\nbig: 12345678901234567890\nn: 12')).toEqual({
      properties: { zip: '01234', big: '12345678901234567890', n: 12 },
    });
  });

  it('refuses an item field, a repeat and a line without a colon', () => {
    expect(parseAdditionalProperties('occurred_at: now')).toEqual({
      error: 'Line 1: "occurred_at" is an item field',
    });
    expect(parseAdditionalProperties('a: 1\na: 2')).toEqual({
      error: 'Line 2: "a" is given twice',
    });
    expect(parseAdditionalProperties('just words')).toEqual({
      error: 'Line 1: expected "key: value"',
    });
  });
});
