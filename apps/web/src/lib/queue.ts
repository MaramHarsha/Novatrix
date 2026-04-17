import { Queue } from 'bullmq';
import IORedis from 'ioredis';

let connection: IORedis | null = null;
let queue: Queue | null = null;

/** BullMQ queue when REDIS_URL is set (Phase 3 scheduling / long jobs). */
export function getAssessmentQueue(): Queue | null {
  const url = process.env.REDIS_URL;
  if (!url) return null;
  connection ??= new IORedis(url, { maxRetriesPerRequest: null });
  queue ??= new Queue('pentest-assessments', { connection });
  return queue;
}

export async function enqueuePostRun(runId: string): Promise<void> {
  const q = getAssessmentQueue();
  if (!q) return;
  await q.add(
    'post-run',
    { runId },
    { removeOnComplete: 100, removeOnFail: 50 }
  );
}
