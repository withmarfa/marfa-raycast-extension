import { describe, expect, it } from 'vitest';
import type { FieldKind, PlannedField } from '../src/capture-plan';
import { buildCaptureProperties } from '../src/capture-values';
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

function roundTrip(edit: (values: Record<string, unknown>) => void = () => undefined) {
  const values: Record<string, unknown> = Object.fromEntries(
    FIELDS.map((f) => [f.name, controlValue(f, ORIGINAL[f.name as keyof typeof ORIGINAL])]),
  );
  edit(values);
  const plan = { primary: FIELDS, secondary: [], shadowed: [], known: true };
  const built = buildCaptureProperties(plan, 'user.recipe', values);
  if ('errors' in built) throw new Error(JSON.stringify(built.errors));
  return editedProperties(FIELDS, ORIGINAL, built.properties);
}

describe('an edit that touches nothing', () => {
  it('changes nothing, however the controls respell the values', () => {
    expect(roundTrip()).toEqual({ properties: ORIGINAL, changed: [] });
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
