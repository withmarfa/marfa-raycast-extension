import { buildRegistry } from '../display';
import { describeFailure } from '../failure';
import { listTypes } from '../marfa';

type Input = {
  /**
   * One type to describe in full, as a full identifier such as `core.event`. Omit to list every
   * type the server holds.
   */
  type?: string;
};

/**
 * The types this server holds, or one type's fields with what each takes and
 * whether it is required, inherited fields included. Servers register their
 * own types, so the set cannot be known in advance.
 */
export default async function tool(input: Input) {
  let registry;
  try {
    registry = buildRegistry(await listTypes());
  } catch (error) {
    const failure = describeFailure(error);
    throw new Error(`${failure.title}. ${failure.message}`);
  }

  if (!input.type) {
    return registry.filterable().map((type) => ({
      type: type.id,
      label: registry.label(type.id),
      description: type.description,
      parent: type.parent,
    }));
  }

  const type = registry.type(input.type);
  if (!type)
    throw new Error(
      `This server has no type called ${input.type}. Call list-types with no type to see what it holds.`,
    );
  return {
    type: type.id,
    label: registry.label(type.id),
    description: type.description,
    parent: type.parent,
    titleField: registry.titleField(type.id),
    bodyField: registry.bodyField(type.id),
    fields: Object.entries(registry.fields(type.id)).map(([name, field]) => ({
      name,
      kind: field.type,
      description: field.description,
      required: field.required === true,
      oneOf: field.enum_values,
      each: field.items_type,
      format: field.format,
    })),
  };
}
