'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

/* ─── Types ─── */
type ToolEvent = { id: number; name: string; args?: string; result?: string; streaming?: string };
type ChatBlock =
  | { kind: 'user'; text: string }
  | { kind: 'assistant'; text: string }
  | { kind: 'tool'; tool: ToolEvent }
  | { kind: 'finding'; data: Finding }
  | { kind: 'error'; text: string };

type Finding = {
  id: string;
  title: string;
  severity: string;
  description: string;
  evidence?: string | null;
  payload?: string | null;
};

/* ─── Helpers ─── */
function authHeaders(): HeadersInit {
  const key =
    typeof window !== 'undefined' ? window.localStorage.getItem('MUTATION_API_KEY') ?? '' : '';
  return key ? { 'x-api-key': key } : {};
}

const LLM_LS = {
  provider: 'NOVATRIX_LLM_PROVIDER',
  openaiKey: 'NOVATRIX_OPENAI_API_KEY',
  openaiBaseUrl: 'NOVATRIX_OPENAI_BASE_URL',
  openaiModel: 'NOVATRIX_OPENAI_MODEL',
  anthropicKey: 'NOVATRIX_ANTHROPIC_API_KEY',
  anthropicModel: 'NOVATRIX_ANTHROPIC_MODEL',
  embeddingModel: 'NOVATRIX_EMBEDDING_MODEL',
} as const;

let toolIdSeq = 0;

/* ─── Main ─── */
export default function HomePage() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [blocks, setBlocks] = useState<ChatBlock[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [findings, setFindings] = useState<Finding[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  const [apiKeyInput, setApiKeyInput] = useState('');
  const [scopeUrl, setScopeUrl] = useState('');
  const [llmProvider, setLlmProvider] = useState<'openai' | 'anthropic'>('openai');
  const [llmOpenaiKey, setLlmOpenaiKey] = useState('');
  const [llmOpenaiBaseUrl, setLlmOpenaiBaseUrl] = useState('');
  const [llmOpenaiModel, setLlmOpenaiModel] = useState('');
  const [llmAnthropicKey, setLlmAnthropicKey] = useState('');
  const [llmAnthropicModel, setLlmAnthropicModel] = useState('');
  const [llmEmbeddingModel, setLlmEmbeddingModel] = useState('');

  const scrollToBottom = useCallback(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(scrollToBottom, [blocks, streaming, scrollToBottom]);

  /* Load localStorage */
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const k = window.localStorage.getItem('MUTATION_API_KEY');
    if (k) setApiKeyInput(k);
    const p = window.localStorage.getItem(LLM_LS.provider);
    if (p === 'anthropic' || p === 'openai') setLlmProvider(p);
    setLlmOpenaiKey(window.localStorage.getItem(LLM_LS.openaiKey) ?? '');
    setLlmOpenaiBaseUrl(window.localStorage.getItem(LLM_LS.openaiBaseUrl) ?? '');
    setLlmOpenaiModel(window.localStorage.getItem(LLM_LS.openaiModel) ?? '');
    setLlmAnthropicKey(window.localStorage.getItem(LLM_LS.anthropicKey) ?? '');
    setLlmAnthropicModel(window.localStorage.getItem(LLM_LS.anthropicModel) ?? '');
    setLlmEmbeddingModel(window.localStorage.getItem(LLM_LS.embeddingModel) ?? '');
  }, []);

  /* Create session */
  useEffect(() => {
    fetch('/api/sessions', { method: 'POST', headers: { ...authHeaders() } })
      .then((r) => {
        if (!r.ok) throw new Error(r.status === 401 ? 'Set mutation API key first' : 'Session error');
        return r.json();
      })
      .then((d: { id: string }) => setSessionId(d.id))
      .catch((e: Error) => setError(e.message));
  }, []);

  /* Load findings */
  const refreshFindings = useCallback(async (sid: string) => {
    const r = await fetch(`/api/sessions/${sid}/findings`);
    if (r.ok) setFindings((await r.json()) as Finding[]);
  }, []);

  useEffect(() => {
    if (sessionId) void refreshFindings(sessionId);
  }, [sessionId, refreshFindings]);

  const buildLlmPayload = useCallback(() => {
    const llm: Record<string, string> = { provider: llmProvider };
    if (llmOpenaiKey.trim()) llm.openaiApiKey = llmOpenaiKey.trim();
    if (llmOpenaiBaseUrl.trim()) llm.openaiBaseUrl = llmOpenaiBaseUrl.trim();
    if (llmOpenaiModel.trim()) llm.openaiModel = llmOpenaiModel.trim();
    if (llmAnthropicKey.trim()) llm.anthropicApiKey = llmAnthropicKey.trim();
    if (llmAnthropicModel.trim()) llm.anthropicModel = llmAnthropicModel.trim();
    if (llmEmbeddingModel.trim()) llm.embeddingModel = llmEmbeddingModel.trim();
    return llm;
  }, [llmProvider, llmOpenaiKey, llmOpenaiBaseUrl, llmOpenaiModel, llmAnthropicKey, llmAnthropicModel, llmEmbeddingModel]);

  /* ─── Send message ─── */
  const send = useCallback(async () => {
    if (!sessionId || !input.trim() || busy) return;
    const userMsg = input.trim();
    setInput('');
    setError(null);
    setBlocks((b) => [...b, { kind: 'user', text: userMsg }]);
    setStreaming('');
    setBusy(true);

    const controller = new AbortController();
    abortRef.current = controller;

    const activeTools = new Map<string, number>();

    try {
      const res = await fetch(`/api/sessions/${sessionId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ content: userMsg, llm: buildLlmPayload() }),
        signal: controller.signal,
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
        for (const raw of parts) {
          const line = raw.trim();
          if (!line.startsWith('data: ')) continue;
          let data: Record<string, unknown>;
          try { data = JSON.parse(line.slice(6)) as Record<string, unknown>; } catch { continue; }

          const type = data.type as string | undefined;

          if (type === 'delta' && data.text) {
            assistant += data.text as string;
            setStreaming(assistant);
          }

          if (type === 'tool_stream' && data.name && data.chunk) {
            const name = data.name as string;
            let tid = activeTools.get(name);
            if (tid === undefined) {
              tid = ++toolIdSeq;
              activeTools.set(name, tid);
              setBlocks((b) => [...b, { kind: 'tool', tool: { id: tid!, name, streaming: data.chunk as string } }]);
            } else {
              setBlocks((b) =>
                b.map((bl) =>
                  bl.kind === 'tool' && bl.tool.id === tid
                    ? { ...bl, tool: { ...bl.tool, streaming: (bl.tool.streaming ?? '') + (data.chunk as string) } }
                    : bl
                )
              );
            }
          }

          if (type === 'tool' && data.name) {
            const name = data.name as string;
            const result = (data.result as string) ?? '';
            const existingTid = activeTools.get(name);
            if (existingTid !== undefined) {
              setBlocks((b) =>
                b.map((bl) =>
                  bl.kind === 'tool' && bl.tool.id === existingTid
                    ? { ...bl, tool: { ...bl.tool, result, streaming: undefined } }
                    : bl
                )
              );
              activeTools.delete(name);
            } else {
              const tid = ++toolIdSeq;
              setBlocks((b) => [...b, { kind: 'tool', tool: { id: tid, name, result } }]);
            }
          }

          if (type === 'finding' && data.finding) {
            const f = data.finding as Finding;
            setBlocks((b) => [...b, { kind: 'finding', data: f }]);
          }

          if (type === 'error') {
            const msg = (data.message as string) ?? 'Unknown error';
            setError(msg);
            setBlocks((b) => [...b, { kind: 'error', text: msg }]);
          }

          if (type === 'done' && data.runId) {
            void refreshFindings(sessionId);
          }
        }
      }

      if (assistant.trim()) {
        setBlocks((b) => [...b, { kind: 'assistant', text: assistant }]);
      } else if (!error) {
        setBlocks((b) => [...b, { kind: 'assistant', text: '(Agent completed — no text output)' }]);
      }
      setStreaming('');
    } catch (e) {
      if ((e as Error).name === 'AbortError') {
        setBlocks((b) => [...b, { kind: 'error', text: 'Stopped by user.' }]);
      } else {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
        setBlocks((b) => [...b, { kind: 'error', text: msg }]);
      }
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  }, [sessionId, input, busy, error, refreshFindings, buildLlmPayload]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  /* ─── Settings actions ─── */
  const saveSettings = () => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem('MUTATION_API_KEY', apiKeyInput.trim());
    window.localStorage.setItem(LLM_LS.provider, llmProvider);
    window.localStorage.setItem(LLM_LS.openaiKey, llmOpenaiKey);
    window.localStorage.setItem(LLM_LS.openaiBaseUrl, llmOpenaiBaseUrl);
    window.localStorage.setItem(LLM_LS.openaiModel, llmOpenaiModel);
    window.localStorage.setItem(LLM_LS.anthropicKey, llmAnthropicKey);
    window.localStorage.setItem(LLM_LS.anthropicModel, llmAnthropicModel);
    window.localStorage.setItem(LLM_LS.embeddingModel, llmEmbeddingModel);
    setError(null);
    setSettingsOpen(false);
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
        projectId = ((await cr.json()) as { id: string }).id;
      }
      const tr = await fetch(`/api/projects/${projectId}/targets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ label: 'Primary target', urlPattern: scopeUrl.trim() }),
      });
      if (!tr.ok) throw new Error('Could not create target');
      const t = (await tr.json()) as { id: string };
      await fetch(`/api/sessions/${sessionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ targetId: t.id }),
      });
      setSettingsOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  /* ─── Render ─── */
  return (
    <div className="app-shell">
      {/* Header */}
      <header className="app-header">
        <div className="header-left">
          <h1 className="logo">Novatrix</h1>
          <span className="tagline">Autonomous Security Assessment</span>
        </div>
        <div className="header-right">
          {findings.length > 0 && (
            <span className="findings-badge">{findings.length} finding{findings.length > 1 ? 's' : ''}</span>
          )}
          <button className="icon-btn" onClick={() => setSettingsOpen(!settingsOpen)} title="Settings">
            <SettingsIcon />
          </button>
        </div>
      </header>

      <div className="main-area">
        {/* Settings drawer */}
        {settingsOpen && (
          <aside className="settings-drawer">
            <div className="drawer-section">
              <label className="drawer-label">Provider</label>
              <select value={llmProvider} onChange={(e) => setLlmProvider(e.target.value as 'openai' | 'anthropic')} className="input">
                <option value="openai">OpenAI-compatible</option>
                <option value="anthropic">Anthropic Claude</option>
              </select>
            </div>
            {llmProvider === 'openai' ? (
              <>
                <div className="drawer-section">
                  <label className="drawer-label">API Key</label>
                  <input type="password" value={llmOpenaiKey} onChange={(e) => setLlmOpenaiKey(e.target.value)} placeholder="sk-..." className="input" />
                </div>
                <div className="drawer-section">
                  <label className="drawer-label">Base URL</label>
                  <input value={llmOpenaiBaseUrl} onChange={(e) => setLlmOpenaiBaseUrl(e.target.value)} placeholder="https://api.openai.com/v1" className="input" />
                </div>
                <div className="drawer-section">
                  <label className="drawer-label">Model</label>
                  <input value={llmOpenaiModel} onChange={(e) => setLlmOpenaiModel(e.target.value)} placeholder="gpt-4o-mini" className="input" />
                </div>
              </>
            ) : (
              <>
                <div className="drawer-section">
                  <label className="drawer-label">API Key</label>
                  <input type="password" value={llmAnthropicKey} onChange={(e) => setLlmAnthropicKey(e.target.value)} placeholder="sk-ant-..." className="input" />
                </div>
                <div className="drawer-section">
                  <label className="drawer-label">Model</label>
                  <input value={llmAnthropicModel} onChange={(e) => setLlmAnthropicModel(e.target.value)} placeholder="claude-sonnet-4-5" className="input" />
                </div>
              </>
            )}
            <div className="drawer-section">
              <label className="drawer-label">Mutation API Key (optional)</label>
              <input value={apiKeyInput} onChange={(e) => setApiKeyInput(e.target.value)} placeholder="Server MUTATION_API_KEY" className="input" />
            </div>
            <div className="drawer-section">
              <label className="drawer-label">Target Scope</label>
              <input value={scopeUrl} onChange={(e) => setScopeUrl(e.target.value)} placeholder="https://target.example.com" className="input" />
              <button className="btn btn-sm" onClick={() => void applyScope()} disabled={!sessionId || !scopeUrl.trim()} style={{ marginTop: 6 }}>
                Apply Scope
              </button>
            </div>
            <div className="drawer-actions">
              <button className="btn btn-primary" onClick={saveSettings}>Save &amp; Close</button>
              <button className="btn" onClick={() => setSettingsOpen(false)}>Cancel</button>
            </div>
          </aside>
        )}

        {/* Chat area */}
        <main className="chat-main">
          <div className="chat-messages">
            {blocks.length === 0 && !busy && (
              <div className="empty-state">
                <h2>Ready for authorized assessment</h2>
                <p>Describe your target and objective. The agent will execute recon, scans, and analysis in a sandboxed environment.</p>
                <p className="hint">Configure your LLM key and target scope in <button className="link-btn" onClick={() => setSettingsOpen(true)}>Settings</button></p>
              </div>
            )}

            {blocks.map((block, i) => {
              if (block.kind === 'user') return <UserMsg key={i} text={block.text} />;
              if (block.kind === 'assistant') return <AssistantMsg key={i} text={block.text} />;
              if (block.kind === 'tool') return <ToolBlock key={block.tool.id} tool={block.tool} />;
              if (block.kind === 'finding') return <FindingBlock key={i} finding={block.data} />;
              if (block.kind === 'error') return <ErrorBlock key={i} text={block.text} />;
              return null;
            })}

            {streaming && <AssistantMsg text={streaming} live />}

            <div ref={chatEndRef} />
          </div>

          {/* Input bar */}
          <div className="input-bar">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && void send()}
              placeholder={sessionId ? 'Describe your assessment goal...' : 'Initializing session...'}
              disabled={!sessionId || busy}
              className="chat-input"
            />
            {busy ? (
              <button className="btn btn-danger" onClick={stop}>Stop</button>
            ) : (
              <button className="btn btn-primary" onClick={() => void send()} disabled={!sessionId || !input.trim()}>
                Send
              </button>
            )}
          </div>
        </main>

        {/* Findings sidebar (only when findings exist) */}
        {findings.length > 0 && (
          <aside className="findings-panel">
            <h3 className="findings-title">Findings ({findings.length})</h3>
            {findings.map((f) => (
              <div key={f.id} className="finding-card">
                <div className="finding-header">
                  <span className="finding-name">{f.title}</span>
                  <span className={`sev sev-${f.severity}`}>{f.severity}</span>
                </div>
                <p className="finding-desc">{f.description}</p>
                {f.evidence && <pre className="finding-evidence">{f.evidence}</pre>}
              </div>
            ))}
          </aside>
        )}
      </div>

      {error && (
        <div className="global-error">
          <span>{error}</span>
          <button className="error-dismiss" onClick={() => setError(null)}>×</button>
        </div>
      )}

      <style>{styles}</style>
    </div>
  );
}

/* ─── Chat components ─── */
function UserMsg({ text }: { text: string }) {
  return (
    <div className="msg msg-user">
      <div className="msg-avatar user-avatar">U</div>
      <div className="msg-body">
        <pre className="msg-text">{text}</pre>
      </div>
    </div>
  );
}

function AssistantMsg({ text, live }: { text: string; live?: boolean }) {
  return (
    <div className="msg msg-assistant">
      <div className="msg-avatar assistant-avatar">N</div>
      <div className="msg-body">
        <pre className="msg-text">{text}</pre>
        {live && <span className="typing-indicator" />}
      </div>
    </div>
  );
}

function ToolBlock({ tool }: { tool: ToolEvent }) {
  const [expanded, setExpanded] = useState(true);
  const isRunning = !tool.result && !!tool.streaming;
  const output = tool.result ?? tool.streaming ?? '';
  const lines = output.split('\n');
  const preview = lines.slice(0, 8).join('\n');
  const hasMore = lines.length > 8;

  return (
    <div className="tool-block">
      <button className="tool-header" onClick={() => setExpanded(!expanded)}>
        <span className={`tool-icon ${isRunning ? 'spinning' : ''}`}>{isRunning ? '⟳' : '⚡'}</span>
        <span className="tool-name">{tool.name}</span>
        {isRunning && <span className="tool-status">running...</span>}
        <span className="tool-chevron">{expanded ? '▾' : '▸'}</span>
      </button>
      {expanded && (
        <pre className="tool-output">{hasMore && !expanded ? preview + '\n...' : output || '(waiting...)'}</pre>
      )}
    </div>
  );
}

function FindingBlock({ finding }: { finding: Finding }) {
  return (
    <div className="finding-inline">
      <div className="finding-inline-header">
        <span className="finding-inline-icon">🎯</span>
        <strong>{finding.title}</strong>
        <span className={`sev sev-${finding.severity}`}>{finding.severity}</span>
      </div>
      <p className="finding-inline-desc">{finding.description}</p>
    </div>
  );
}

function ErrorBlock({ text }: { text: string }) {
  return (
    <div className="msg msg-error">
      <div className="msg-avatar error-avatar">!</div>
      <div className="msg-body"><pre className="msg-text error-text">{text}</pre></div>
    </div>
  );
}

function SettingsIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

/* ─── Styles ─── */
const styles = `
.app-shell {
  display: flex;
  flex-direction: column;
  height: 100vh;
  overflow: hidden;
}
.app-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 20px;
  border-bottom: 1px solid var(--border);
  background: var(--panel);
  flex-shrink: 0;
}
.header-left { display: flex; align-items: baseline; gap: 12px; }
.logo { margin: 0; font-size: 1.1rem; font-weight: 700; color: var(--text); }
.tagline { font-size: 0.8rem; color: var(--muted); }
.header-right { display: flex; align-items: center; gap: 12px; }
.findings-badge {
  font-size: 0.75rem;
  background: #1f3a1f;
  color: var(--success);
  padding: 3px 10px;
  border-radius: 12px;
  font-weight: 500;
}
.icon-btn {
  background: none;
  border: none;
  color: var(--muted);
  cursor: pointer;
  padding: 4px;
  border-radius: 6px;
  display: flex;
}
.icon-btn:hover { color: var(--text); background: #21262d; }

.main-area {
  display: flex;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

/* Settings drawer */
.settings-drawer {
  width: 320px;
  flex-shrink: 0;
  border-right: 1px solid var(--border);
  background: var(--panel);
  padding: 16px;
  overflow-y: auto;
}
.drawer-section { margin-bottom: 14px; }
.drawer-label { display: block; font-size: 0.75rem; color: var(--muted); margin-bottom: 4px; font-weight: 500; }
.drawer-actions { display: flex; gap: 8px; margin-top: 16px; }

/* Chat main */
.chat-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.chat-messages {
  flex: 1;
  overflow-y: auto;
  padding: 24px 0;
}
.empty-state {
  text-align: center;
  margin-top: 20vh;
  color: var(--muted);
}
.empty-state h2 { color: var(--text); font-size: 1.3rem; margin-bottom: 8px; font-weight: 600; }
.empty-state p { max-width: 500px; margin: 0 auto 8px; font-size: 0.9rem; }
.hint { font-size: 0.82rem; }
.link-btn { background: none; border: none; color: var(--accent); cursor: pointer; font-size: inherit; text-decoration: underline; }

/* Messages */
.msg {
  display: flex;
  gap: 12px;
  padding: 16px 24px;
  max-width: 860px;
  margin: 0 auto;
  width: 100%;
}
.msg-avatar {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.8rem;
  font-weight: 700;
  flex-shrink: 0;
}
.user-avatar { background: #1f6feb; color: #fff; }
.assistant-avatar { background: #238636; color: #fff; }
.error-avatar { background: #da3633; color: #fff; }
.msg-body { flex: 1; min-width: 0; }
.msg-text {
  margin: 0;
  white-space: pre-wrap;
  word-wrap: break-word;
  font-family: inherit;
  font-size: 0.9rem;
  line-height: 1.6;
}
.error-text { color: #f85149; }
.typing-indicator {
  display: inline-block;
  width: 6px;
  height: 6px;
  background: var(--accent);
  border-radius: 50%;
  margin-left: 4px;
  animation: pulse 1s infinite;
}
@keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.3; } }

/* Tool blocks */
.tool-block {
  max-width: 860px;
  margin: 4px auto;
  width: 100%;
  padding: 0 24px 0 68px;
}
.tool-header {
  display: flex;
  align-items: center;
  gap: 8px;
  background: #161b22;
  border: 1px solid var(--border);
  border-radius: 8px 8px 0 0;
  padding: 8px 12px;
  cursor: pointer;
  width: 100%;
  color: var(--text);
  font-size: 0.82rem;
  font-weight: 500;
  text-align: left;
}
.tool-header:hover { background: #1c2128; }
.tool-icon { font-size: 1rem; }
.spinning { animation: spin 1s linear infinite; }
@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
.tool-name { font-family: ui-monospace, monospace; color: var(--accent); }
.tool-status { color: var(--muted); font-size: 0.75rem; margin-left: auto; }
.tool-chevron { color: var(--muted); margin-left: auto; }
.tool-output {
  margin: 0;
  padding: 10px 14px;
  background: #0d1117;
  border: 1px solid var(--border);
  border-top: none;
  border-radius: 0 0 8px 8px;
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 0.78rem;
  line-height: 1.5;
  color: #c9d1d9;
  overflow-x: auto;
  max-height: 400px;
  overflow-y: auto;
  white-space: pre-wrap;
  word-break: break-all;
}

/* Findings inline */
.finding-inline {
  max-width: 860px;
  margin: 8px auto;
  width: 100%;
  padding: 0 24px 0 68px;
}
.finding-inline-header {
  display: flex;
  align-items: center;
  gap: 8px;
  background: #1a2332;
  border: 1px solid #1f6feb44;
  border-radius: 8px 8px 0 0;
  padding: 10px 14px;
  font-size: 0.85rem;
}
.finding-inline-icon { font-size: 1rem; }
.finding-inline-desc {
  margin: 0;
  padding: 10px 14px;
  background: #0d1520;
  border: 1px solid #1f6feb44;
  border-top: none;
  border-radius: 0 0 8px 8px;
  font-size: 0.82rem;
  color: var(--muted);
}

/* Findings sidebar */
.findings-panel {
  width: 300px;
  flex-shrink: 0;
  border-left: 1px solid var(--border);
  background: var(--panel);
  padding: 16px;
  overflow-y: auto;
}
.findings-title { font-size: 0.85rem; margin: 0 0 12px; font-weight: 600; }
.finding-card {
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 10px 12px;
  margin-bottom: 10px;
  background: #0d1117;
}
.finding-header { display: flex; align-items: center; justify-content: space-between; gap: 6px; }
.finding-name { font-size: 0.82rem; font-weight: 500; }
.finding-desc { font-size: 0.78rem; color: var(--muted); margin: 6px 0 0; }
.finding-evidence { font-size: 0.72rem; color: #8b949e; margin: 6px 0 0; white-space: pre-wrap; }

.sev { font-size: 0.7rem; padding: 2px 8px; border-radius: 10px; font-weight: 500; }
.sev-critical { background: #4d1f1f; color: #f85149; }
.sev-high { background: #3d2a0f; color: #fb923c; }
.sev-medium { background: #3d340f; color: #d29922; }
.sev-low { background: #1a3d1a; color: #3fb950; }
.sev-info { background: #1c2128; color: #8b949e; }

/* Input bar */
.input-bar {
  display: flex;
  gap: 10px;
  padding: 14px 24px;
  border-top: 1px solid var(--border);
  background: var(--panel);
  max-width: 908px;
  margin: 0 auto;
  width: 100%;
}
.chat-input {
  flex: 1;
  padding: 10px 14px;
  border-radius: 10px;
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--text);
  font-size: 0.9rem;
  outline: none;
  transition: border-color 0.2s;
}
.chat-input:focus { border-color: var(--accent); }
.chat-input:disabled { opacity: 0.5; }

/* Buttons */
.btn {
  padding: 8px 16px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: #21262d;
  color: var(--text);
  cursor: pointer;
  font-size: 0.85rem;
  font-weight: 500;
  transition: background 0.15s;
}
.btn:hover { background: #30363d; }
.btn:disabled { opacity: 0.4; cursor: not-allowed; }
.btn-sm { padding: 5px 12px; font-size: 0.78rem; }
.btn-primary { background: #238636; border-color: #2ea043; color: #fff; }
.btn-primary:hover { background: #2ea043; }
.btn-danger { background: #da3633; border-color: #f85149; color: #fff; }
.btn-danger:hover { background: #b62324; }

.input {
  width: 100%;
  padding: 8px 10px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--text);
  font-size: 0.82rem;
  outline: none;
}
.input:focus { border-color: var(--accent); }

/* Global error bar */
.global-error {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 20px;
  background: #3d1f1f;
  color: #fecaca;
  font-size: 0.85rem;
  flex-shrink: 0;
}
.error-dismiss {
  background: none;
  border: none;
  color: #fecaca;
  font-size: 1.2rem;
  cursor: pointer;
  padding: 0 4px;
}

@media (max-width: 768px) {
  .settings-drawer { width: 100%; position: absolute; z-index: 10; height: calc(100vh - 50px); }
  .findings-panel { display: none; }
  .msg { padding: 12px 16px; }
  .tool-block, .finding-inline { padding-left: 52px; padding-right: 16px; }
  .input-bar { padding: 10px 16px; }
}
`;
