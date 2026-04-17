/**
 * BullMQ worker (Phase 3). Requires REDIS_URL.
 * Run from repo root: npm run worker
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { Worker } from 'bullmq';
import IORedis from 'ioredis';

const require = createRequire(import.meta.url);
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

function artifactsRoot() {
  return process.env.ARTIFACTS_DIR ?? path.join(process.cwd(), '..', '..', 'artifacts');
}

async function writeRunReport(runId) {
  const run = await prisma.run.findUnique({
    where: { id: runId },
    include: { findings: true, artifacts: true, session: { select: { id: true, title: true } } },
  });
  if (!run) return;
  const ws = path.join(artifactsRoot(), 'runs', runId);
  await mkdir(ws, { recursive: true });
  const lines = [
    '# Assessment report',
    '',
    `Session: ${run.sessionId} (${run.session?.title ?? ''})`,
    `Run: ${run.id}`,
    `Status: ${run.status}`,
    '',
    '## Findings',
    '',
  ];
  for (const f of run.findings) {
    lines.push(`### ${f.title} (${f.severity})`, f.description, '');
    if (f.evidence) lines.push('**Evidence**', f.evidence, '');
    if (f.payload) lines.push('**Payload**', f.payload, '');
  }
  lines.push('## Artifacts', '');
  for (const a of run.artifacts) {
    lines.push(`- ${a.kind}: ${a.path}`);
  }
  await writeFile(path.join(ws, 'REPORT.md'), lines.join('\n'), 'utf8');
  // eslint-disable-next-line no-console
  console.log('Wrote REPORT.md for', runId);
}

const url = process.env.REDIS_URL || '';
if (!url) {
  // eslint-disable-next-line no-console
  console.error('REDIS_URL not set; worker needs Redis. Exiting.');
  process.exit(1);
}

const connection = new IORedis(url, { maxRetriesPerRequest: null });

// eslint-disable-next-line no-console
console.log('Worker listening on queue pentest-assessments…');

new Worker(
  'pentest-assessments',
  async (job) => {
    if (job.name === 'post-run' && job.data?.runId) {
      await writeRunReport(job.data.runId);
    }
    return { ok: true };
  },
  { connection }
);
