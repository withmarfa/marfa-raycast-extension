import { describe, expect, it } from 'vitest';
import { checkThumbnail, THUMBNAIL_MAX_BYTES, thumbnailFromBytes } from '../src/thumbnail';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16]);
const WEBP = new Uint8Array(
  [...'RIFF']
    .map((c) => c.charCodeAt(0))
    .concat(
      [0, 0, 0, 0],
      [...'WEBP'].map((c) => c.charCodeAt(0)),
    ),
);

describe('a thumbnail from a file', () => {
  it('is a data URI labelled by the format its bytes begin with', () => {
    expect(thumbnailFromBytes(PNG)).toEqual({
      value: `data:image/png;base64,${Buffer.from(PNG).toString('base64')}`,
    });
    expect(thumbnailFromBytes(JPEG)).toMatchObject({
      value: expect.stringMatching(/^data:image\/jpeg;base64,/),
    });
    expect(thumbnailFromBytes(WEBP)).toMatchObject({
      value: expect.stringMatching(/^data:image\/webp;base64,/),
    });
  });

  it('refuses another format, and an image past 16 KB', () => {
    expect(thumbnailFromBytes(new TextEncoder().encode('GIF89a'))).toEqual({
      error: 'A thumbnail must be a PNG, JPEG or WebP image',
    });
    const big = new Uint8Array(THUMBNAIL_MAX_BYTES + 1);
    big.set(PNG);
    expect(thumbnailFromBytes(big)).toEqual({
      error: 'A thumbnail must be at most 16 KB; this image is 17 KB',
    });
  });
});

describe('a thumbnail given as text', () => {
  const uri = `data:image/png;base64,${Buffer.from(PNG).toString('base64')}`;

  it('takes a PNG data URI whose bytes are a PNG', () => {
    expect(checkThumbnail(uri)).toEqual({ value: uri });
  });

  it('refuses a URL, a label that lies about the bytes, and base64 out of its canonical form', () => {
    expect(checkThumbnail('https://example.org/a.png')).toHaveProperty('error');
    expect(checkThumbnail(uri.replace('image/png', 'image/jpeg'))).toEqual({
      error: 'A thumbnail labelled image/jpeg must hold that format’s bytes',
    });
    // The last byte is zero, so its group ends `AA==`; `AB==` decodes to the same byte but is not canonical.
    const loose = `data:image/png;base64,${Buffer.from(PNG.slice(0, 10)).toString('base64').replace(/A==$/, 'B==')}`;
    expect(checkThumbnail(loose)).toEqual({
      error: 'A thumbnail’s base64 is not in its canonical form',
    });
  });
});
