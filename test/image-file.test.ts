import { mkdtemp, readFile, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { storePreview } from '../src/image-file';
import { IMAGE_PREVIEW_MAX_BYTES } from '../src/image-preview';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'marfa-preview-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const bytes = (text: string) => new TextEncoder().encode(text).buffer as ArrayBuffer;

describe('storePreview', () => {
  it('writes the bytes once and answers the same path without fetching again', async () => {
    const download = vi.fn(() => Promise.resolve(bytes('png bytes')));
    const first = await storePreview(join(dir, 'previews'), 'a.png', download);
    const second = await storePreview(join(dir, 'previews'), 'a.png', download);
    expect(second).toBe(first);
    expect(download).toHaveBeenCalledTimes(1);
    expect(await readFile(first!, 'utf8')).toBe('png bytes');
  });

  it('leaves no half-written file behind', async () => {
    await storePreview(join(dir, 'previews'), 'a.png', () => Promise.resolve(bytes('x')));
    expect(await readdir(join(dir, 'previews'))).toEqual(['a.png']);
  });

  it('writes nothing for an image past the limit', async () => {
    const big = new ArrayBuffer(IMAGE_PREVIEW_MAX_BYTES + 1);
    expect(
      await storePreview(join(dir, 'previews'), 'big.png', () => Promise.resolve(big)),
    ).toBeNull();
    await expect(readdir(join(dir, 'previews'))).rejects.toThrow();
  });

  it('does not write a file when the download fails', async () => {
    await expect(
      storePreview(join(dir, 'previews'), 'a.png', () => Promise.reject(new Error('refused'))),
    ).rejects.toThrow('refused');
  });

  it('deletes previews nobody opened for a week when it writes a new one', async () => {
    const previews = join(dir, 'previews');
    await storePreview(previews, 'old.png', () => Promise.resolve(bytes('old')));
    const longAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    await utimes(join(previews, 'old.png'), longAgo, longAgo);
    await writeFile(join(previews, 'recent.png'), 'recent');
    await storePreview(previews, 'new.png', () => Promise.resolve(bytes('new')));
    expect((await readdir(previews)).sort()).toEqual(['new.png', 'recent.png']);
  });
});
