import { isValidTimeZone, isValidUrl } from '@withmarfa/shared';
import type { FormPlan, PlannedField } from './capture-plan';

/**
 * Turning what a person typed into what the server accepts, and refusing it
 * here when the server would refuse it there.
 *
 * **Errors are keyed by field name rather than by a fixed union.** The old
 * shape had seven members, so a form generated over an arbitrary schema had
 * nowhere to put an error about `playlist_id`. It also meant a validation
 * failure the caller had no case for fell through a bare `return` and the form
 * did nothing at all: no toast, no marked field, no explanation. Keying by name
 * makes that unreachable, because the renderer maps over the same plan.
 */
export type CaptureErrors = Record<string, string>;

/**
 * The form's own controls, which are not schema fields.
 *
 * **The prefix is not a guarantee on its own.** The platform accepts a field
 * literally named `__extra`, so these ids are safe only because the planner
 * refuses to render any schema field whose name starts with the prefix, and
 * says which ones it dropped. Four shipped types declare a field called `tags`,
 * which is exactly how this was found: the extension's own tag box used that id
 * and the two controls fought over one value.
 */
export const FORM_FIELD_PREFIX = '__';
export const EXTRA_PROPERTIES_FIELD = '__extra';
export const RAW_JSON_FIELD = '__raw';
export const TAGS_FIELD = '__tags';
export const FILE_FIELD = '__file';

/**
 * What the schema cannot say, per type.
 *
 * **These are decorations, not a gate, and the difference is the whole
 * argument.** A type absent from here still gets a complete, validated form; a
 * type absent from the list this replaces got a JSON textarea. The failure mode
 * of a stale entry is one slightly worse control on one field. The failure mode
 * of a stale gate was two thirds of the registry falling off a cliff.
 *
 * Every rule here is one the schema states in prose and gives no field to read.
 * `core.event.end_timezone`'s own description says "Absent means the event ends
 * in the zone it started in", and there is no structural way to express that.
 */
const CROSS_FIELD_CHECKS: Record<
  string,
  ((values: Record<string, unknown>) => { field: string; message: string } | null)[]
> = {
  'core.event': [
    (values) => {
      for (const field of ['timezone', 'end_timezone']) {
        const zone = values[field];
        if (typeof zone === 'string' && zone && !isValidTimeZone(zone)) {
          return { field, message: `${zone} is not a recognized time zone` };
        }
      }
      return null;
    },
    (values) => {
      const starts = values.starts_at;
      const ends = values.ends_at;
      if (starts instanceof Date && ends instanceof Date && ends < starts) {
        return { field: 'ends_at', message: 'The end is before the start' };
      }
      return null;
    },
  ],
};

/** Applied after the properties are built, for a rule about what to leave out
 *  rather than about what is wrong. */
const NORMALIZERS: Record<string, (properties: Record<string, unknown>) => void> = {
  'core.event': (properties) => {
    // The schema says absent means "the zone it started in", so storing the
    // same zone twice states something the type defines as the default.
    if (properties.end_timezone === properties.timezone) delete properties.end_timezone;
  },
};

/**
 * Fields a type must show even when the form is collapsed.
 *
 * **A field the form gives a value to on its own cannot be hidden.** The zone
 * controls default to the device's zone, so leaving them behind the toggle
 * writes a zone the person never chose, or, worse, omits one: `core.event`
 * declares seventeen fields and `timezone` is the fifteenth, so every event
 * captured from the launcher would have shipped without it. Its own description
 * says an absent zone means the schedule advances in UTC, which is not what
 * anyone booking something in their own city means.
 */
const ALWAYS_SHOWN: Record<string, string[]> = {
  'core.event': ['timezone', 'end_timezone'],
};

export function alwaysShownFields(typeId: string): ReadonlySet<string> {
  return new Set(ALWAYS_SHOWN[typeId] ?? []);
}

/**
 * Fields a caller with no control gets filled in from the device.
 *
 * **For a caller supplying values directly, not for the form**, and the two are
 * not the same question however much they look it. A dropdown must carry a
 * selection that is one of its own options, so the form defaults every start
 * zone to the device's whatever the type; there is no "write nothing" for it to
 * express. A tool has that option, and taking it is what made an event captured
 * by asking carry no zone at all, which `core.event` defines as a schedule that
 * advances in UTC.
 *
 * Routing the form through this table looked like the fix for that drift and
 * was not: a type outside the table would have defaulted its zone dropdown to
 * an empty string matching none of its options.
 */
const DEVICE_ZONE_FIELDS: Record<string, string[]> = {
  'core.event': ['timezone'],
};

export function captureDefaults(typeId: string, deviceZone: string): Record<string, string> {
  const fields = DEVICE_ZONE_FIELDS[typeId] ?? [];
  return Object.fromEntries(fields.map((field) => [field, deviceZone]));
}

/** The types this file knows anything specific about. Asserted by a test, so
 *  growing it is a deliberate act with a name on the diff. */
export const TYPES_WITH_RULES = Object.keys({
  ...CROSS_FIELD_CHECKS,
  ...NORMALIZERS,
  ...ALWAYS_SHOWN,
  ...DEVICE_ZONE_FIELDS,
}).sort();

function coerceScalar(
  raw: string,
  itemsType: string | undefined,
): { value: unknown } | { error: string } {
  if (itemsType === 'number' || itemsType === 'integer') {
    const value = Number(raw);
    if (!Number.isFinite(value)) return { error: `"${raw}" is not a number` };
    if (itemsType === 'integer' && !Number.isInteger(value)) {
      return { error: `"${raw}" is not a whole number` };
    }
    return { value };
  }
  if (itemsType === 'boolean') {
    // Anything-but-true meaning false would send a value the person never
    // stated, for a line they probably mistyped.
    if (raw !== 'true' && raw !== 'false') return { error: `"${raw}" is not true or false` };
    return { value: raw === 'true' };
  }
  return { value: raw };
}

/**
 * A date-only string as the day it names, in the reader's own zone.
 *
 * **`new Date('2026-03-15')` is UTC midnight**, which is the fourteenth for
 * anyone west of Greenwich, so parsing and then formatting locally moved the
 * day by one. A calendar date carries no instant, so its parts are read
 * directly rather than through an instant that has to be in some zone.
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

/** A date as the calendar day a person picked, in their own zone. An ISO string
 *  sliced at ten characters is the UTC day, which is a different day for anyone
 *  west of Greenwich after their afternoon. */
function localDate(value: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${String(value.getFullYear())}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
}

/**
 * One field's value, or an error about it.
 *
 * Blank means absent throughout. Every write in the forms this replaces trimmed
 * and omitted rather than sending an empty string, and the platform treats an
 * optional field as nullish, so an empty string is a value where none was
 * meant.
 */
function readField(field: PlannedField, raw: unknown): { value?: unknown } | { error: string } {
  switch (field.kind) {
    case 'checkbox':
      // Written only when true, unless the type requires it. A false is the
      // absence of the flag for every optional boolean in the shipped schemas.
      return raw === true ? { value: true } : field.required ? { value: false } : {};

    case 'datetime':
    case 'date': {
      if (raw instanceof Date) {
        return { value: field.kind === 'date' ? localDate(raw) : raw.toISOString() };
      }
      // Text reaches here from a tool and from a revived draft. Anything the
      // parser cannot read is reported rather than dropped: a task whose due
      // date silently did not survive is worse than one that was refused.
      const text = typeof raw === 'string' ? raw.trim() : '';
      if (!text) return {};
      const parsed = parseDateText(text);
      if (!parsed) return { error: `${field.title} is not a date this can read` };
      return { value: field.kind === 'date' ? localDate(parsed) : parsed.toISOString() };
    }

    case 'tagpicker': {
      const values = Array.isArray(raw) ? raw.filter((v) => typeof v === 'string') : [];
      return values.length ? { value: values } : {};
    }

    case 'number':
    case 'integer': {
      const text = typeof raw === 'string' ? raw.trim() : '';
      if (!text) return {};
      const value = Number(text);
      if (!Number.isFinite(value)) return { error: `${field.title} must be a number` };
      if (field.kind === 'integer' && !Number.isInteger(value)) {
        return { error: `${field.title} must be a whole number` };
      }
      return { value };
    }

    case 'list': {
      const text = typeof raw === 'string' ? raw : '';
      // One per line, never comma-separated: `core.event.recurrence` holds
      // RFC 5545 rules and those contain commas.
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

    default: {
      const text = typeof raw === 'string' ? raw.trim() : '';
      if (!text) return {};
      if (field.rawType === 'url' && !isValidUrl(text)) {
        return { error: `${field.title} must be a URL` };
      }
      // A form constrains an enum with a dropdown. Nothing constrains a caller
      // supplying text, so the values are checked here or the server refuses
      // it later with less to say.
      if (field.enumValues?.length && !field.enumValues.includes(text)) {
        return { error: `${field.title} must be one of: ${field.enumValues.join(', ')}` };
      }
      return { value: text };
    }
  }
}

/**
 * The properties to send, or every reason not to.
 *
 * Reports all of them rather than the first, because a form marking one field
 * at a time makes a person submit repeatedly to discover what else is wrong.
 */
export function buildCaptureProperties(
  plan: FormPlan,
  typeId: string,
  values: Record<string, unknown>,
): { properties: Record<string, unknown> } | { errors: CaptureErrors } {
  // A type this server has no schema for gets the whole payload as JSON, which
  // is what every type used to get. There are no fields to generate and no
  // requirements to check, and a form with nothing on it would make a
  // registered type uncapturable from here.
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

  for (const field of [...plan.primary, ...plan.secondary]) {
    const read = readField(field, values[field.name]);
    if ('error' in read) {
      errors[field.name] = read.error;
      continue;
    }
    if (read.value !== undefined) properties[field.name] = read.value;
  }

  for (const field of [...plan.primary, ...plan.secondary]) {
    if (field.required && properties[field.name] === undefined && !errors[field.name]) {
      errors[field.name] = `${field.title} is required`;
    }
  }

  for (const check of CROSS_FIELD_CHECKS[typeId] ?? []) {
    const failure = check(values);
    if (failure && !errors[failure.field]) errors[failure.field] = failure.message;
  }

  if (Object.keys(errors).length > 0) return { errors };

  NORMALIZERS[typeId]?.(properties);
  return { properties };
}

/**
 * Text values, as the form's own controls would have produced them.
 *
 * An AI tool supplies text where a form supplies whatever its control emits:
 * a `Date` from a picker, an array from a tag picker, a boolean from a checkbox.
 * Converting here means one validator answers for both, rather than a second
 * copy that could disagree about what a type requires.
 */
export function valuesFromText(
  plan: FormPlan,
  properties: readonly { name: string; value: string }[],
): Record<string, unknown> {
  const supplied = new Map(properties.map((entry) => [entry.name, entry.value]));
  const values: Record<string, unknown> = {};

  // Both halves. The split is about how much of a form to show at once, and a
  // caller supplying values directly is not looking at one, so reading only
  // `primary` here would refuse a field purely for being declared far enough
  // down the schema to sit behind the toggle.
  const fields = [...plan.primary, ...plan.secondary];

  for (const field of fields) {
    const raw = supplied.get(field.name);
    if (raw === undefined) continue;
    switch (field.kind) {
      case 'datetime':
      case 'date': {
        // The same parser the validator uses. `new Date('2026-03-15')` is UTC
        // midnight, which is the previous day everywhere west of Greenwich, so
        // reading it here and taking the local day later moved every date-only
        // value back by one.
        const parsed = parseDateText(raw);
        // Text the parser cannot read passes through as text, so the refusal
        // comes from the validator and names the field, rather than an Invalid
        // Date travelling on to somewhere with less to say.
        values[field.name] = parsed ?? raw;
        break;
      }
      case 'tagpicker':
        values[field.name] = raw
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean);
        break;
      case 'checkbox':
        values[field.name] = raw === 'true';
        break;
      default:
        // Text, numbers, lists and JSON all reach the validator as the strings
        // a form control would have produced, which is what keeps this one
        // validator rather than two that could disagree.
        values[field.name] = raw;
    }
  }

  // A name the type does not declare is reported rather than dropped: a model
  // inventing a field should hear about it, not watch it vanish.
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
