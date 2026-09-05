import { readFile } from 'node:fs/promises';
import type { MarfaClient } from '@withmarfa/sdk';
import { bufferToUint8Array, mimeForFile } from './clipboard-source';

/**
 * A file's properties, for any type that says it holds one.
 *
 * **Offered by shape, not by a list of type ids.** `core.file` used to be a
 * hand-rolled branch in two commands and appeared in no shared helper, which
 * meant `core.file.image`, `core.file.audio` and anything an instance
 * registered with the same two fields got a JSON textarea instead. A type is
 * offered a file picker when it declares both of the fields a blob produces,
 * which covers those without naming any of them.
 *
 * The convention already exists in this repository: the detail view's image
 * resolver keys on the same pair.
 */
const BLOB_FIELDS = ['blob_ref', 'mime_type'] as const;

/** Whether a type's resolved fields say it holds an uploaded file. */
export function wantsBlob(fieldNames: Iterable<string>): boolean {
  const names = new Set(fieldNames);
  return BLOB_FIELDS.every((field) => names.has(field));
}

/** The field names a blob supplies. A form offering the picker hides these,
 *  rather than rendering two text boxes asking for a hash. */
export const BLOB_SUPPLIED_FIELDS: readonly string[] = BLOB_FIELDS;

/**
 * Upload a file and return the properties describing it.
 *
 * The mime type comes from the extension, which is what the clipboard command
 * already did, because the clipboard reports a path rather than a type.
 */
export async function uploadBlob(
  client: MarfaClient,
  path: string,
): Promise<Record<string, unknown>> {
  const mime = mimeForFile(path);
  const bytes = bufferToUint8Array(await readFile(path));
  // Destructured, because the upload answers with a wrapper rather than the
  // hash itself. A `Record<string, unknown>` return type accepts the wrapper
  // happily and the server would then hold an object where a reference belongs.
  const { hash } = await client.blobs.upload(bytes, mime);
  return { blob_ref: hash, mime_type: mime };
}
