import type { BulkJob } from './marfa';

/**
 * Emptying the Trash runs as a job on the server: the request answers at once
 * and the job is read until it finishes. Pure, with the reading and waiting
 * passed in, so the loop and what it reports are tested without a server.
 */

const FINISHED: ReadonlySet<string> = new Set(['completed', 'failed', 'canceled']);

export function isFinished(job: BulkJob): boolean {
  return FINISHED.has(job.status);
}

/** Follows a job until it finishes, or answers it as it stands when the wait runs out. */
export async function followJob(
  job: BulkJob,
  read: (id: string) => Promise<BulkJob>,
  wait: (ms: number) => Promise<void>,
  options: { interval?: number; attempts?: number } = {},
): Promise<BulkJob> {
  let current = job;
  for (let attempt = 0; !isFinished(current) && attempt < (options.attempts ?? 120); attempt++) {
    await wait(options.interval ?? 500);
    current = await read(current.id);
  }
  return current;
}

/** What a finished, or still running, job says to the person. */
export function describeJob(job: BulkJob): { ok: boolean; title: string; message: string } {
  const deleted = job.result?.succeeded ?? job.succeeded;
  const failed = job.result?.errored ?? job.errored;
  const counted = `${String(deleted)} deleted${failed > 0 ? `, ${String(failed)} could not be` : ''}`;
  switch (job.status) {
    case 'completed':
      return {
        ok: failed === 0,
        title: failed === 0 ? 'Trash emptied' : 'Trash partly emptied',
        message: counted,
      };
    case 'failed':
      return { ok: false, title: 'Emptying the Trash failed', message: job.error ?? counted };
    case 'canceled':
      return { ok: false, title: 'Emptying the Trash was stopped', message: counted };
    default:
      return {
        ok: true,
        title: 'Still emptying the Trash',
        message: `${String(job.processed)} of ${String(job.matched)} done; the server carries on without Raycast`,
      };
  }
}
