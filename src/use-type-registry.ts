import { showFailureToast, useCachedPromise } from '@raycast/utils';
import { useMemo } from 'react';
import type { TypeSchema } from '@withmarfa/sdk';
import { getClient } from './client';
import { buildTypeRegistry, type TypeRegistry } from './type-display';

/**
 * The instance's type registry, and a display resolver built over it.
 *
 * Every view that renders an item needs this, and each used to fetch the
 * schema list itself. One hook keeps a single cache key, so opening Browse
 * after Search does not re-fetch, and a view can render from the cached
 * list on launch while the refresh is in flight.
 *
 * A failed fetch is reported but not fatal: `buildTypeRegistry` over an
 * empty list still resolves a legible label, icon and title for every item,
 * so the list renders rather than showing nothing.
 */
export function useTypeRegistry(): {
  registry: TypeRegistry;
  schemas: TypeSchema[] | undefined;
  isLoading: boolean;
} {
  const { data, isLoading } = useCachedPromise(
    async () => {
      const client = getClient();
      return client.types.list();
    },
    [],
    {
      onError: async (err) => {
        await showFailureToast(err, { title: 'Failed to load the type registry' });
      },
    },
  );

  const registry = useMemo(() => buildTypeRegistry(data), [data]);

  return { registry, schemas: data, isLoading };
}
