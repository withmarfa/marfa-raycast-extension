import { pathToFileURL } from 'node:url';

/**
 * How a stored image reaches the page. Raycast draws a markdown image from a
 * file or a web address, and an inline data URI of a real photo stalls the
 * window, so the bytes go to a file named by their hash and the page names
 * that file. Pure: writing the file is `image-file.ts`'s job.
 */

/** The largest stored image the view fetches to draw. */
export const IMAGE_PREVIEW_MAX_BYTES = 25 * 1024 * 1024;

const EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/heic': 'heic',
  'image/bmp': 'bmp',
  'image/tiff': 'tiff',
};

/**
 * The file a blob's preview is kept in, named by its hash so the same image
 * is fetched once. Null for a reference that is not a hash, because the name
 * becomes a path.
 */
export function previewFileName(blobRef: string, mimeType: string): string | null {
  const hash = blobRef.includes(':') ? blobRef.slice(blobRef.indexOf(':') + 1) : blobRef;
  if (!/^[0-9a-f]{64}$/.test(hash)) return null;
  return `${hash}.${EXTENSIONS[mimeType] ?? 'img'}`;
}

/** Whether an image of this size is worth fetching; an unknown size is tried. */
export function withinPreviewLimit(sizeBytes: number | undefined): boolean {
  return sizeBytes === undefined || sizeBytes <= IMAGE_PREVIEW_MAX_BYTES;
}

/** The address a markdown image names for a file, optionally capped in height. */
export function previewUrl(path: string, height?: number): string {
  const url = pathToFileURL(path).href;
  return height ? `${url}?raycast-height=${String(height)}` : url;
}
