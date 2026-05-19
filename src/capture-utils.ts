import type { TypeSchema } from '@mymehq/sdk';
import { runAppleScript } from '@raycast/utils';
import { CAPTURE_TYPES } from './constants';
import { FIRST_CLASS_SHADOW_KEYS } from './item-metadata';

export type CoreCaptureType = (typeof CAPTURE_TYPES)[number]['value'];
export type TypeSchemaWithRequired = TypeSchema & { required?: string[] };

export interface CaptureValues {
  title?: string;
  body?: string;
  url?: string;
  description?: string;
  due_at?: Date | null;
  starts_at?: Date | null;
  priority?: string;
  place?: string;
}

export interface ValidationError {
  field: 'body' | 'title' | 'url' | 'propertiesJson' | 'extraProperties';
  message: string;
}

const CORE_CAPTURE_TYPE_IDS = new Set<string>(CAPTURE_TYPES.map((t) => t.value));

export function isCoreCaptureType(type: string): type is CoreCaptureType {
  return CORE_CAPTURE_TYPE_IDS.has(type);
}

export function normalizeTypeId(type: string | undefined): string {
  return type?.trim() || 'core.note';
}

export function parseTags(value: string | undefined): string[] | undefined {
  if (!value) return undefined;
  const tags = value
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);
  return tags.length > 0 ? tags : undefined;
}

export function mergeTags(...values: Array<string | undefined>): string[] | undefined {
  const tags: string[] = [];
  for (const value of values) {
    for (const tag of parseTags(value) ?? []) {
      if (!tags.includes(tag)) tags.push(tag);
    }
  }
  return tags.length > 0 ? tags : undefined;
}

export function validateCoreCapture(type: string, values: CaptureValues): ValidationError | null {
  if (type === 'core.note' && !values.body?.trim()) {
    return { field: 'body', message: 'Body is required' };
  }
  if (type === 'core.bookmark' && !values.url?.trim()) {
    return { field: 'url', message: 'URL is required' };
  }
  if ((type === 'core.task' || type === 'core.event') && !values.title?.trim()) {
    return { field: 'title', message: 'Title is required' };
  }
  return null;
}

export function buildCoreCaptureProperties(
  type: CoreCaptureType,
  values: CaptureValues,
  options?: { html?: string; sourceText?: string },
): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  switch (type) {
    case 'core.note':
      if (values.title?.trim()) properties.title = values.title.trim();
      if (values.body?.trim()) properties.body = values.body.trim();
      if (options?.html && options.html !== options.sourceText) properties.html = options.html;
      break;
    case 'core.bookmark':
      if (values.url?.trim()) properties.url = values.url.trim();
      if (values.title?.trim()) properties.title = values.title.trim();
      if (values.description?.trim()) properties.description = values.description.trim();
      break;
    case 'core.task':
      if (values.title?.trim()) properties.title = values.title.trim();
      if (values.description?.trim()) properties.description = values.description.trim();
      if (values.due_at) properties.due_at = values.due_at.toISOString();
      if (values.priority) properties.priority = values.priority;
      break;
    case 'core.event':
      if (values.title?.trim()) properties.title = values.title.trim();
      if (values.starts_at) properties.starts_at = values.starts_at.toISOString();
      if (values.place?.trim()) properties.place = values.place.trim();
      break;
  }
  return properties;
}

export function parseCustomPropertiesJson(
  raw: string | undefined,
  schema?: TypeSchemaWithRequired,
): { properties: Record<string, unknown> } | { error: ValidationError } {
  const trimmed = raw?.trim() ?? '';
  if (!trimmed) return { properties: {} };

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return { error: { field: 'propertiesJson', message: 'Properties must be valid JSON' } };
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { error: { field: 'propertiesJson', message: 'Properties must be a JSON object' } };
  }

  const properties = parsed as Record<string, unknown>;
  for (const field of schema?.required ?? []) {
    const value = properties[field];
    const missing =
      value === undefined ||
      value === null ||
      (typeof value === 'string' && value.trim().length === 0);
    if (missing) {
      return {
        error: { field: 'propertiesJson', message: `Missing required property: ${field}` },
      };
    }
  }

  return { properties };
}

/**
 * Parse a `key: value` block — one per line, optional `#` comments, blank
 * lines ignored. Coerces obvious shapes: `true`/`false` → boolean,
 * all-digit values (with optional decimal / sign) → number, anything else
 * stays a string. Rejects collisions with first-class Item field names
 * (mirrors the server-side property-shadow validation).
 */
export function parseAdditionalProperties(
  raw: string | undefined,
): { properties: Record<string, unknown> } | { error: ValidationError } {
  const text = raw?.trim() ?? '';
  if (!text) return { properties: {} };

  const properties: Record<string, unknown> = {};
  const lines = text.split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const colonAt = trimmed.indexOf(':');
    if (colonAt < 0) {
      return {
        error: {
          field: 'extraProperties',
          message: `Line ${index + 1}: expected "key: value"`,
        },
      };
    }
    const key = trimmed.slice(0, colonAt).trim();
    const valueRaw = trimmed.slice(colonAt + 1).trim();
    if (!key) {
      return { error: { field: 'extraProperties', message: `Line ${index + 1}: empty key` } };
    }
    if (FIRST_CLASS_SHADOW_KEYS.has(key)) {
      return {
        error: {
          field: 'extraProperties',
          message: `Line ${index + 1}: "${key}" shadows a first-class Item field`,
        },
      };
    }
    if (key in properties) {
      return {
        error: { field: 'extraProperties', message: `Line ${index + 1}: duplicate key "${key}"` },
      };
    }
    if (!valueRaw) continue;
    properties[key] = coerceValue(valueRaw);
  }
  return { properties };
}

function coerceValue(raw: string): unknown {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (raw === 'null') return null;
  // Number coercion: pure numeric, optional sign and decimal.
  if (/^-?\d+(\.\d+)?$/.test(raw)) {
    const n = Number(raw);
    if (Number.isFinite(n)) return n;
  }
  return raw;
}

/**
 * Fetch the current device location by invoking a user-installed macOS
 * Shortcut named "Myme Capture Location" (or the override). The Shortcut is
 * expected to output `lat,lon` on stdout. Returns `null` on any failure —
 * missing shortcut, denied permission, malformed output — so capture flows
 * can proceed without location rather than blocking.
 *
 * Best-effort by design. The user owns the Shortcut and grants whatever
 * permissions it needs (typically Find My / location). The extension never
 * sees a permission prompt of its own.
 */
export async function fetchCaptureLocation(
  shortcutName = 'Myme Capture Location',
): Promise<{ lat: number; lon: number } | null> {
  try {
    const escaped = shortcutName.replace(/"/g, '\\"');
    const result = await runAppleScript(
      `do shell script "shortcuts run \\"${escaped}\\" | tr -d '\\n'"`,
      { timeout: 5000 },
    );
    const trimmed = result.trim();
    if (!trimmed) return null;
    const parts = trimmed.split(',').map((s) => parseFloat(s.trim()));
    if (parts.length !== 2) return null;
    const [lat, lon] = parts;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
    return { lat, lon };
  } catch {
    return null;
  }
}
