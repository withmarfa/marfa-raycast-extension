import type { PlannedField } from './capture-plan';

/**
 * Editing any type: an item's properties as the form's controls hold them,
 * and back. Pure, so a round trip that would change a value nobody touched is
 * caught by a test rather than sent.
 */

type ControlValue = string | boolean | string[] | Date | null;

/** A calendar day as the local midnight a date picker shows it as. */
function dayAsDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function instant(value: string): Date | null {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** One property as its control holds it. A thumbnail's picker starts empty: empty keeps the image. */
export function controlValue(field: PlannedField, value: unknown): ControlValue {
  if (value === undefined || value === null) {
    if (field.kind === 'checkbox') return false;
    if (field.kind === 'tagpicker' || field.kind === 'thumbnail') return [];
    if (field.kind === 'datetime' || field.kind === 'date') return null;
    return '';
  }
  switch (field.kind) {
    case 'checkbox':
      return value === true;
    case 'tagpicker':
      return Array.isArray(value) ? value.map(String) : [];
    case 'datetime':
      return typeof value === 'string' ? instant(value) : null;
    case 'date':
      return typeof value === 'string' ? (dayAsDate(value) ?? instant(value)) : null;
    case 'list':
      return Array.isArray(value) ? value.map(String).join('\n') : String(value);
    case 'json':
      return JSON.stringify(value, null, 2);
    case 'thumbnail':
      return [];
    default:
      return typeof value === 'object' ? JSON.stringify(value) : String(value);
  }
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical((value as Record<string, unknown>)[key])]),
    );
  }
  return value;
}

function same(field: PlannedField, before: unknown, after: unknown): boolean {
  // One instant written two ways, `...00Z` and `...00.000Z`, is not an edit.
  if (field.kind === 'datetime' && typeof before === 'string' && typeof after === 'string') {
    return instant(before)?.getTime() === instant(after)?.getTime();
  }
  return JSON.stringify(canonical(before)) === JSON.stringify(canonical(after));
}

/**
 * The item's whole properties after the edit: each field the form showed takes
 * what the form built, or goes when the form left it empty; everything else,
 * undeclared properties and a file's reference included, stays as it was.
 * A field whose value only changed spelling keeps its original.
 */
export function editedProperties(
  fields: readonly PlannedField[],
  original: Record<string, unknown>,
  built: Record<string, unknown>,
): { properties: Record<string, unknown>; changed: string[] } {
  const properties = { ...original };
  const changed: string[] = [];
  for (const field of fields) {
    const before = original[field.name];
    const after = built[field.name];
    if (after === undefined) {
      // An empty thumbnail picker keeps the image; nothing was chosen to replace it.
      if (field.kind === 'thumbnail' || before === undefined) continue;
      delete properties[field.name];
      changed.push(field.name);
      continue;
    }
    if (before !== undefined && same(field, before, after)) continue;
    properties[field.name] = after;
    changed.push(field.name);
  }
  return { properties, changed };
}
