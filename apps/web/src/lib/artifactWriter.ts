import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { PrismaClient } from '@prisma/client';

export async function writeArtifact(
  prisma: PrismaClient,
  runId: string,
  workspaceDir: string,
  kind: string,
  filename: string,
  body: string | Buffer,
  mimeType?: string
): Promise<string> {
  await mkdir(workspaceDir, { recursive: true });
  const safeName = path.basename(filename).replace(/[^\w.\-]/g, '_');
  const full = path.join(workspaceDir, safeName);
  await writeFile(full, body, typeof body === 'string' ? 'utf8' : undefined);
  const row = await prisma.artifact.create({
    data: {
      runId,
      kind,
      path: safeName,
      mimeType: mimeType ?? (typeof body === 'string' ? 'text/plain' : 'application/octet-stream'),
    },
  });
  return row.id;
}
