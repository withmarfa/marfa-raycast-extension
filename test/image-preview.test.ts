import { describe, expect, it } from 'vitest';
import {
  IMAGE_PREVIEW_MAX_BYTES,
  previewFileName,
  previewUrl,
  withinPreviewLimit,
} from '../src/image-preview';

const HASH = 'c743dbc30d8049620c932f35fa6a2a949c0f86636a201c7b9ef9f3ba1f5012a4';

describe('previewFileName', () => {
  it('names the file by the hash and the media type', () => {
    expect(previewFileName(`sha256:${HASH}`, 'image/png')).toBe(`${HASH}.png`);
    expect(previewFileName(HASH, 'image/jpeg')).toBe(`${HASH}.jpg`);
  });

  it('falls back to a neutral extension for a media type it does not list', () => {
    expect(previewFileName(`sha256:${HASH}`, 'image/x-unknown')).toBe(`${HASH}.img`);
  });

  it('refuses a reference that is not a hash, since the name becomes a path', () => {
    expect(previewFileName('sha256:../../etc/passwd', 'image/png')).toBeNull();
    expect(previewFileName('h1', 'image/png')).toBeNull();
    expect(previewFileName(`sha256:${HASH.toUpperCase()}`, 'image/png')).toBeNull();
  });
});

describe('withinPreviewLimit', () => {
  it('tries an image of unknown size and refuses one past the limit', () => {
    expect(withinPreviewLimit(undefined)).toBe(true);
    expect(withinPreviewLimit(693970)).toBe(true);
    expect(withinPreviewLimit(IMAGE_PREVIEW_MAX_BYTES)).toBe(true);
    expect(withinPreviewLimit(IMAGE_PREVIEW_MAX_BYTES + 1)).toBe(false);
  });
});

describe('previewUrl', () => {
  it('makes a file address, with spaces and non-ASCII text encoded', () => {
    expect(previewUrl('/Users/a b/é/x.png')).toBe('file:///Users/a%20b/%C3%A9/x.png');
  });

  it('caps the height when asked', () => {
    expect(previewUrl('/tmp/x.png', 280)).toBe('file:///tmp/x.png?raycast-height=280');
  });
});
