import { NextResponse } from 'next/server';
import path from 'node:path';
import { readFile, realpath } from 'node:fs/promises';
import { prisma } from '@/lib/prisma';
import { ensureSessionWorkspace } from '@/lib/workspacePath';

function guessMime(p: string): string {
  if (p.endsWith('.png')) return 'image/png';
  if (p.endsWith('.jpg') || p.endsWith('.jpeg')) return 'image/jpeg';
  if (p.endsWith('.html')) return 'text/html; charset=utf-8';
  if (p.endsWith('.json')) return 'application/json; charset=utf-8';
  return 'application/octet-stream';
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ runId: string; path: string[] }> }
) {
  const { runId, path: segments } = await params;
  if (!segments?.length) {
    return NextResponse.json({ error: 'path required' }, { status: 400 });
  }
  const run = await prisma.run.findUnique({ where: { id: runId } });
  if (!run) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  const rel = path.join(...segments);
  if (path.isAbsolute(rel) || rel.includes('..')) {
    return NextResponse.json({ error: 'invalid path' }, { status: 400 });
  }

  const base = await ensureSessionWorkspace(runId);
  const baseResolved = await realpath(base).catch(() => base);
  const full = path.resolve(baseResolved, rel);
  const relCheck = path.relative(path.resolve(baseResolved), full);
  if (relCheck.startsWith('..') || path.isAbsolute(relCheck)) {
    return NextResponse.json({ error: 'path escape' }, { status: 400 });
  }

  try {
    const buf = await readFile(full);
    return new Response(buf, {
      headers: { 'Content-Type': guessMime(full) },
    });
  } catch {
    return NextResponse.json({ error: 'file not found' }, { status: 404 });
  }
}
