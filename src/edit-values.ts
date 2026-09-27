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

function same(before: unknown, after: unknown): boolean {
  return JSON.stringify(canonical(before)) === JSON.stringify(canonical(after));
}

/**
 * The item's whole properties after the edit. A field changed only where what
 * the form built differs from what it would have built untouched (the
 * baseline); anything else keeps its stored value exactly, however the
 * controls would respell it: a stored false, a trailing space, an empty list,
 * a full timestamp in a date field. A changed field takes the built value, or
 * goes when the form left it empty. Undeclared properties and a file's
 * reference stay as they were.
 */
export function editedProperties(
  fields: readonly PlannedField[],
  original: Record<string, unknown>,
  built: Record<string, unknown>,
  baseline: { properties: Record<string, unknown>; unreadable: ReadonlySet<string> },
): { properties: Record<string, unknown>; changed: string[] } {
  const properties = { ...original };
  const changed: string[] = [];
  for (const field of fields) {
    const after = built[field.name];
    // An empty thumbnail picker keeps the image; nothing was chosen to replace it.
    if (field.kind === 'thumbnail' && after === undefined) continue;
    if (!baseline.unreadable.has(field.name) && same(baseline.properties[field.name], after)) {
      continue;
    }
    if (after === undefined) {
      if (!(field.name in original)) continue;
      delete properties[field.name];
    } else {
      properties[field.name] = after;
    }
    changed.push(field.name);
  }
  return { properties, changed };
}
