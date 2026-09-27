import type { FormPlan, PlannedField } from './capture-plan';
import { isValidEmail, isValidTimeZone, isValidUrl, RESERVED_ITEM_FIELDS } from './schema-fields';
import { checkThumbnail } from './thumbnail';

/**
 * Turning what a person typed into what the server accepts, and refusing it
 * here when the server would refuse it there. Errors are keyed by field name,
 * so a form generated over any schema has somewhere to show each one.
 */
export type CaptureErrors = Record<string, string>;

/**
 * The form's own controls, which are not schema fields. The prefix is safe
 * only because the planner refuses to render a schema field that starts with
 * it: the server accepts a field named `__extra`, and several types declare
 * one named `tags`.
 */
export const FORM_FIELD_PREFIX = '__';
export const EXTRA_PROPERTIES_FIELD = '__extra';
export const RAW_JSON_FIELD = '__raw';
export const TAGS_FIELD = '__tags';
export const FILE_FIELD = '__file';

/**
 * What a schema states only in prose, per type. A type absent from here still
 * gets a complete, validated form; a stale entry costs one slightly worse
 * check on one field. `core.event`'s `end_timezone` says "absent means the
 * event ends in the zone it started in", and no field can express that.
 */
const CROSS_FIELD_CHECKS: Record<
  string,
  {
    /** The fields the rule reads, so an edit judges it only when one of them changed. */
    fields: string[];
    check: (properties: Record<string, unknown>) => { field: string; message: string } | null;
  }[]
> = {
  'core.event': [
    {
      fields: ['timezone', 'end_timezone'],
      check: (properties) => {
        for (const field of ['timezone', 'end_timezone']) {
          const zone = properties[field];
          if (typeof zone === 'string' && zone && !isValidTimeZone(zone)) {
            return { field, message: `${zone} is not a recognized time zone` };
          }
        }
        return null;
      },
    },
    {
      fields: ['starts_at', 'ends_at'],
      check: (properties) => {
        const starts = Date.parse(String(properties.starts_at));
        const ends = Date.parse(String(properties.ends_at));
        if (!Number.isNaN(starts) && !Number.isNaN(ends) && ends < starts) {
          return { field: 'ends_at', message: 'The end is before the start' };
        }
        return null;
      },
    },
  ],
};

/** Applied after the properties are built: what to leave out, rather than what is wrong. */
const NORMALIZERS: Record<string, (properties: Record<string, unknown>) => void> = {
  'core.event': (properties) => {
    // Absent already means the zone it started in.
    if (properties.end_timezone === properties.timezone) delete properties.end_timezone;
  },
};

/**
 * Fields a type must show even when the form is collapsed, because the form
 * gives them a value of its own. `timezone` is `core.event`'s fifteenth field,
 * and an event without one advances in UTC.
 */
const ALWAYS_SHOWN: Record<string, string[]> = {
  'core.event': ['timezone', 'end_timezone'],
};

export function alwaysShownFields(typeId: string): ReadonlySet<string> {
  return new Set(ALWAYS_SHOWN[typeId] ?? []);
}

/**
 * Fields filled in from the device when the caller names none: the form's
 * start zone, and the capture tool's. Only for the types listed, so a place's
 * time zone is never set to wherever the person happens to be.
 */
const DEVICE_ZONE_FIELDS: Record<string, string[]> = {
  'core.event': ['timezone'],
};

export function captureDefaults(typeId: string, deviceZone: string): Record<string, string> {
  const fields = DEVICE_ZONE_FIELDS[typeId] ?? [];
  return Object.fromEntries(fields.map((field) => [field, deviceZone]));
}

/** The types this file knows anything specific about, asserted by a test. */
export const TYPES_WITH_RULES = Object.keys({
  ...CROSS_FIELD_CHECKS,
  ...NORMALIZERS,
  ...ALWAYS_SHOWN,
  ...DEVICE_ZONE_FIELDS,
}).sort();

/** The zone this machine is in: an event keeps its own zone, and the device's is the likely one. */
export function deviceTimeZone(): string {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return zone && isValidTimeZone(zone) ? zone : 'UTC';
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const OFFSET = /(Z|[+-]\d{2}:?\d{2})$/i;
/** Decimal notation only: `Number()` would also read `0x10` as sixteen. */
const DECIMAL = /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/;

function coerceScalar(
  raw: string,
  itemsType: string | undefined,
): { value: unknown } | { error: string } {
  if (itemsType === 'number' || itemsType === 'integer') {
    const value = DECIMAL.test(raw) ? Number(raw) : Number.NaN;
    if (!Number.isFinite(value)) return { error: `"${raw}" is not a number` };
    if (itemsType === 'integer' && !Number.isInteger(value)) {
      return { error: `"${raw}" is not a whole number` };
    }
    return { value };
  }
  if (itemsType === 'boolean') {
    if (raw !== 'true' && raw !== 'false') return { error: `"${raw}" is not true or false` };
    return { value: raw === 'true' };
  }
  return { value: raw };
}

/**
 * A date-only string as the day it names, in the reader's own zone.
 * `new Date('2026-03-15')` is UTC midnight, the fourteenth west of Greenwich.
 */
function parseDateText(text: string): Date | null {
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (dateOnly) {
    const [, year, month, day] = dateOnly;
    return new Date(Number(year), Number(month) - 1, Number(day));
  }
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** The calendar day a person picked, in their own zone; an ISO string cut at ten is the UTC day. */
function localDate(value: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${String(value.getFullYear())}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
}

/** One field's value, or an error about it. Blank means absent throughout. */
function readField(field: PlannedField, raw: unknown): { value?: unknown } | { error: string } {
  switch (field.kind) {
    case 'checkbox':
      if (typeof raw === 'string' && raw.trim() !== '') {
        return { error: `${field.title} must be true or false` };
      }
      // Written only when true, unless required: a false is the absence of the flag.
      return raw === true ? { value: true } : field.required ? { value: false } : {};

    case 'datetime':
    case 'date': {
      if (raw instanceof Date) {
        return { value: field.kind === 'date' ? localDate(raw) : raw.toISOString() };
      }
      // Text comes from the tool and from a revived draft; what cannot be read
      // is refused rather than dropped.
      const text = typeof raw === 'string' ? raw.trim() : '';
      if (!text) return {};
      const parsed = parseDateText(text);
      if (!parsed) return { error: `${field.title} is not a date this can read` };
      if (field.kind === 'datetime') {
        // A bare day is the server's all-day shape, and goes as it is.
        if (DATE_ONLY.test(text)) return { value: text };
        // A time with no offset names no instant; reading it in this machine's
        // zone would move an event booked elsewhere.
        if (!OFFSET.test(text)) {
          return { error: `${field.title} needs a zone offset, such as Z or +01:00` };
        }
      }
      return { value: field.kind === 'date' ? localDate(parsed) : parsed.toISOString() };
    }

    case 'tagpicker': {
      const values = Array.isArray(raw) ? raw.filter((v) => typeof v === 'string') : [];
      const outside = values.filter((value) => !(field.enumValues ?? []).includes(value));
      if (outside.length > 0) {
        return {
          error: `${field.title} takes only: ${(field.enumValues ?? []).join(', ')}`,
        };
      }
      if (field.maxItems !== undefined && values.length > field.maxItems) {
        return { error: `${field.title} takes at most ${String(field.maxItems)}` };
      }
      return values.length ? { value: values } : {};
    }

    case 'number':
    case 'integer': {
      const text = typeof raw === 'string' ? raw.trim() : '';
      if (!text) return {};
      const value = DECIMAL.test(text) ? Number(text) : Number.NaN;
      if (!Number.isFinite(value)) return { error: `${field.title} must be a number` };
      if (field.kind === 'integer' && !Number.isInteger(value)) {
        return { error: `${field.title} must be a whole number` };
      }
      return { value };
    }

    case 'list': {
      // An array arrives when a type switch carries a picker's value to a list of the same name.
      const text = Array.isArray(raw)
        ? raw.map(String).join('\n')
        : typeof raw === 'string'
          ? raw
          : '';
      // One per line, never comma-separated: recurrence rules contain commas.
      const lines = text
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);
      const entries: unknown[] = [];
      for (const line of lines) {
        const coerced = coerceScalar(line, field.itemsType);
        if ('error' in coerced) return { error: `${field.title}: ${coerced.error}` };
        entries.push(coerced.value);
      }
      if (field.maxItems !== undefined && entries.length > field.maxItems) {
        return { error: `${field.title} takes at most ${String(field.maxItems)}` };
      }
      return entries.length ? { value: entries } : {};
    }

    case 'json': {
      const text = typeof raw === 'string' ? raw.trim() : '';
      if (!text) return {};
      try {
        return { value: JSON.parse(text) };
      } catch {
        return { error: `${field.title} must be valid JSON` };
      }
    }

    case 'thumbnail': {
      const text = typeof raw === 'string' ? raw.trim() : '';
      if (!text) return {};
      const checked = checkThumbnail(text);
      return 'error' in checked ? { error: `${field.title}: ${checked.error}` } : checked;
    }

    default: {
      const text = typeof raw === 'string' ? raw.trim() : '';
      if (!text) return {};
      // A body keeps its leading indent and its line breaks: an indented first
      // line is a code block in markdown.
      if (field.kind === 'textarea') {
        if (field.maxLength !== undefined && (raw as string).length > field.maxLength) {
          return { error: `${field.title} takes at most ${String(field.maxLength)} characters` };
        }
        return { value: raw };
      }
      if (field.rawType === 'url' && !isValidUrl(text)) {
        return { error: `${field.title} must be a URL` };
      }
      if (field.rawType === 'email' && !isValidEmail(text)) {
        return { error: `${field.title} must be an email address` };
      }
      // A form constrains an enum with a dropdown; nothing constrains the tool.
      if (field.enumValues?.length && !field.enumValues.includes(text)) {
        return { error: `${field.title} must be one of: ${field.enumValues.join(', ')}` };
      }
      if (field.maxLength !== undefined && text.length > field.maxLength) {
        return { error: `${field.title} takes at most ${String(field.maxLength)} characters` };
      }
      return { value: text };
    }
  }
}

/**
 * The properties to send, or every reason not to, all at once, so a person
 * does not submit repeatedly to find the next one.
 */
export function buildCaptureProperties(
  plan: FormPlan,
  typeId: string,
  values: Record<string, unknown>,
  /**
   * For an edit, what the form would build for the item untouched. A rule
   * across fields is then judged only when the person changed one of its
   * fields: a stored value the server took must not block an unrelated edit.
   */
  baseline?: Record<string, unknown>,
): { properties: Record<string, unknown> } | { errors: CaptureErrors } {
  // A type the registry does not hold gets its properties as JSON: there is no
  // schema to build a form from, and the server validates what it knows.
  if (!plan.known) {
    const raw = values[RAW_JSON_FIELD];
    const text = typeof raw === 'string' ? raw.trim() : '';
    if (!text) return { properties: {} };
    try {
      const parsed: unknown = JSON.parse(text);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        return { errors: { [RAW_JSON_FIELD]: 'Properties must be a JSON object' } };
      }
      return { properties: parsed as Record<string, unknown> };
    } catch {
      return { errors: { [RAW_JSON_FIELD]: 'Properties must be valid JSON' } };
    }
  }

  const properties: Record<string, unknown> = {};
  const errors: CaptureErrors = {};
  const fields = [...plan.primary, ...plan.secondary];

  for (const field of fields) {
    const read = readField(field, values[field.name]);
    if ('error' in read) {
      errors[field.name] = read.error;
      continue;
    }
    if (read.value !== undefined) properties[field.name] = read.value;
  }

  for (const field of fields) {
    if (field.required && properties[field.name] === undefined && !errors[field.name]) {
      errors[field.name] = `${field.title} is required`;
    }
  }

  for (const rule of CROSS_FIELD_CHECKS[typeId] ?? []) {
    const touched =
      !baseline ||
      rule.fields.some(
        (field) => JSON.stringify(properties[field]) !== JSON.stringify(baseline[field]),
      );
    if (!touched) continue;
    const failure = rule.check(properties);
    if (failure && !errors[failure.field]) errors[failure.field] = failure.message;
  }

  if (Object.keys(errors).length > 0) return { errors };

  NORMALIZERS[typeId]?.(properties);
  return { properties };
}

/**
 * What the form would send for values nobody has touched: each field read
 * alone, the type's normalizing applied, and the fields that cannot be read
 * named. An edit compares against this rather than the stored value, so a
 * value the form only respells is not taken for a change.
 */
export function baselineProperties(
  fields: readonly PlannedField[],
  typeId: string,
  values: Record<string, unknown>,
): {
  properties: Record<string, unknown>;
  /** The same before the type's normalizing, as a rule across fields reads them. */
  read: Record<string, unknown>;
  unreadable: Set<string>;
} {
  const read: Record<string, unknown> = {};
  const unreadable = new Set<string>();
  for (const field of fields) {
    const value = readField(field, values[field.name]);
    if ('error' in value) unreadable.add(field.name);
    else if (value.value !== undefined) read[field.name] = value.value;
  }
  const properties = { ...read };
  NORMALIZERS[typeId]?.(properties);
  return { properties, read, unreadable };
}

/**
 * Text values as the form's controls would have produced them, so the tool
 * and the form answer to one validator: a `Date` for a date, an array for a
 * tag picker, a boolean for a checkbox. Every field counts, not only the ones
 * a form shows before its toggle.
 */
export function valuesFromText(
  plan: FormPlan,
  properties: readonly { name: string; value: string }[],
): Record<string, unknown> {
  const supplied = new Map(properties.map((entry) => [entry.name, entry.value]));
  const values: Record<string, unknown> = {};
  const fields = [...plan.primary, ...plan.secondary];

  for (const field of fields) {
    const raw = supplied.get(field.name);
    if (raw === undefined) continue;
    switch (field.kind) {
      case 'datetime':
      case 'date':
        // As text, so the validator reads the day, the offset or the refusal itself.
        values[field.name] = raw;
        break;
      case 'tagpicker':
        values[field.name] = raw
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean);
        break;
      case 'checkbox':
        // Anything but the two words stays text, which the validator refuses by name.
        values[field.name] = raw === 'true' ? true : raw === 'false' ? false : raw;
        break;
      default:
        values[field.name] = raw;
    }
  }

  // A name the type does not declare is reported, so a model inventing a field hears of it.
  const known = new Set(fields.map((field) => field.name));
  const unknown = [...supplied.keys()].filter((name) => !known.has(name));
  if (unknown.length > 0) {
    throw new Error(
      `${fields.length === 0 ? 'This type declares no fields' : 'Not fields of this type'}: ` +
        `${unknown.join(', ')}. Call list-types to see what it declares.`,
    );
  }

  return values;
}

/** Properties the server resolves onto every type, whatever the type declares. */
const UNIVERSAL_FIELDS = new Set(['links', 'attachments']);

/**
 * `key: value` lines, for what a person knows that the type does not declare.
 * `true` and `false` become booleans, and a number written as its canonical
 * self a number, so `01234` stays text. A key naming an item field is refused,
 * as the server refuses it, and so is one the type declares, which has its own
 * checked control.
 */
export function parseAdditionalProperties(
  raw: string | undefined,
  declared: Iterable<string> = [],
): { properties: Record<string, unknown> } | { error: string } {
  const own = new Set(declared);
  const text = raw?.trim() ?? '';
  const properties: Record<string, unknown> = {};
  if (!text) return { properties };

  for (const [index, line] of text.split(/\r?\n/).entries()) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const where = `Line ${String(index + 1)}`;
    const colonAt = trimmed.indexOf(':');
    if (colonAt < 0) return { error: `${where}: expected "key: value"` };
    const key = trimmed.slice(0, colonAt).trim();
    const value = trimmed.slice(colonAt + 1).trim();
    if (!key) return { error: `${where}: empty key` };
    if (RESERVED_ITEM_FIELDS.has(key)) return { error: `${where}: "${key}" is an item field` };
    if (own.has(key) || UNIVERSAL_FIELDS.has(key)) {
      return { error: `${where}: "${key}" is a field of this type; set it above` };
    }
    if (key in properties) return { error: `${where}: "${key}" is given twice` };
    if (!value) continue;
    properties[key] = coerceValue(value);
  }
  return { properties };
}

function coerceValue(raw: string): unknown {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  const number = Number(raw);
  if (/^-?\d+(\.\d+)?$/.test(raw) && String(number) === raw) return number;
  return raw;
}
