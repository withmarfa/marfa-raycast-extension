import { mkdir, readdir, rename, stat, unlink, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { IMAGE_PREVIEW_MAX_BYTES } from './image-preview';

/** A preview nobody opened for this long is deleted the next time one is written. */
const KEEP_MS = 7 * 24 * 60 * 60 * 1000;

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function pruneOld(dir: string): Promise<void> {
  const cutoff = Date.now() - KEEP_MS;
  for (const name of await readdir(dir)) {
    const path = join(dir, name);
    try {
      if ((await stat(path)).mtimeMs < cutoff) await unlink(path);
    } catch {
      // Another window removed it first, which is the same outcome.
    }
  }
}

/**
 * The path of a preview file, fetching the bytes only when the file is not
 * there yet. Null when the image is larger than the preview allows. The file
 * is written whole under another name first, so a half-written one is never
 * drawn.
 */
export async function storePreview(
  dir: string,
  name: string,
  download: () => Promise<ArrayBuffer>,
): Promise<string | null> {
  const path = join(dir, name);
  if (await exists(path)) {
    // Opening a preview keeps it from being pruned as unused.
    const now = new Date();
    await utimes(path, now, now).catch(() => undefined);
    return path;
  }
  const bytes = await download();
  if (bytes.byteLength > IMAGE_PREVIEW_MAX_BYTES) return null;
  await mkdir(dir, { recursive: true });
  const partial = `${path}.${String(process.pid)}.part`;
  await writeFile(partial, Buffer.from(bytes));
  await rename(partial, path);
  await pruneOld(dir).catch(() => undefined);
  return path;
}
