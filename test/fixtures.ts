import type { TypeDefinition } from '../src/marfa';

/** A type definition stating only what a test is about. */
export function schema(id: string, overrides: Partial<TypeDefinition> = {}): TypeDefinition {
  return { id, version: 1, fields: {}, ...overrides };
}
