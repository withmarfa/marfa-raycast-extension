import { describe, expect, it } from 'vitest';
import { describeJob, followJob } from '../src/bulk-job';
import type { BulkJob } from '../src/marfa';

const job = (over: Partial<BulkJob>): BulkJob => ({
  id: 'j1',
  action: 'purge',
  status: 'queued',
  matched: 3,
  processed: 0,
  succeeded: 0,
  errored: 0,
  ...over,
});

describe('following the job', () => {
  it('reads it until it finishes', async () => {
    const answers = [
      job({ status: 'in_progress', processed: 1 }),
      job({ status: 'completed', processed: 3, succeeded: 3 }),
    ];
    const waits: number[] = [];
    const done = await followJob(
      job({}),
      async () => answers.shift()!,
      async (ms) => void waits.push(ms),
    );
    expect(done.status).toBe('completed');
    expect(waits).toEqual([500, 500]);
  });

  it('stops waiting after its attempts, answering the job as it stands', async () => {
    const running = job({ status: 'in_progress', processed: 2 });
    const done = await followJob(
      job({}),
      async () => running,
      async () => undefined,
      { attempts: 3 },
    );
    expect(done).toBe(running);
    expect(describeJob(done)).toEqual({
      ok: true,
      title: 'Still emptying the Trash',
      message: '2 of 3 done; the server carries on without Raycast',
    });
  });

  it('reads nothing when the job had already finished', async () => {
    const finished = job({ status: 'completed', succeeded: 3 });
    expect(
      await followJob(
        finished,
        async () => {
          throw new Error('read');
        },
        async () => undefined,
      ),
    ).toBe(finished);
  });
});

describe('what it says', () => {
  it('counts from the result where the job carries one', () => {
    expect(
      describeJob(
        job({
          status: 'completed',
          succeeded: 0,
          result: { action: 'purge', matched: 3, succeeded: 3, errored: 0, dry_run: false },
        }),
      ),
    ).toEqual({ ok: true, title: 'Trash emptied', message: '3 deleted' });
  });

  it('says when some could not be deleted, and why a job failed', () => {
    expect(describeJob(job({ status: 'completed', succeeded: 2, errored: 1 }))).toEqual({
      ok: false,
      title: 'Trash partly emptied',
      message: '2 deleted, 1 could not be',
    });
    expect(describeJob(job({ status: 'failed', error: 'disk full' }))).toMatchObject({
      ok: false,
      message: 'disk full',
    });
  });
});
