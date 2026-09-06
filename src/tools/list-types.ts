import { requiredFieldNames, resolveSchemaFields } from '../schema-fields';
import { toolClient } from './shared';

type Input = {
  /** Describe one type in full, as a full identifier such as `core.event`.
   *  Omit to list every type this instance holds. */
  type?: string;
};

/**
 * What types this Marfa instance holds, and what a given one requires.
 *
 * **Call this before capturing anything you are not certain about.** Instances
 * register their own types and integrations bring their own, so the set is not
 * knowable in advance, and capture-item refuses a payload missing a required
 * property.
 */
export default async function listTypes(input: Input) {
  const schemas = await toolClient().types.list();

  if (!input.type) {
    return schemas.map((schema) => ({
      type: schema.id,
      label: schema.label,
      description: schema.description,
    }));
  }

  const fields = resolveSchemaFields(schemas, input.type);
  const required = requiredFieldNames(schemas, input.type);
  const schema = schemas.find((candidate) => candidate.id === input.type);
  if (!schema) throw new Error(`This instance has no type called ${input.type}`);

  return {
    type: schema.id,
    label: schema.label,
    description: schema.description,
    fields: Object.entries(fields).map(([name, field]) => ({
      name,
      kind: field.type,
      description: field.description,
      required: required.has(name),
      oneOf: field.enum_values,
      each: field.items_type,
    })),
  };
}
