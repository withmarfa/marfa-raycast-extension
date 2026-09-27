import type { TypeDefinition } from './marfa';
import {
  type FieldDefinition,
  type FieldType,
  RESERVED_ITEM_FIELDS,
  requiredFieldNames,
  resolveSchemaFields,
} from './schema-fields';

/**
 * A capture form, derived from what the server says a type is: each field's
 * kind, description, whether it is required, and an enum's values. Nothing
 * here names a type, so a type an instance registered gets as good a form as
 * a core one.
 *
 * Pure: it takes the registry and returns data, so the mapping is tested
 * without rendering anything.
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
  | 'json'
  | 'thumbnail';

export interface PlannedField {
  name: string;
  kind: FieldKind;
  title: string;
  /** The schema's description, shown as the field's help text. */
  info?: string;
  required: boolean;
  enumValues?: string[];
  /** For a list, what each entry is, so the values can be coerced. */
  itemsType?: string;
  /** The declared type, kept for validation and for messages that name it. */
  rawType: string;
  maxLength?: number;
  maxItems?: number;
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

/** How many optional fields show before the rest go behind the toggle, the same for every type. */
const PRIMARY_OPTIONAL_LIMIT = 6;

/**
 * A total record, so a kind the server adds stops the build here. The runtime
 * fallback to JSON is for the other direction: a server newer than this build.
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
  thumbnail: 'thumbnail',
};

/** Entry kinds a list can take one per line. Anything else is a structure, and needs JSON. */
const SCALAR_ITEM_TYPES = new Set(['string', 'number', 'integer', 'boolean', 'date', 'datetime']);

const FORMAT_INFO: Record<string, string> = {
  bcp47: 'A language tag, such as en or en-GB.',
  iso3166: 'A two-letter country code, such as GB.',
};

/**
 * One field's control. The type's body field gets room to type in, and an
 * enum with no values is a string, as the server's validator reads it.
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

  const formatInfo = field.format ? FORMAT_INFO[field.format] : undefined;
  return {
    name,
    kind,
    title: context.toTitle(name),
    info: [field.description, formatInfo].filter(Boolean).join('\n\n') || undefined,
    required: context.required,
    enumValues: field.enum_values?.length ? [...field.enum_values] : undefined,
    itemsType: field.items_type,
    rawType: field.type,
    maxLength: field.maxLength,
    maxItems: field.maxItems,
  };
}

/**
 * The form for a type, ordered and split. The display hints lead, then
 * everything required, then the optional fields in declared order.
 *
 * A required field is never behind the toggle, or the form refuses to submit
 * without showing where. Nor is a field the caller pins, since a hidden
 * control supplying a value writes something nobody chose. A JSON box and a
 * field the schema keeps out of search, the one sign it gives of machine
 * content, are demoted wherever they are declared.
 */
export function planCaptureForm(
  types: readonly TypeDefinition[] | undefined,
  typeId: string,
  hints: {
    titleField?: string;
    bodyField?: string;
    toTitle: (key: string) => string;
    /** Fields the form supplies a value for, which must stay visible. */
    alwaysShow?: ReadonlySet<string>;
    /** Names the form's own controls use, which a schema field may not collide with. */
    reservedByForm?: (name: string) => boolean;
  },
): FormPlan {
  const fields = resolveSchemaFields(types, typeId);
  const required = requiredFieldNames(types, typeId);
  const known = (types ?? []).some((type) => type.id === typeId);

  const shadowed: string[] = [];
  const planned: PlannedField[] = [];

  for (const [name, field] of Object.entries(fields)) {
    // The server refuses to register a field named like an item field, so this
    // only arises on a type registered before that rule; a control that did
    // nothing would be worse than naming it.
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
    !pinned(field) && (field.kind === 'json' || fields[field.name]?.searchable === false);

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
