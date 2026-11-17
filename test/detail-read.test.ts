import { describe, expect, it } from 'vitest';
import { readForDetail } from '../src/detail-read';
import { MarfaRequestError } from '../src/failure';
import type { Entry } from '../src/marfa';

const entry = { item: { id: 'i1', state: 'active' }, metadata: { tags: [] } } as unknown as Entry;

function refusal(status: number, code: string) {
  return new MarfaRequestError(status, { error: { code, message: 'refused' } });
}

describe('reading an item for its detail', () => {
  it('asks for the item in any state, so a restored or trashed one is still found', async () => {
    const asked: (string | undefined)[] = [];
    const read = await readForDetail('i1', (_id, state) => {
      asked.push(state);
      return Promise.resolve(entry);
    });
    expect(asked).toEqual(['any']);
    expect(read).toEqual({ kind: 'present', entry });
  });

  it('says the item is gone when the server no longer has it', async () => {
    const read = await readForDetail('i1', () => Promise.reject(refusal(404, 'item_not_found')));
    expect(read).toEqual({ kind: 'gone' });
  });

  it('lets any other failure through', async () => {
    await expect(
      readForDetail('i1', () => Promise.reject(refusal(403, 'forbidden'))),
    ).rejects.toBeInstanceOf(MarfaRequestError);
    await expect(readForDetail('i1', () => Promise.reject(new Error('boom')))).rejects.toThrow(
      'boom',
    );
  });
});
