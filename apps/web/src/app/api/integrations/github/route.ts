import { NextResponse } from 'next/server';
import { assertMutationAuthorized } from '@/lib/mutationAuth';

/** Minimal GitHub issue create (Neo GitHub integration stub — expand for PR checks). */
export async function POST(req: Request) {
  try {
    assertMutationAuthorized(req);
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPO;
  if (!token || !repo || !repo.includes('/')) {
    return NextResponse.json(
      { ok: false, error: 'GITHUB_TOKEN and GITHUB_REPO (owner/name) required' },
      { status: 400 }
    );
  }
  const body = await req.json().catch(() => ({}));
  const title = typeof body.title === 'string' ? body.title : '';
  const issueBody = typeof body.body === 'string' ? body.body : '';
  if (!title.trim()) {
    return NextResponse.json({ error: 'title required' }, { status: 400 });
  }

  const r = await fetch(`https://api.github.com/repos/${repo}/issues`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: JSON.stringify({
      title: title.slice(0, 200),
      body: issueBody.slice(0, 60000),
    }),
  });
  if (!r.ok) {
    const t = await r.text();
    return NextResponse.json({ ok: false, error: t.slice(0, 2000) }, { status: 502 });
  }
  const j = (await r.json()) as { html_url?: string; number?: number };
  return NextResponse.json({ ok: true, html_url: j.html_url, number: j.number });
}
