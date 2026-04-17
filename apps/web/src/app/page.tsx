'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';

type ChatLine = { role: 'user' | 'assistant'; content: string };

type Finding = {
  id: string;
  title: string;
  severity: string;
  description: string;
  evidence?: string | null;
  payload?: string | null;
  run?: { id: string; startedAt: string; status: string };
};

function authHeaders(): HeadersInit {
  const key =
    typeof window !== 'undefined' ? window.localStorage.getItem('MUTATION_API_KEY') ?? '' : '';
  return key ? { 'x-api-key': key } : {};
}

export default function HomePage() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [lastRunId, setLastRunId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatLine[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState('');
  const [terminalLog, setTerminalLog] = useState('');
  const [browserLog, setBrowserLog] = useState('');
  const [apiLog, setApiLog] = useState('');
  const [networkLog, setNetworkLog] = useState('');
  const [findings, setFindings] = useState<Finding[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [integrations, setIntegrations] = useState<Record<string, { configured: boolean }> | null>(null);
  const [scopeUrl, setScopeUrl] = useState('');
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [scheduleCron, setScheduleCron] = useState('0 */6 * * *');
  const [schedulePrompt, setSchedulePrompt] = useState('Re-run passive httpx fingerprint on the primary target.');

  const screenshotUrl = useMemo(() => {
    if (!lastRunId) return null;
    return `/api/runs/${lastRunId}/artifact-file/browser/snap.png`;
  }, [lastRunId]);

  const refreshFindings = useCallback(async (sid: string) => {
    const r = await fetch(`/api/sessions/${sid}/findings`);
    if (r.ok) {
      const data = (await r.json()) as Finding[];
      setFindings(data);
    }
  }, []);

  useEffect(() => {
    const k = typeof window !== 'undefined' ? window.localStorage.getItem('MUTATION_API_KEY') : '';
    if (k) setApiKeyInput(k);
  }, []);

  useEffect(() => {
    fetch('/api/integrations')
      .then((r) => r.json())
      .then(setIntegrations)
      .catch(() => setIntegrations(null));
  }, []);

  useEffect(() => {
    fetch('/api/sessions', { method: 'POST', headers: { ...authHeaders() } })
      .then((r) => {
        if (!r.ok) throw new Error(r.status === 401 ? 'Set mutation API key in header / local storage' : 'session');
        return r.json();
      })
      .then((d: { id: string }) => setSessionId(d.id))
      .catch((e: Error) => setError(e.message));
  }, []);

  useEffect(() => {
    if (!sessionId) return;
    void refreshFindings(sessionId);
  }, [sessionId, refreshFindings]);

  const saveApiKey = () => {
    window.localStorage.setItem('MUTATION_API_KEY', apiKeyInput.trim());
    setError(null);
  };

  const applyScope = async () => {
    if (!sessionId || !scopeUrl.trim()) return;
    setError(null);
    try {
      let projectId: string;
      const lp = await fetch('/api/projects');
      const projects = lp.ok ? ((await lp.json()) as { id: string }[]) : [];
      if (projects.length) {
        projectId = projects[0].id;
      } else {
        const cr = await fetch('/api/projects', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeaders() },
          body: JSON.stringify({ name: 'Default program' }),
        });
        if (!cr.ok) throw new Error('Could not create project');
        const p = (await cr.json()) as { id: string };
        projectId = p.id;
      }
      const tr = await fetch(`/api/projects/${projectId}/targets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ label: 'Primary target', urlPattern: scopeUrl.trim() }),
      });
      if (!tr.ok) throw new Error('Could not create target');
      const t = (await tr.json()) as { id: string };
      const pr = await fetch(`/api/sessions/${sessionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ targetId: t.id }),
      });
      if (!pr.ok) throw new Error('Could not attach target to session');
      await refreshFindings(sessionId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const createSchedule = async () => {
    if (!sessionId) return;
    setError(null);
    try {
      const r = await fetch('/api/schedules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ sessionId, cronExpr: scheduleCron, prompt: schedulePrompt }),
      });
      if (!r.ok) throw new Error('Schedule create failed');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const send = useCallback(async () => {
    if (!sessionId || !input.trim() || busy) return;
    const userMsg = input.trim();
    setInput('');
    setError(null);
    setMessages((m) => [...m, { role: 'user', content: userMsg }]);
    setStreaming('');
    setTerminalLog('');
    setBrowserLog('');
    setApiLog('');
    setNetworkLog('');
    setBusy(true);

    try {
      const res = await fetch(`/api/sessions/${sessionId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ content: userMsg }),
      });

      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error((j as { error?: string }).error ?? res.statusText);
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error('No response body');

      const dec = new TextDecoder();
      let buffer = '';
      let assistant = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += dec.decode(value, { stream: true });
        const parts = buffer.split('\n\n');
        buffer = parts.pop() ?? '';
        for (const block of parts) {
          const line = block.trim();
          if (!line.startsWith('data: ')) continue;
          let data: {
            type?: string;
            text?: string;
            name?: string;
            result?: string;
            message?: string;
            finding?: unknown;
            chunk?: string;
            stream?: string;
            method?: string;
            url?: string;
            preview?: string;
            runId?: string;
            line?: string;
          };
          try {
            data = JSON.parse(line.slice(6)) as typeof data;
          } catch {
            continue;
          }
          if (data.type === 'delta' && data.text) {
            assistant += data.text;
            setStreaming(assistant);
          }
          if (data.type === 'tool_stream' && data.chunk && data.name) {
            const ch = data.chunk;
            if (data.name === 'terminal_exec') {
              setTerminalLog((t) => t + ch);
            }
            if (data.name === 'browser_navigate') {
              setBrowserLog((t) => t + ch);
            }
          }
          if (data.type === 'tool' && data.name) {
            const chunk = data.result ?? '';
            if (data.name === 'terminal_exec') {
              setTerminalLog((t) => `${t}\n\n--- ${data.name} (complete) ---\n${chunk.slice(0, 12000)}`);
            } else if (data.name === 'browser_navigate') {
              setBrowserLog((t) => `${t}\n\n--- ${data.name} ---\n${chunk.slice(0, 8000)}`);
            } else {
              setTerminalLog((t) => `${t}\n\n--- ${data.name} ---\n${chunk.slice(0, 8000)}`);
            }
          }
          if (data.type === 'finding' && data.finding) {
            setTerminalLog((t) => `${t}\n\n[FINDING] ${JSON.stringify(data.finding, null, 2)}`);
          }
          if (data.type === 'api') {
            setApiLog(
              (a) =>
                `${a}\n${data.method ?? ''} ${data.url ?? ''}\n${(data.preview ?? '').slice(0, 2000)}\n---\n`
            );
          }
          if (data.type === 'network' && data.line) {
            setNetworkLog((n) => `${n}${data.line}\n`);
          }
          if (data.type === 'browser' && data.preview) {
            setBrowserLog((b) => `${b}\n${(data.preview ?? '').slice(0, 6000)}`);
          }
          if (data.type === 'error') {
            setError(data.message ?? 'Unknown error');
          }
          if (data.type === 'done' && data.runId) {
            setLastRunId(data.runId);
            void refreshFindings(sessionId);
          }
        }
      }

      setMessages((m) => [...m, { role: 'assistant', content: assistant || '(empty response)' }]);
      setStreaming('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [sessionId, input, busy, refreshFindings]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      <header
        style={{
          padding: '0.85rem 1.25rem',
          borderBottom: '1px solid var(--border)',
          background: 'var(--panel)',
          display: 'flex',
          flexWrap: 'wrap',
          gap: '1rem',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div>
          <h1 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 650 }}>Novatrix</h1>
          <p style={{ margin: '0.35rem 0 0', fontSize: '0.82rem', color: 'var(--muted)', maxWidth: 720 }}>
            Authorized security assessments: chat objective, isolated sandbox execution, live terminal stream,
            HTTP/API trace, evidence-backed findings. Configure <code>OPENAI_API_KEY</code>, optional{' '}
            <code>MUTATION_API_KEY</code>, and scope targets below.
          </p>
        </div>
        <div style={{ fontSize: '0.75rem', color: 'var(--muted)', textAlign: 'right' }}>
          {integrations && (
            <div style={{ display: 'flex', gap: '0.65rem', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              {Object.entries(integrations).map(([k, v]) => (
                <span key={k}>
                  {k}:{' '}
                  <span style={{ color: v.configured ? '#6ee7b7' : '#fca5a5' }}>
                    {v.configured ? 'on' : 'off'}
                  </span>
                </span>
              ))}
            </div>
          )}
        </div>
      </header>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(280px, 1fr) minmax(0, 2.2fr)',
          flex: 1,
          minHeight: 0,
        }}
      >
        <aside
          style={{
            borderRight: '1px solid var(--border)',
            padding: '0.75rem 1rem',
            overflow: 'auto',
            background: '#0f1218',
          }}
        >
          <div style={{ fontSize: '0.72rem', color: 'var(--muted)', marginBottom: '0.35rem' }}>Access</div>
          <input
            value={apiKeyInput}
            onChange={(e) => setApiKeyInput(e.target.value)}
            placeholder="MUTATION_API_KEY (browser)"
            style={inputStyle}
          />
          <button type="button" onClick={saveApiKey} style={{ ...btnStyle, marginTop: '0.45rem', width: '100%' }}>
            Save API key locally
          </button>

          <div style={{ fontSize: '0.72rem', color: 'var(--muted)', margin: '1rem 0 0.35rem' }}>Scope</div>
          <input
            value={scopeUrl}
            onChange={(e) => setScopeUrl(e.target.value)}
            placeholder="https://your-lab-target.example"
            style={inputStyle}
          />
          <button
            type="button"
            onClick={() => void applyScope()}
            disabled={!sessionId}
            style={{ ...btnStyle, marginTop: '0.45rem', width: '100%' }}
          >
            Apply scope to session
          </button>

          <div style={{ fontSize: '0.72rem', color: 'var(--muted)', margin: '1rem 0 0.35rem' }}>Scheduling</div>
          <input
            value={scheduleCron}
            onChange={(e) => setScheduleCron(e.target.value)}
            placeholder="cron"
            style={inputStyle}
          />
          <textarea
            value={schedulePrompt}
            onChange={(e) => setSchedulePrompt(e.target.value)}
            rows={3}
            style={{ ...inputStyle, marginTop: '0.35rem', resize: 'vertical' }}
          />
          <button
            type="button"
            onClick={() => void createSchedule()}
            disabled={!sessionId}
            style={{ ...btnStyle, marginTop: '0.45rem', width: '100%' }}
          >
            Save schedule row
          </button>
          <p style={{ fontSize: '0.7rem', color: 'var(--muted)', marginTop: '0.5rem' }}>
            BullMQ worker + Redis enqueue post-run reports; attach a cron runner to hit the chat API for full cadence
            automation.
          </p>
        </aside>

        <main style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              flex: 1,
              minHeight: 0,
              borderBottom: '1px solid var(--border)',
            }}
          >
            <section style={{ display: 'flex', flexDirection: 'column', minHeight: 0, borderRight: '1px solid var(--border)' }}>
              <PanelLabel>Objective &amp; chat</PanelLabel>
              <div style={{ flex: 1, overflow: 'auto', padding: '0 0.85rem 0.85rem' }}>
                {messages.map((m, i) => (
                  <div
                    key={i}
                    style={{
                      marginBottom: '0.85rem',
                      whiteSpace: 'pre-wrap',
                      color: m.role === 'user' ? 'var(--text)' : '#a8c4f0',
                      fontSize: '0.9rem',
                    }}
                  >
                    <strong>{m.role === 'user' ? 'You' : 'Assistant'}</strong>
                    <div style={{ marginTop: '0.2rem' }}>{m.content}</div>
                  </div>
                ))}
                {streaming && (
                  <div style={{ color: '#a8c4f0', whiteSpace: 'pre-wrap', fontSize: '0.9rem' }}>
                    <strong>Assistant</strong>
                    <div style={{ marginTop: '0.2rem' }}>{streaming}</div>
                  </div>
                )}
              </div>
              <div style={{ padding: '0.65rem 0.85rem', borderTop: '1px solid var(--border)', display: 'flex', gap: '0.45rem' }}>
                <input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && void send()}
                  placeholder={
                    sessionId
                      ? 'Describe the authorized goal (recon, nuclei, httpx, browser capture, API checks)…'
                      : 'Starting session…'
                  }
                  disabled={!sessionId || busy}
                  style={{ ...inputStyle, flex: 1 }}
                />
                <button type="button" onClick={() => void send()} disabled={!sessionId || busy} style={btnPrimary}>
                  Run
                </button>
              </div>
            </section>

            <section style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
              <PanelLabel>Terminal (live stream)</PanelLabel>
              <pre style={preStyle}>{terminalLog || 'Waiting for terminal_exec…'}</pre>
            </section>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
              minHeight: 200,
              flex: '0 0 38vh',
            }}
          >
            <section style={{ display: 'flex', flexDirection: 'column', minHeight: 0, borderRight: '1px solid var(--border)' }}>
              <PanelLabel>Browser</PanelLabel>
              {screenshotUrl && (
                <div style={{ padding: '0 0.5rem' }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={screenshotUrl}
                    alt="Latest screenshot"
                    style={{ maxWidth: '100%', borderRadius: 6, border: '1px solid var(--border)' }}
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = 'none';
                    }}
                  />
                </div>
              )}
              <pre style={{ ...preStyle, flex: 1 }}>{browserLog || 'browser_navigate output / capture logs…'}</pre>
            </section>
            <section style={{ display: 'flex', flexDirection: 'column', minHeight: 0, borderRight: '1px solid var(--border)' }}>
              <PanelLabel>HTTP / API</PanelLabel>
              <pre style={preStyle}>{apiLog || 'http_request traces appear here.'}</pre>
            </section>
            <section style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
              <PanelLabel>Network log</PanelLabel>
              <pre style={preStyle}>{networkLog || 'High-level request lines from http_request.'}</pre>
            </section>
          </div>

          <section style={{ borderTop: '1px solid var(--border)', flex: '0 0 22vh', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <PanelLabel>Evidence &amp; findings</PanelLabel>
            <div style={{ flex: 1, overflow: 'auto', padding: '0 0.85rem 0.85rem', fontSize: '0.82rem' }}>
              {findings.length === 0 && <span style={{ color: 'var(--muted)' }}>No findings yet for this session.</span>}
              {findings.map((f) => (
                <div
                  key={f.id}
                  style={{
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                    padding: '0.55rem 0.65rem',
                    marginBottom: '0.45rem',
                    background: '#11151d',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem' }}>
                    <strong>{f.title}</strong>
                    <span style={{ color: sevColor(f.severity), fontSize: '0.72rem' }}>{f.severity}</span>
                  </div>
                  <div style={{ color: 'var(--muted)', marginTop: '0.25rem', whiteSpace: 'pre-wrap' }}>{f.description}</div>
                  {f.evidence && (
                    <div style={{ marginTop: '0.35rem', color: '#cbd5e1', whiteSpace: 'pre-wrap' }}>
                      <em>Evidence:</em> {f.evidence}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
        </main>
      </div>

      {error && (
        <div
          style={{
            padding: '0.65rem 1rem',
            background: '#3d1f1f',
            color: '#fecaca',
            fontSize: '0.88rem',
          }}
        >
          {error}
        </div>
      )}
    </div>
  );
}

function PanelLabel({ children }: { children: ReactNode }) {
  return (
    <div style={{ padding: '0.45rem 0.75rem', fontSize: '0.72rem', color: 'var(--muted)', letterSpacing: '0.02em' }}>
      {children}
    </div>
  );
}

function sevColor(s: string): string {
  switch (s) {
    case 'critical':
      return '#f87171';
    case 'high':
      return '#fb923c';
    case 'medium':
      return '#fbbf24';
    case 'low':
      return '#86efac';
    default:
      return '#94a3b8';
  }
}

const inputStyle: CSSProperties = {
  width: '100%',
  padding: '0.45rem 0.55rem',
  borderRadius: 6,
  border: '1px solid var(--border)',
  background: '#0d1117',
  color: 'var(--text)',
  fontSize: '0.85rem',
};

const btnStyle: CSSProperties = {
  padding: '0.45rem 0.65rem',
  borderRadius: 6,
  border: '1px solid var(--border)',
  background: '#1b2230',
  color: 'var(--text)',
  cursor: 'pointer',
  fontSize: '0.82rem',
};

const btnPrimary: CSSProperties = {
  ...btnStyle,
  background: 'var(--accent)',
  borderColor: 'transparent',
  color: '#fff',
  fontWeight: 600,
};

const preStyle: CSSProperties = {
  flex: 1,
  margin: 0,
  padding: '0 0.75rem 0.75rem',
  overflow: 'auto',
  fontSize: '0.78rem',
  background: 'var(--terminal)',
  color: '#c9d1d9',
};
