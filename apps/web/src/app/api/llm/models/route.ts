import { NextResponse } from 'next/server';
import { LLM_MODEL_CATALOG } from '@/lib/llmModelCatalog';

/** Model hints + doc links (curated; configure any custom id via env). */
export async function GET() {
  return NextResponse.json(LLM_MODEL_CATALOG);
}
