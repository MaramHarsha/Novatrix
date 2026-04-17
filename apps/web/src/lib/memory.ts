import type { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';
import type OpenAI from 'openai';

function cosineSimilarity(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const d = Math.sqrt(na) * Math.sqrt(nb);
  return d === 0 ? 0 : dot / d;
}

export async function embedText(openai: OpenAI, model: string, text: string): Promise<number[]> {
  const res = await openai.embeddings.create({ model, input: text.slice(0, 8000) });
  const v = res.data[0]?.embedding;
  if (!v) throw new Error('embedding failed');
  return v;
}

/** Top-k memory snippets by cosine similarity to query embedding. */
export async function retrieveMemoryContext(
  prisma: PrismaClient,
  sessionId: string,
  queryEmbedding: number[],
  k = 6
): Promise<string> {
  const rows = await prisma.memoryEntry.findMany({
    where: { sessionId },
    orderBy: { createdAt: 'desc' },
    take: 80,
  });
  const scored = rows
    .map((r) => {
      const emb = r.embedding as unknown;
      if (!Array.isArray(emb)) return { score: -1, content: '' };
      const vec = emb.map((x) => Number(x));
      return { score: cosineSimilarity(queryEmbedding, vec), content: r.content };
    })
    .filter((x) => x.score > 0.15)
    .sort((a, b) => b.score - a.score)
    .slice(0, k);

  if (!scored.length) return '';
  return scored.map((s) => `- (${s.score.toFixed(2)}) ${s.content}`).join('\n');
}

export async function persistRunSummaryMemory(
  prisma: PrismaClient,
  openai: OpenAI,
  embeddingModel: string,
  sessionId: string,
  summary: string
): Promise<void> {
  const trimmed = summary.trim().slice(0, 12000);
  if (!trimmed) return;
  const embedding = await embedText(openai, embeddingModel, trimmed);
  await prisma.memoryEntry.create({
    data: {
      sessionId,
      content: trimmed,
      embedding: embedding as unknown as Prisma.InputJsonValue,
      source: 'run_summary',
    },
  });
}
