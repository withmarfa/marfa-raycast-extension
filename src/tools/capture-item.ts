import type { Tool } from '@raycast/api';
import type { CreateItemInput } from '@withmarfa/sdk';
import { planCaptureForm } from '../capture-plan';
import { buildCaptureProperties, captureDefaults, valuesFromText } from '../capture-values';
import { deviceTimeZone } from '../capture-utils';
import { toTitleCase } from '../helpers';
import { requiredFieldNames } from '../schema-fields';
import { toolClient } from './shared';

type Input = {
  /** The full type identifier, such as `core.note` or `readwise.highlight`.
   *  Call list-types first if you are not certain the instance has it, or what
   *  it requires. */
  type: string;
  /** The item's properties, one entry per field the type declares. A required
   *  field must be present or this refuses and names it. */
  properties: {
    /** The field's name, exactly as the type declares it. */
    name: string;
    /** The value as text, parsed against what the field declares. Dates and
     *  times must be ISO 8601 (`2026-03-15` or `2026-03-15T14:00:00Z`); a
     *  number as digits; a list as one entry per line; an enum as one of the
     *  values `list-types` reports for that field. Anything unreadable is
     *  refused and named rather than dropped. */
    value: string;
  }[];
  /** Tags to attach. These are the person's own labels, not a property of the
   *  type. */
  tags?: string[];
  /** `library` is curated and kept, `feed` is high-volume capture. Defaults to
   *  library, which is what a deliberate capture means. */
  tier?: 'library' | 'feed';
};

/**
 * Capture a new item.
 *
 * **This writes.** It refuses a payload missing something the type requires,
 * rather than letting the server reject it, so a refusal here names the field
 * and you can ask for it.
 */
export default async function captureItem(input: Input) {
  // Same defensiveness as the confirmation, and it has to be here too: guarding
  // only the confirmation moved the crash rather than removing it, from before
  // the prompt to after the person approved it. Missing everything reaches the
  // validator as an empty payload and comes back naming the required fields,
  // which is a refusal that can be acted on.
  const properties = Array.isArray(input.properties) ? input.properties : [];
  const client = toolClient();
  const schemas = await client.types.list();
  const schema = schemas.find((candidate) => candidate.id === input.type);
  if (!schema) {
    throw new Error(
      `This instance has no type called ${input.type}. Call list-types to see what it holds.`,
    );
  }

  // The same plan the form builds, so a tool and a person are refused for the
  // same reasons. No `reservedByForm`: that exists because the form renders
  // controls of its own and two of them cannot share an id, and a tool renders
  // nothing, so a type declaring a field named `__extra` is capturable here.
  //
  // The plan is passed whole. Both `valuesFromText` and `buildCaptureProperties`
  // read primary and secondary together, since the split is about how much of a
  // form to show at once and a caller supplying values is not looking at one.
  const plan = planCaptureForm(schemas, input.type, {
    titleField: schema.display_hints?.title_field,
    bodyField: schema.display_hints?.body_field,
    toTitle: toTitleCase,
  });

  // The same defaults the form applies. Without them an event captured by
  // asking carries no timezone, which that type defines as advancing in UTC,
  // while the same event captured through the form carries the device's.
  // Blank counts as absent, matching the validator: a supplied empty string
  // would otherwise suppress the default and produce exactly that event.
  const supplied = new Set(
    properties.filter((entry) => entry.value.trim() !== '').map((entry) => entry.name),
  );
  const defaults = Object.entries(captureDefaults(input.type, deviceTimeZone()))
    .filter(([name]) => !supplied.has(name))
    .map(([name, value]) => ({ name, value }));

  const built = buildCaptureProperties(
    plan,
    input.type,
    valuesFromText(plan, [...properties, ...defaults]),
  );
  if ('errors' in built) {
    const detail = Object.entries(built.errors)
      .map(([field, message]) => `${field}: ${message}`)
      .join('; ');
    throw new Error(`Cannot capture: ${detail}`);
  }

  const payload: CreateItemInput = {
    type: input.type,
    properties: built.properties,
    tags: input.tags?.length ? input.tags : undefined,
    tier: input.tier ?? 'library',
  };
  const item = await client.items.create(payload);
  return { id: item.id, type: item.type, properties: item.properties };
}

/**
 * Asked before anything is written, with the same input the tool will receive.
 *
 * The type is named by its label rather than its identifier, because a person
 * approving a capture should not have to know that `readwise.highlight` is what
 * they call a highlight.
 */
export const confirmation: Tool.Confirmation<Input> = async (input) => {
  const schemas = await toolClient().types.list();
  const schema = schemas.find((candidate) => candidate.id === input.type);
  const required = requiredFieldNames(schemas, input.type);

  // Defensive about its own input. A model can omit a required argument, and a
  // confirmation that throws denies the person the prompt and the tool the
  // chance to explain what was missing.
  const properties = Array.isArray(input.properties) ? input.properties : [];

  return {
    message: `Capture a new ${schema?.label ?? input.type}?`,
    info: [
      { name: 'Type', value: schema?.label ? `${schema.label} (${input.type})` : input.type },
      ...properties.map((entry) => ({
        name: required.has(entry.name)
          ? `${toTitleCase(entry.name)} (required)`
          : toTitleCase(entry.name),
        value: entry.value,
      })),
      ...(input.tags?.length ? [{ name: 'Tags', value: input.tags.join(', ') }] : []),
      { name: 'Tier', value: input.tier ?? 'library' },
    ],
  };
};
