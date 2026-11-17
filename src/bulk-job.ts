import type { BulkJob } from './marfa';

/**
 * Emptying the Trash runs as a job on the server: the request answers at once
 * and the job is read until it finishes. Pure, with the reading and waiting
 * passed in, so the loop and what it reports are tested without a server.
 */

const FINISHED: ReadonlySet<string> = new Set(['completed', 'failed', 'canceled']);

function isFinished(job: BulkJob): boolean {
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

/** Said when the Trash no longer holds what the person confirmed and nothing was deleted. */
export const TRASH_CHANGED = {
  title: 'The Trash changed since it was counted',
  message: 'Nothing was deleted. Empty it again to confirm what is there now.',
} as const;

/**
 * What a finished, or still running, job says to the person. `confirmed` is
 * how many items they agreed to delete: the server leaves any of them that
 * left the Trash meanwhile, so the job can match fewer.
 */
export function describeJob(
  job: BulkJob,
  confirmed?: number,
): { ok: boolean; title: string; message: string } {
  const deleted = job.result?.succeeded ?? job.succeeded;
  const failed = job.result?.errored ?? job.errored;
  const counted = `${String(deleted)} deleted${failed > 0 ? `, ${String(failed)} could not be` : ''}`;
  switch (job.status) {
    case 'completed': {
      if (confirmed !== undefined && confirmed > 0 && job.matched === 0) {
        return { ok: false, ...TRASH_CHANGED };
      }
      const left = confirmed !== undefined ? confirmed - job.matched : 0;
      return {
        ok: failed === 0,
        title: failed === 0 ? 'Trash emptied' : 'Trash partly emptied',
        message:
          left > 0
            ? `${counted}; ${String(left)} of the ${String(confirmed)} counted had left the Trash already`
            : counted,
      };
    }
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
