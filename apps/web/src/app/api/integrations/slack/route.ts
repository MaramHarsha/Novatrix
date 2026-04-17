import { NextResponse } from 'next/server';
import { assertMutationAuthorized } from '@/lib/mutationAuth';

/** Neo Slack-style notification (bot token). */
export async function POST(req: Request) {
  try {
    assertMutationAuthorized(req);
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const token = process.env.SLACK_BOT_TOKEN;
  const channel = process.env.SLACK_CHANNEL_ID;
  if (!token || !channel) {
    return NextResponse.json(
      { ok: false, error: 'SLACK_BOT_TOKEN and SLACK_CHANNEL_ID must be set' },
      { status: 400 }
    );
  }
  const body = await req.json().catch(() => ({}));
  const text = typeof body.text === 'string' ? body.text : '';
  if (!text.trim()) {
    return NextResponse.json({ error: 'text required' }, { status: 400 });
  }

  const r = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify({ channel, text: text.slice(0, 4000) }),
  });
  const j = (await r.json()) as { ok?: boolean; error?: string };
  if (!j.ok) {
    return NextResponse.json({ ok: false, error: j.error ?? 'slack_api_error' }, { status: 502 });
  }
  return NextResponse.json({ ok: true });
}
