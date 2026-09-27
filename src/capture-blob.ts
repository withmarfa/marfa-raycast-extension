/**
 * A type holds an uploaded file when it declares both fields an upload
 * produces. Offered by shape rather than by type id, so `core.file`, its
 * subtypes and any type an instance registers with the same pair get a file
 * picker. The detail view finds a stored image by the same pair.
 */
export const BLOB_SUPPLIED_FIELDS: readonly string[] = ['blob_ref', 'mime_type'];

export function wantsBlob(fieldNames: Iterable<string>): boolean {
  const names = new Set(fieldNames);
  return BLOB_SUPPLIED_FIELDS.every((field) => names.has(field));
}
