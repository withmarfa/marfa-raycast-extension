import { MAX_RESOLUTION_DEPTH } from '@withmarfa/shared';
import type { FieldDefinition } from '@withmarfa/shared';
import type { TypeSchema } from '@withmarfa/sdk';

/**
 * A type's fields and its required ones, resolved the way the platform means
 * them rather than the way a single schema object happens to spell them.
 *
 * **Do not reach for `getResolvedFields` or `validateProperties` from
 * `@withmarfa/shared` to do this.** They resolve against the vocabulary
 * compiled into the package and cannot know what a given instance registered,
 * which is the same reason this repository already refuses `getTypeSchema` and
 * `isSubtypeOf`. That rule reads as the opposite of deferring scope coverage to
 * the platform, and the distinction is the point: scope grammar is
 * instance-independent, and the type registry is not.
 *
 * What is copied from those helpers is their *rule*, which is checked against
 * them: root-first merge so a subtype's declaration wins whole, a cycle guard
 * that detects a repeat rather than counting to a small number, and the
 * platform's own depth bound.
 *
 * One deliberate difference. The platform resolves `attachments` and `links`
 * onto every type from a base it holds in code. Those are not in any fetched
 * schema, and synthesizing them here would be a second copy of platform state
 * going stale. Both are optional, so nothing is refused for their absence.
 */

/** Schemas as the server sends them, plus the shape a server that does not
 *  normalize its input may still emit. */
type SchemaWithLegacyRequired = TypeSchema & { required?: string[] };

/**
 * The chain root-first, so a merge lets the nearest declaration win whole.
 *
 * **A repeat, not a count.** Bounding a walk by a small number silently
 * truncates a legal chain, which is the same failure this module exists to fix
 * pointed at a different input: fields that are never seen are required fields
 * that are never enforced. A `seen` set ends a cycle exactly, and the
 * platform's own bound is what stops a pathological chain.
 */
function ancestry(schemas: readonly TypeSchema[], typeId: string): TypeSchema[] {
  const byId = new Map(schemas.map((schema) => [schema.id, schema]));
  const chain: TypeSchema[] = [];
  const seen = new Set<string>();

  let current = byId.get(typeId);
  while (current && !seen.has(current.id) && chain.length < MAX_RESOLUTION_DEPTH) {
    seen.add(current.id);
    chain.push(current);
    current = current.parent ? byId.get(current.parent) : undefined;
  }

  return chain.reverse();
}

/**
 * One schema's fields with its required-ness normalized onto them.
 *
 * **Required-ness is declared two ways and reading one of them is half a fix.**
 * The platform's validator accepts a top-level `["title"]` array and a per-field
 * `required: true`, says so in its own rejection hint, and normalizes the first
 * into the second at registration. That is why a schema from a current server
 * carries only the flags, and why reading only the array found nothing at all:
 * every type reported requiring nothing and no capture was refused before it
 * reached the network. Normalizing here, per schema and before the merge, is
 * what lets a subtype override an inherited field whole.
 */
function normalizedFields(schema: TypeSchema): Record<string, FieldDefinition> {
  const legacy = (schema as SchemaWithLegacyRequired).required ?? [];
  const fields = { ...(schema.fields ?? {}) };
  for (const name of legacy) {
    const field = fields[name];
    if (field) fields[name] = { ...field, required: true };
  }
  return fields;
}

/**
 * Every field a type carries, including the ones it inherits.
 *
 * **Inheritance is not optional here, however self-contained the shipped types
 * look.** The shipped subtypes re-declare their parents' fields in full, which
 * is an authoring habit rather than a guarantee. A third party registering a
 * subtype with two new fields is the ordinary case, and reading its own `fields`
 * alone would describe that type by two controls.
 *
 * A subtype's declaration replaces its ancestor's rather than merging into it,
 * which is what lets one make an inherited field optional by re-declaring it
 * without the flag. The platform answers the same way.
 */
export function resolveSchemaFields(
  schemas: readonly TypeSchema[] | undefined,
  typeId: string,
): Record<string, FieldDefinition> {
  if (!schemas) return {};
  return Object.assign({}, ...ancestry(schemas, typeId).map(normalizedFields)) as Record<
    string,
    FieldDefinition
  >;
}

/**
 * The fields a type will not accept a write without.
 *
 * Read off the resolved definitions rather than accumulated across the chain,
 * so the answer cannot disagree with the fields it is describing. Accumulating
 * makes an inherited requirement impossible to lift, and the form would then
 * refuse a capture the server accepts.
 */
export function requiredFieldNames(
  schemas: readonly TypeSchema[] | undefined,
  typeId: string,
): Set<string> {
  return new Set(
    Object.entries(resolveSchemaFields(schemas, typeId))
      .filter(([, field]) => field.required)
      .map(([name]) => name),
  );
}
