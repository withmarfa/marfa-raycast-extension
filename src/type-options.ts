import { ALL_TYPES_OPTION } from './constants';
import type { TypeRegistry } from './type-display';

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
 * Every type an instance holds, for the capture dropdown.
 *
 * **No seeded list leads it any more.** Four types used to come first because
 * those were the four with a hand-written form; every type now gets a form
 * built from its own schema, so there is nothing to privilege and the registry's
 * own label order is the whole answer.
 *
 * A selected type the registry has never heard of is appended, so a preference
 * pointing at something this server does not hold still shows what it is set to
 * rather than silently resetting.
 */
export function buildCaptureTypeOptions(
  registry: TypeRegistry,
  selectedType: string,
): TypeOption[] {
  const options: TypeOption[] = [];
  for (const schema of registry.selectableTypes()) {
    addOption(options, { value: schema.id, label: registry.label(schema.id) });
  }
  if (selectedType && !options.some((option) => option.value === selectedType)) {
    addOption(options, { value: selectedType, label: `${selectedType} (unverified)` });
  }
  return options;
}
