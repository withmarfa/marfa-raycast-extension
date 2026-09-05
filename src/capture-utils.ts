import { isValidTimeZone } from '@withmarfa/shared';
import { runAppleScript } from '@raycast/utils';
import { FIRST_CLASS_SHADOW_KEYS } from './item-metadata';

/**
 * The zone this machine is in, used as the default an event carries.
 *
 * An event stores its own zone rather than inheriting the account's,
 * because an event booked in another city keeps that city's hour and a
 * recurring one anchored to the wrong zone drifts when clocks change. The
 * device's zone is the right default precisely because it is usually where
 * the person capturing is.
 */
export function deviceTimeZone(): string {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return zone && isValidTimeZone(zone) ? zone : 'UTC';
}

/**
 * A failure in the free-form properties block, which is the one input here
 * that has no schema field to name. Errors about schema fields are keyed by
 * field name in `capture-values`.
 */
export interface ValidationError {
  message: string;
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

/**
 * Parse a `key: value` block: one per line, optional `#` comments, blank
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
          message: `Line ${index + 1}: expected "key: value"`,
        },
      };
    }
    const key = trimmed.slice(0, colonAt).trim();
    const valueRaw = trimmed.slice(colonAt + 1).trim();
    if (!key) {
      return { error: { message: `Line ${index + 1}: empty key` } };
    }
    if (FIRST_CLASS_SHADOW_KEYS.has(key)) {
      return {
        error: {
          message: `Line ${index + 1}: "${key}" shadows a first-class Item field`,
        },
      };
    }
    if (key in properties) {
      return {
        error: { message: `Line ${index + 1}: duplicate key "${key}"` },
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
 * Shortcut named "Marfa Capture Location" (or the override). The Shortcut is
 * expected to output `lat,lon` on stdout. Returns `null` on any failure,
 * whether a missing shortcut, a denied permission or malformed output, so
 * capture flows proceed without location rather than blocking.
 *
 * Best-effort by design. The user owns the Shortcut and grants whatever
 * permissions it needs (typically Find My / location). The extension never
 * sees a permission prompt of its own.
 */
export async function fetchCaptureLocation(
  shortcutName = 'Marfa Capture Location',
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
