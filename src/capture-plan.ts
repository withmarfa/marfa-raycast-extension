import { RESERVED_ITEM_FIELDS } from '@withmarfa/shared';
import type { FieldDefinition, FieldType } from '@withmarfa/shared';
import type { TypeSchema } from '@withmarfa/sdk';
import { requiredFieldNames, resolveSchemaFields } from './schema-fields';

/**
 * A capture form, derived from what the server says a type is.
 *
 * The extension used to hand-write a form for four types and give every other
 * one a textarea expecting JSON, which is two thirds of an ordinary registry.
 * The schema already carries what a form needs: each field's kind, its
 * description, whether it is required, and an enum's values. Reading that is
 * the same principle the display resolver runs on, applied to the surface it
 * was never applied to.
 *
 * **The hand-written forms were already worse than this.** The event form
 * omitted seven of its type's fields; the task form wrote `description` while
 * that type's body field is `body`; and the task priority dropdown was a
 * hand-copied enum that happened to still match.
 *
 * Pure on purpose. Everything here takes schemas and returns data, so the whole
 * mapping is assertable without rendering anything.
 */

export type FieldKind =
  | 'text'
  | 'textarea'
  | 'number'
  | 'integer'
  | 'checkbox'
  | 'dropdown'
  | 'tagpicker'
  | 'datetime'
  | 'date'
  | 'list'
  | 'json';

export interface PlannedField {
  name: string;
  kind: FieldKind;
  /** What the label reads. */
  title: string;
  /** The schema's own description, shown as the field's help text. */
  info?: string;
  required: boolean;
  enumValues?: string[];
  /** For a list, what each entry is, so the values can be coerced. */
  itemsType?: string;
  /** The schema's own type name, kept for validation and for a message that
   *  needs to name what the server said. */
  rawType: string;
}

export interface FormPlan {
  /** Rendered immediately. */
  primary: PlannedField[];
  /** Behind a toggle, because a seventeen-field form is not a capture form. */
  secondary: PlannedField[];
  /** Declared fields that cannot be set here, named rather than dropped. */
  shadowed: string[];
  /** False when the registry has never heard of this type. */
  known: boolean;
}

/**
 * How many optional fields a form shows before the rest go behind a toggle.
 *
 * A layout constant applied identically to every type, which is what keeps it
 * out of the per-type-knowledge category the rest of this module exists to
 * remove. `core.event` has seventeen fields; a form is not a form at that
 * length, and the fields past the first few are ones a launcher capture almost
 * never sets.
 */
const PRIMARY_OPTIONAL_LIMIT = 6;

/**
 * The schema's kinds mapped onto what a form can render.
 *
 * A total record rather than a switch, so a kind the platform adds stops the
 * build here rather than falling through to a text box. The runtime fallback
 * below is for the other direction: the wire is JSON and a server can send a
 * kind this build has never heard of.
 */
const KIND_BY_TYPE: Record<FieldType, FieldKind> = {
  string: 'text',
  number: 'number',
  integer: 'integer',
  boolean: 'checkbox',
  url: 'text',
  email: 'text',
  datetime: 'datetime',
  date: 'date',
  enum: 'dropdown',
  array: 'list',
  object: 'json',
};

/** Entry kinds a list can render as one value per line. Anything else is a
 *  structure, and a structure needs JSON. */
const SCALAR_ITEM_TYPES = new Set(['string', 'number', 'integer', 'boolean', 'date', 'datetime']);

function titleFor(name: string, toTitle: (key: string) => string): string {
  return toTitle(name);
}

/**
 * One field's control.
 *
 * Two kinds are decided by more than the declared type. A string the registry
 * named as the type's body gets room to type in, because that is the field a
 * note is. And an enum with no values is not a dropdown with nothing in it: the
 * platform's own validator falls back to a bounded string there, so this does
 * too.
 */
export function classifyField(
  name: string,
  field: FieldDefinition,
  context: { bodyField?: string; required: boolean; toTitle: (key: string) => string },
): PlannedField {
  const declared = KIND_BY_TYPE[field.type as FieldType] as FieldKind | undefined;
  let kind: FieldKind = declared ?? 'json';

  if (kind === 'dropdown' && !field.enum_values?.length) kind = 'text';
  if (kind === 'text' && field.type === 'string' && name === context.bodyField) kind = 'textarea';
  if (kind === 'list') {
    if (field.enum_values?.length) kind = 'tagpicker';
    else if (!field.items_type || !SCALAR_ITEM_TYPES.has(field.items_type)) kind = 'json';
  }

  return {
    name,
    kind,
    title: titleFor(name, context.toTitle),
    info: field.description,
    required: context.required,
    enumValues: field.enum_values?.length ? [...field.enum_values] : undefined,
    itemsType: field.items_type,
    rawType: field.type,
  };
}

/**
 * The form for a type, ordered and split.
 *
 * Ordering is the only importance signal a schema carries, and in every real
 * one it is genuinely importance-ordered. The type's own display hints lead,
 * because they name what the item is called and what it says; then everything
 * else required, because a form that cannot be submitted must show why; then
 * the optional fields in the order the schema declares them.
 *
 * **A required field is never behind the toggle**, because hiding one produces a
 * form that refuses to submit and does not say where the problem is. Nor is a
 * field the caller pins: a control the form supplies a value for cannot be
 * hidden, or the form writes something nobody chose.
 *
 * Two kinds demote regardless of position: anything that ends up as a JSON box,
 * which is never what someone came to fill in, and anything the schema marks as
 * excluded from search, which is the one signal it gives that a field carries
 * machine content rather than something a person writes.
 */
export function planCaptureForm(
  schemas: readonly TypeSchema[] | undefined,
  typeId: string,
  hints: {
    titleField?: string;
    bodyField?: string;
    toTitle: (key: string) => string;
    /** Fields that must stay visible whatever the ordering says, because the
     *  form supplies a value for them and a hidden control writing one is a
     *  value nobody chose. */
    alwaysShow?: ReadonlySet<string>;
    /** Names the form itself uses, which a schema field cannot be allowed to
     *  collide with. */
    reservedByForm?: (name: string) => boolean;
  },
): FormPlan {
  const fields = resolveSchemaFields(schemas, typeId);
  const required = requiredFieldNames(schemas, typeId);
  const known = Object.keys(fields).length > 0;

  const shadowed: string[] = [];
  const planned: PlannedField[] = [];

  for (const [name, field] of Object.entries(fields)) {
    // A property named like a first-class Item field cannot be set through
    // properties at all. The server refuses to register such a type, so this
    // only arises on an instance that bypassed registration, and a control that
    // silently did nothing would be worse than none.
    if (RESERVED_ITEM_FIELDS.has(name) || hints.reservedByForm?.(name)) {
      shadowed.push(name);
      continue;
    }
    planned.push(
      classifyField(name, field, {
        bodyField: hints.bodyField,
        required: required.has(name),
        toTitle: hints.toTitle,
      }),
    );
  }

  const alwaysShow = hints.alwaysShow ?? new Set<string>();
  const rank = (field: PlannedField): number => {
    if (field.name === hints.titleField) return 0;
    if (field.name === hints.bodyField) return 1;
    if (field.required) return 2;
    return alwaysShow.has(field.name) ? 3 : 4;
  };
  const ordered = planned
    .map((field, index) => ({ field, index }))
    .sort((a, b) => rank(a.field) - rank(b.field) || a.index - b.index)
    .map(({ field }) => field);

  const pinned = (field: PlannedField) => field.required || alwaysShow.has(field.name);
  const demoted = (field: PlannedField) =>
    !pinned(field) && (field.kind === 'json' || isMachineContent(fields[field.name]));

  const primary: PlannedField[] = [];
  const secondary: PlannedField[] = [];
  let optionalShown = 0;
  for (const field of ordered) {
    if (pinned(field)) {
      primary.push(field);
      continue;
    }
    if (demoted(field) || optionalShown >= PRIMARY_OPTIONAL_LIMIT) {
      secondary.push(field);
      continue;
    }
    optionalShown++;
    primary.push(field);
  }

  return { primary, secondary, shadowed, known };
}

function isMachineContent(field: FieldDefinition | undefined): boolean {
  return field?.searchable === false;
}
