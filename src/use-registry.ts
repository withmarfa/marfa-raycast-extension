import { useCachedPromise } from '@raycast/utils';
import { buildRegistry, type Registry } from './display';
import { listTypes } from './marfa';

/**
 * The server's type registry, cached between launches so a form or list
 * renders at once and is corrected when the read lands. Silent on failure:
 * the caller decides whether a missing registry is worth saying.
 */
export function useRegistry(): {
  registry: Registry;
  isLoading: boolean;
  error: Error | undefined;
  revalidate: () => void;
} {
  const types = useCachedPromise(listTypes, [], { onError: () => undefined });
  return {
    registry: buildRegistry(types.data),
    isLoading: types.isLoading,
    error: types.error,
    revalidate: types.revalidate,
  };
}
