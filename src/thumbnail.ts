/**
 * A thumbnail field's value: a PNG, JPEG or WebP data URI of canonical base64,
 * at most 16 KiB decoded and beginning with its format's signature. The server
 * refuses anything else, so it is checked here first, where the refusal can
 * name the file.
 */

export const THUMBNAIL_MAX_BYTES = 16 * 1024;

const SIGNATURES: { mime: string; matches: (bytes: Uint8Array) => boolean }[] = [
  {
    mime: 'image/png',
    matches: (b) => [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((v, i) => b[i] === v),
  },
  { mime: 'image/jpeg', matches: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  {
    mime: 'image/webp',
    matches: (b) =>
      String.fromCharCode(...b.slice(0, 4)) === 'RIFF' &&
      String.fromCharCode(...b.slice(8, 12)) === 'WEBP',
  },
];

/** The data URI for an image's bytes, or why they cannot be a thumbnail. */
export function thumbnailFromBytes(bytes: Uint8Array): { value: string } | { error: string } {
  const format = SIGNATURES.find((signature) => signature.matches(bytes));
  if (!format) return { error: 'A thumbnail must be a PNG, JPEG or WebP image' };
  if (bytes.byteLength > THUMBNAIL_MAX_BYTES) {
    return {
      error: `A thumbnail must be at most 16 KB; this image is ${String(Math.ceil(bytes.byteLength / 1024))} KB`,
    };
  }
  return { value: `data:${format.mime};base64,${Buffer.from(bytes).toString('base64')}` };
}

/** A data URI as supplied in text, checked the same way. */
export function checkThumbnail(value: string): { value: string } | { error: string } {
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]*={0,2})$/.exec(value);
  if (!match) return { error: 'A thumbnail must be a PNG, JPEG or WebP data URI in base64' };
  const bytes = Buffer.from(match[2], 'base64');
  if (bytes.toString('base64') !== match[2]) {
    return { error: 'A thumbnail’s base64 is not in its canonical form' };
  }
  const read = thumbnailFromBytes(new Uint8Array(bytes));
  if ('error' in read) return read;
  if (!read.value.startsWith(`data:${match[1]};`)) {
    return { error: `A thumbnail labelled ${match[1]} must hold that format’s bytes` };
  }
  return { value };
}
