import { wantsBlob, BLOB_SUPPLIED_FIELDS } from './capture-blob';
import { type FormPlan, planCaptureForm, type PlannedField } from './capture-plan';
import { alwaysShownFields, captureDefaults, FORM_FIELD_PREFIX } from './capture-values';
import type { Registry } from './display';
import { toTitleCase } from './schema-fields';

/**
 * The capture form for one type, as the views render it: the plan, with what
 * a note and a file each change about it. Pure, so the shape of every form is
 * tested without Raycast.
 */
export interface CaptureFormModel {
  typeId: string;
  plan: FormPlan;
  /**
   * A note is written as its body and named by its first line, as every app
   * names one, so its form leads with the body alone and offers no title.
   */
  isNote: boolean;
  /** The type holds an uploaded file, so the form offers a picker in place of its fields. */
  takesFile: boolean;
  titleField?: string;
  bodyField?: string;
  hasUrlField: boolean;
}

export function captureFormModel(registry: Registry, typeId: string): CaptureFormModel {
  const titleField = registry.titleField(typeId);
  const bodyField = registry.bodyField(typeId) ?? (registry.isNote(typeId) ? 'body' : undefined);
  const fields = registry.fields(typeId);
  const isNote = registry.isNote(typeId);
  const takesFile = wantsBlob(Object.keys(fields));

  let plan = planCaptureForm(registry.types, typeId, {
    titleField,
    bodyField,
    toTitle: toTitleCase,
    alwaysShow: alwaysShownFields(typeId),
    reservedByForm: (name) => name.startsWith(FORM_FIELD_PREFIX),
  });

  const hidden = (field: PlannedField) =>
    (takesFile && BLOB_SUPPLIED_FIELDS.includes(field.name)) ||
    (isNote && field.name === titleField && field.name !== bodyField && !field.required);
  plan = {
    ...plan,
    primary: plan.primary.filter((f) => !hidden(f)),
    secondary: plan.secondary.filter((f) => !hidden(f)),
  };

  if (isNote) {
    // Everything but the body and what the type requires goes behind the toggle.
    const lead = (field: PlannedField) => field.name === bodyField || field.required;
    const all = [...plan.primary, ...plan.secondary];
    // A note is writable before the registry arrives, or when it cannot be read.
    const body: PlannedField = all.find((field) => field.name === bodyField) ?? {
      name: bodyField ?? 'body',
      kind: 'textarea',
      title: 'Body',
      required: true,
      rawType: 'string',
    };
    plan = {
      ...plan,
      known: true,
      primary: [body, ...plan.primary.filter((field) => lead(field) && field !== body)],
      secondary: all.filter((field) => !lead(field)),
    };
  }

  return {
    typeId,
    plan,
    isNote,
    takesFile,
    titleField,
    bodyField,
    hasUrlField: Object.values(fields).some((field) => field.type === 'url'),
  };
}

/** What a control holds before anyone touches it. */
export function initialValue(
  field: PlannedField,
  typeId: string,
  deviceZone: string,
): string | boolean | string[] | Date | null {
  const zone = captureDefaults(typeId, deviceZone)[field.name];
  if (zone !== undefined) return zone;
  switch (field.kind) {
    case 'checkbox':
      return false;
    case 'tagpicker':
    case 'thumbnail':
      return [];
    case 'datetime':
    case 'date':
      return null;
    case 'dropdown':
      // A required enum has no "not set" to start on.
      return field.required ? (field.enumValues?.[0] ?? '') : '';
    default:
      return '';
  }
}

/** Fields named like a time zone, which get the zone list rather than a text box. */
export const ZONE_FIELDS: ReadonlySet<string> = new Set(['timezone', 'end_timezone']);
