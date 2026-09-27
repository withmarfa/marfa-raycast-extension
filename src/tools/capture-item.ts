import type { Tool } from '@raycast/api';
import { planCaptureForm } from '../capture-plan';
import {
  alwaysShownFields,
  buildCaptureProperties,
  captureDefaults,
  deviceTimeZone,
  valuesFromText,
} from '../capture-values';
import { buildRegistry, type Registry } from '../display';
import { describeFailure } from '../failure';
import { captureTier, createItem, listTypes, type Tier } from '../marfa';
import { toTitleCase } from '../schema-fields';

type Input = {
  /**
   * The full type identifier, such as `core.note`, `core.task` or `core.event`. Call list-types
   * first unless the person named a note, and to learn what a type requires.
   */
  type: string;
  /**
   * The item's properties, one entry per field the type declares. A required field must be
   * present, or this refuses and names it. A note needs only `body`, in markdown, its first line
   * naming it.
   */
  properties: {
    /** The field's name, exactly as the type declares it. */
    name: string;
    /**
     * The value as text. Dates and times in ISO 8601 (`2026-03-15` or `2026-03-15T14:00:00Z`), a
     * number as digits, a list one entry per line, an enum as one of the values list-types
     * reports. Anything unreadable is refused and named.
     */
    value: string;
  }[];
  /** Tags to file it under, only if the person asked for them. Lowercase, no `#`. */
  tags?: string[];
  /** `library` for what the person chose to keep, `feed` for volume. Omit to use their default. */
  tier?: 'library' | 'feed';
};

function cleanTags(tags: string[] | undefined): string[] {
  return [...new Set((tags ?? []).map((tag) => tag.replace(/^#/, '').trim()).filter(Boolean))];
}

/**
 * The same plan and validator the capture form uses, so the tool and a
 * person are refused for the same reasons, with the event's time zone
 * defaulted to the device's as the form defaults it.
 */
function buildProperties(registry: Registry, input: Input): Record<string, unknown> {
  if (!registry.type(input.type)) {
    throw new Error(
      `This server has no type called ${input.type}. Call list-types to see what it holds.`,
    );
  }
  // Every declared field, with none reserved: a tool renders no controls of its own.
  const plan = planCaptureForm(registry.types, input.type, {
    titleField: registry.titleField(input.type),
    bodyField: registry.bodyField(input.type),
    toTitle: toTitleCase,
    alwaysShow: alwaysShownFields(input.type),
  });
  const properties = Array.isArray(input.properties) ? input.properties : [];
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
  return built.properties;
}

export const confirmation: Tool.Confirmation<Input> = async (input) => {
  const registry = buildRegistry(await listTypes());
  const required = registry.required(input.type);
  const properties = Array.isArray(input.properties) ? input.properties : [];
  const label = registry.label(input.type);
  return {
    message: `Save this ${label.toLowerCase()} to Marfa?`,
    info: [
      { name: 'Type', value: `${label} (${input.type})` },
      ...properties.map((entry) => ({
        name: required.has(entry.name)
          ? `${toTitleCase(entry.name)} (required)`
          : toTitleCase(entry.name),
        value: entry.value,
      })),
      { name: 'Tags', value: cleanTags(input.tags).join(', ') || undefined },
      { name: 'Tier', value: input.tier ?? captureTier() },
    ],
  };
};

/** Writes an item of any type the server holds, exactly as the capture form does. */
export default async function tool(input: Input) {
  let registry: Registry;
  try {
    registry = buildRegistry(await listTypes());
  } catch (error) {
    const failure = describeFailure(error);
    throw new Error(`${failure.title}. ${failure.message}`);
  }
  const properties = buildProperties(registry, input);
  try {
    const { item, metadata } = await createItem({
      type: input.type,
      properties,
      tags: cleanTags(input.tags),
      tier: input.tier as Tier | undefined,
    });
    return {
      id: item.id,
      type: item.type,
      title: registry.titleOf(item),
      tier: item.tier,
      properties: item.properties,
      tags: metadata.tags,
    };
  } catch (error) {
    const failure = describeFailure(error);
    throw new Error(`${failure.title}. ${failure.message}`);
  }
}
