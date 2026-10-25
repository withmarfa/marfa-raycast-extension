import { environment } from '@raycast/api';
import { usePromise } from '@raycast/utils';
import { join } from 'node:path';
import { storePreview } from './image-file';
import { previewFileName, previewUrl, withinPreviewLimit } from './image-preview';
import type { ImageSource } from './item-view';
import { downloadBlob } from './marfa';

async function loadImage(
  kind: string,
  ref: string,
  mimeType: string,
  sizeBytes: number,
  height: number,
): Promise<string | null> {
  if (kind !== 'blob') return ref;
  const name = previewFileName(ref, mimeType);
  if (!name || !withinPreviewLimit(sizeBytes || undefined)) return null;
  const path = await storePreview(join(environment.supportPath, 'previews'), name, () =>
    downloadBlob(ref),
  );
  return path ? previewUrl(path, height || undefined) : null;
}

/**
 * The address a picture can be drawn from, once it is ready. A stored image is
 * fetched into a file only while `enabled`, so a list fetches the row in view
 * and not every row it holds. A failure leaves no address, and the page goes
 * without a picture rather than reporting one.
 */
export function useImageUrl(
  source: ImageSource | null,
  enabled: boolean,
  height?: number,
): { url: string | null; isLoading: boolean } {
  const image = usePromise(
    loadImage,
    [
      source?.kind ?? '',
      source ? (source.kind === 'blob' ? source.hash : source.url) : '',
      source?.kind === 'blob' ? source.mimeType : '',
      source?.kind === 'blob' ? (source.sizeBytes ?? 0) : 0,
      height ?? 0,
    ],
    { execute: enabled && source !== null, onError: () => undefined },
  );
  return { url: source ? (image.data ?? null) : null, isLoading: image.isLoading };
}
