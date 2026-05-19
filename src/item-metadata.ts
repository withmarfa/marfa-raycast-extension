import type { Item } from '@mymehq/sdk';

/**
 * Property classification + shared metadata layout primitives. Two surfaces
 * consume this module: `ItemDetailView` (full pushed Detail) and
 * `ItemInlineDetail` (List.Item.Detail panel). Both surfaces share the same
 * ordering: What → When → Custom → Provenance → Identity → Relationships.
 * Centralising the data here keeps the two renderers from drifting.
 */

export const BODY_PROPERTY_KEYS = new Set([
  'title',
  'name',
  'body',
  'description',
  'url',
  'text',
  'notes',
]);

/**
 * Keys the property walker must skip because they shadow first-class Item
 * fields rendered elsewhere in the sidebar (e.g. a custom type that declares
 * `properties.device` collides with `item.device`). Silent drop rather than
 * letting the sidebar show two same-titled labels.
 */
export const FIRST_CLASS_SHADOW_KEYS = new Set([
  'id',
  'type',
  'state',
  'tier',
  'tenant_id',
  'properties',
  'created_at',
  'updated_at',
  'timestamp',
  'source',
  'source_id',
  'version',
  'schema_version',
  'device',
  'capture_latitude',
  'capture_longitude',
]);

const ISO_DATETIME_RE = /^\d{4}-\d{2}-\d{2}T/;

export type ScalarSidebarEntry =
  | { kind: 'datetime'; key: string; value: string }
  | { kind: 'url'; key: string; value: string }
  | { kind: 'boolean'; key: string; value: boolean }
  | { kind: 'number'; key: string; value: number }
  | { kind: 'string'; key: string; value: string }
  | { kind: 'array'; key: string; value: string };

export type ComplexEntry = { kind: 'complex'; key: string; value: unknown };

function isPrimitive(v: unknown): v is string | number | boolean {
  return typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean';
}

export function classifyProperty(
  key: string,
  value: unknown,
): ScalarSidebarEntry | ComplexEntry | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    if (value === '') return null;
    if (ISO_DATETIME_RE.test(value)) return { kind: 'datetime', key, value };
    if (value.startsWith('http://') || value.startsWith('https://'))
      return { kind: 'url', key, value };
    return { kind: 'string', key, value };
  }
  if (typeof value === 'boolean') return { kind: 'boolean', key, value };
  if (typeof value === 'number') return { kind: 'number', key, value };
  if (Array.isArray(value)) {
    if (value.length === 0) return null;
    if (value.every(isPrimitive)) {
      return { kind: 'array', key, value: value.map((v) => String(v)).join(', ') };
    }
    return { kind: 'complex', key, value };
  }
  if (typeof value === 'object') {
    return { kind: 'complex', key, value };
  }
  return null;
}

export interface PropertySplit {
  scalar: ScalarSidebarEntry[];
  complex: ComplexEntry[];
}

/**
 * Walk `item.properties` and split into scalar sidebar entries (rendered as
 * metadata rows) and complex entries (rendered as a JSON block in markdown
 * body). Body-property keys (rendered as markdown above) and first-class
 * shadow keys (rendered elsewhere) are dropped.
 */
export function splitItemProperties(item: Item): PropertySplit {
  const scalar: ScalarSidebarEntry[] = [];
  const complex: ComplexEntry[] = [];
  for (const [key, value] of Object.entries(item.properties)) {
    if (BODY_PROPERTY_KEYS.has(key)) continue;
    if (FIRST_CLASS_SHADOW_KEYS.has(key)) continue;
    const classified = classifyProperty(key, value);
    if (!classified) continue;
    if (classified.kind === 'complex') {
      complex.push(classified);
    } else {
      scalar.push(classified);
    }
  }
  return { scalar, complex };
}
