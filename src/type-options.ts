import type { TypeSchema } from '@withmarfa/sdk';
import { ALL_TYPES_OPTION, CAPTURE_TYPES } from './constants';
import type { TypeRegistry } from './type-display';
import { requiredFieldNames, resolveSchemaFields } from './schema-fields';

export interface TypeOption {
  value: string;
  label: string;
}

function addOption(options: TypeOption[], option: TypeOption): void {
  if (!options.some((existing) => existing.value === option.value)) {
    options.push(option);
  }
}

/**
 * Filter options are whatever the instance actually holds, in the
 * registry's own label order. There is no seeded list of core types: the
 * server returns those too, and a second copy could only disagree with it,
 * including on a self-hosted instance that registered something else
 * entirely.
 */
export function buildTypeFilterOptions(registry: TypeRegistry): TypeOption[] {
  const options: TypeOption[] = [{ ...ALL_TYPES_OPTION }];
  for (const schema of registry.selectableTypes()) {
    addOption(options, { value: schema.id, label: registry.label(schema.id) });
  }
  return options;
}

/**
 * Capture options lead with the types Quick Capture has native fields for,
 * then everything else the instance knows. The currently selected type is
 * appended when the registry has never heard of it, so a preference
 * pointing at a type this server does not hold still shows what it is set
 * to rather than silently resetting.
 */
export function buildCaptureTypeOptions(
  registry: TypeRegistry,
  selectedType: string,
): TypeOption[] {
  const options: TypeOption[] = CAPTURE_TYPES.map((type) => ({
    value: type.value,
    label: registry.schema(type.value) ? registry.label(type.value) : type.label,
  }));

  for (const schema of registry.selectableTypes()) {
    addOption(options, { value: schema.id, label: registry.label(schema.id) });
  }

  if (!options.some((option) => option.value === selectedType)) {
    addOption(options, { value: selectedType, label: `${selectedType} (unverified)` });
  }

  return options;
}

export function findSchema(
  schemas: TypeSchema[] | undefined,
  type: string,
): TypeSchema | undefined {
  return schemas?.find((schema) => schema.id === type);
}

export function schemaSummary(schemas: TypeSchema[] | undefined, type: string): string {
  const schema = findSchema(schemas, type);
  if (!schema) {
    return `No schema was available for ${type}. Submit a JSON object and Marfa will validate it.`;
  }

  // Both resolved through the type's ancestry, so a subtype that inherits its
  // parent's fields describes them rather than appearing to have none.
  const fields = Object.entries(resolveSchemaFields(schemas, type));
  const requiredNames = [...requiredFieldNames(schemas, type)];
  const required = requiredNames.length ? requiredNames.join(', ') : 'none';
  const fieldList =
    fields.length > 0
      ? fields
          .map(([name, definition]) => {
            const typeName =
              typeof definition === 'object' && definition && 'type' in definition
                ? String(definition.type)
                : 'unknown';
            return `${name}: ${typeName}`;
          })
          .join(', ')
      : 'none';

  return `Required: ${required}\nFields: ${fieldList}`;
}
