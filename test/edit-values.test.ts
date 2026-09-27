import { describe, expect, it } from 'vitest';
import type { FieldKind, PlannedField } from '../src/capture-plan';
import { baselineProperties, buildCaptureProperties } from '../src/capture-values';
import { controlValue, editedProperties } from '../src/edit-values';

const field = (name: string, kind: FieldKind, extra: Partial<PlannedField> = {}): PlannedField => ({
  name,
  kind,
  title: name,
  required: false,
  rawType: kind === 'text' ? 'string' : kind,
  ...extra,
});

const FIELDS = [
  field('title', 'text', { required: true }),
  field('due_at', 'datetime'),
  field('day', 'date'),
  field('serves', 'integer'),
  field('done', 'checkbox'),
  field('steps', 'list', { itemsType: 'string' }),
  field('diet', 'tagpicker', { enumValues: ['vegan', 'vegetarian'] }),
  field('meta', 'json'),
  field('cover', 'thumbnail'),
  field('place', 'text'),
];

const ORIGINAL = {
  title: 'Loaf',
  due_at: '2026-10-01T09:00:00Z',
  day: '2026-10-01',
  serves: 4,
  done: true,
  steps: ['mix', 'bake'],
  diet: ['vegan'],
  meta: { b: 1, a: [1, 2] },
  cover: 'data:image/png;base64,AAAA',
  place: 'Home',
  undeclared: 'kept',
  blob_ref: 'h1',
};

function roundTrip(
  edit: (values: Record<string, unknown>) => void = () => undefined,
  original: Record<string, unknown> = ORIGINAL,
  fields: PlannedField[] = FIELDS,
  typeId = 'user.recipe',
) {
  const values: Record<string, unknown> = Object.fromEntries(
    fields.map((f) => [f.name, controlValue(f, original[f.name])]),
  );
  const baseline = baselineProperties(fields, typeId, values);
  edit(values);
  const plan = { primary: fields, secondary: [], shadowed: [], known: true };
  const built = buildCaptureProperties(plan, typeId, values);
  if ('errors' in built) throw new Error(JSON.stringify(built.errors));
  return editedProperties(fields, original, built.properties, baseline);
}

describe('an edit that touches nothing', () => {
  it('changes nothing, however the controls respell the values', () => {
    expect(roundTrip()).toEqual({ properties: ORIGINAL, changed: [] });
  });
});

describe('a value the controls would respell', () => {
  it('is kept exactly as stored when nobody touched it', () => {
    const stored = {
      title: 'Foo ',
      done: false,
      steps: [],
      place: '',
      day: '2026-10-01T09:00:00Z',
      serves: '4',
      meta: null,
    };
    expect(roundTrip(undefined, stored)).toEqual({ properties: stored, changed: [] });
  });

  it('keeps an event’s end zone equal to its start, which the form would leave out', () => {
    const zones = [
      field('title', 'text', { required: true }),
      field('timezone', 'text'),
      field('end_timezone', 'text'),
    ];
    const event = { title: 'x', timezone: 'Europe/London', end_timezone: 'Europe/London' };
    expect(roundTrip(undefined, event, zones, 'core.event')).toEqual({
      properties: event,
      changed: [],
    });
    const moved = roundTrip((values) => void (values.title = 'y'), event, zones, 'core.event');
    expect(moved).toEqual({ properties: { ...event, title: 'y' }, changed: ['title'] });
  });

  it('keeps a stored false when another field is edited', () => {
    const { properties, changed } = roundTrip((values) => void (values.title = 'Bread'), {
      ...ORIGINAL,
      done: false,
    });
    expect(changed).toEqual(['title']);
    expect(properties.done).toBe(false);
  });
});

describe('an edit', () => {
  it('sends the changed field and keeps everything else, undeclared and blob fields too', () => {
    const { properties, changed } = roundTrip((values) => {
      values.serves = '6';
      values.steps = 'mix\nprove\nbake';
    });
    expect(changed).toEqual(['serves', 'steps']);
    expect(properties).toEqual({ ...ORIGINAL, serves: 6, steps: ['mix', 'prove', 'bake'] });
  });

  it('removes a field the form left empty, and a false checkbox is an absent flag', () => {
    const { properties, changed } = roundTrip((values) => {
      values.place = '';
      values.done = false;
      values.due_at = null;
    });
    expect(changed).toEqual(['due_at', 'done', 'place']);
    expect(properties).not.toHaveProperty('place');
    expect(properties).not.toHaveProperty('done');
    expect(properties).not.toHaveProperty('due_at');
  });

  it('keeps the thumbnail when no new image was chosen, and replaces it when one was', () => {
    expect(roundTrip().properties.cover).toBe(ORIGINAL.cover);
    const { properties, changed } = roundTrip((values) => {
      values.cover = 'data:image/png;base64,iVBORw0KGgo=';
    });
    expect(changed).toEqual(['cover']);
    expect(properties.cover).toBe('data:image/png;base64,iVBORw0KGgo=');
  });
});

describe('an edit of a stored value the form cannot read', () => {
  it('clears it when the person empties the field', () => {
    const { properties, changed } = roundTrip((values) => void (values.serves = ''), {
      ...ORIGINAL,
      serves: 'lots',
    });
    expect(changed).toEqual(['serves']);
    expect(properties).not.toHaveProperty('serves');
  });
});

describe('a day in a date control', () => {
  it('is the local midnight of that day, not the UTC one', () => {
    const day = controlValue(field('day', 'date'), '2026-10-01') as Date;
    expect([day.getFullYear(), day.getMonth(), day.getDate(), day.getHours()]).toEqual([
      2026, 9, 1, 0,
    ]);
  });
});
