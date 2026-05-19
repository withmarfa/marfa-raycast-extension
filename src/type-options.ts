import type { TypeSchema } from '@mymehq/sdk';
import { ALL_TYPES, CAPTURE_TYPES } from './constants';
import type { TypeSchemaWithRequired } from './capture-utils';

export interface TypeOption {
  value: string;
  label: string;
}

function isSystemType(id: string): boolean {
  return id.startsWith('system.');
}

function optionLabel(schema: TypeSchema): string {
  return schema.label ? `${schema.label} · ${schema.id}` : schema.id;
}

function addOption(options: TypeOption[], option: TypeOption): void {
  if (!options.some((existing) => existing.value === option.value)) {
    options.push(option);
  }
}

export function buildTypeFilterOptions(schemas: TypeSchema[] | undefined): TypeOption[] {
  const options: TypeOption[] = [...ALL_TYPES];
  for (const schema of [...(schemas ?? [])].sort((a, b) => a.id.localeCompare(b.id))) {
    if (isSystemType(schema.id)) continue;
    addOption(options, { value: schema.id, label: optionLabel(schema) });
  }
  return options;
}

export function buildCaptureTypeOptions(
  schemas: TypeSchema[] | undefined,
  selectedType: string,
): TypeOption[] {
  const options: TypeOption[] = [...CAPTURE_TYPES];
  const sorted = [...(schemas ?? [])].sort((a, b) => a.id.localeCompare(b.id));

  for (const schema of sorted) {
    if (isSystemType(schema.id)) continue;
    addOption(options, { value: schema.id, label: optionLabel(schema) });
  }

  if (!options.some((option) => option.value === selectedType)) {
    addOption(options, { value: selectedType, label: `${selectedType} (unverified)` });
  }

  return options;
}

export function findSchema(
  schemas: TypeSchema[] | undefined,
  type: string,
): TypeSchemaWithRequired | undefined {
  return schemas?.find((schema) => schema.id === type) as TypeSchemaWithRequired | undefined;
}

export function schemaSummary(schema: TypeSchemaWithRequired | undefined, type: string): string {
  if (!schema) {
    return `No schema was available for ${type}. Submit a JSON object and Myme will validate it.`;
  }

  const fields = Object.entries(schema.fields ?? {});
  const required = schema.required?.length ? schema.required.join(', ') : 'none';
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
