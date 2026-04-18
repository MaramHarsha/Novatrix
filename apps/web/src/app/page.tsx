'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

/* ─── Types ─── */
type ToolEntry = { id: number; name: string; args?: string; result?: string; streaming?: string };
type ChatBlock =
  | { kind: 'user'; text: string }
  | { kind: 'assistant'; text: string }
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

type SandboxConfigDto = {
  sandboxMode: string;
  defaultNovatrixImage: string;
  defaultExegolImage: string;
  defaultDockerNetwork: string;
};

type SessionDto = {
  id: string;
  sandboxEnableNovatrix: boolean;
  sandboxEnableExegol: boolean;
  sandboxNovatrixImage: string | null;
  sandboxExegolImage: string | null;
  sandboxDockerNetwork: string | null;
};

type FeedLine = { id: string; tag: string; text: string };

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

/** Legacy global operator context (migrated into per-session keys when a session loads). */
const CTX_LS = 'NOVATRIX_ASSESSMENT_CONTEXT';
const LS_ACTIVE_SESSION = 'NOVATRIX_ACTIVE_SESSION_ID';
const opCtxKey = (sessionId: string) => `novatrix_opctx_${sessionId}`;

let toolIdSeq = 0;

type SessionListItem = { id: string; title: string; updatedAt: string };
type SessionDetail = SessionDto & {
  target?: { urlPattern: string; label?: string } | null;
  title?: string;
};

function formatChatTime(iso: string) {
  try {
    const d = new Date(iso);
    const now = Date.now();
    const diff = now - d.getTime();
    if (diff < 86_400_000) {
      return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    }
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch {
    return '';
  }
}

/* ─── Main ─── */
export default function HomePage() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionsList, setSessionsList] = useState<SessionListItem[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [blocks, setBlocks] = useState<ChatBlock[]>([]);
  const [toolEntries, setToolEntries] = useState<ToolEntry[]>([]);
  const [feedLines, setFeedLines] = useState<FeedLine[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [sandboxCfg, setSandboxCfg] = useState<SandboxConfigDto | null>(null);
  const [operatorContext, setOperatorContext] = useState('');
  const [scopeUrl, setScopeUrl] = useState('');

  const [sandboxEnableNovatrix, setSandboxEnableNovatrix] = useState(true);
  const [sandboxEnableExegol, setSandboxEnableExegol] = useState(true);
  const [sandboxNovatrixImage, setSandboxNovatrixImage] = useState('');
  const [sandboxExegolImage, setSandboxExegolImage] = useState('');
  const [sandboxDockerNetwork, setSandboxDockerNetwork] = useState<'none' | 'bridge'>('bridge');
  const [sandboxSaving, setSandboxSaving] = useState(false);
  const [sandboxPulling, setSandboxPulling] = useState(false);

  const [apiKeyInput, setApiKeyInput] = useState('');
  const [llmProvider, setLlmProvider] = useState<'openai' | 'anthropic'>('openai');
  const [llmOpenaiKey, setLlmOpenaiKey] = useState('');
  const [llmOpenaiBaseUrl, setLlmOpenaiBaseUrl] = useState('');
  const [llmOpenaiModel, setLlmOpenaiModel] = useState('');
  const [llmAnthropicKey, setLlmAnthropicKey] = useState('');
  const [llmAnthropicModel, setLlmAnthropicModel] = useState('');
  const [llmEmbeddingModel, setLlmEmbeddingModel] = useState('');

  const abortRef = useRef<AbortController | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const consoleEndRef = useRef<HTMLDivElement | null>(null);
  const feedIdRef = useRef(0);

  const scrollToBottom = useCallback(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(scrollToBottom, [blocks, streaming, scrollToBottom]);

  useEffect(() => {
    consoleEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [toolEntries, feedLines]);

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

  useEffect(() => {
    void fetch('/api/sandbox-config')
      .then((r) => r.json())
      .then((d: SandboxConfigDto) => setSandboxCfg(d))
      .catch(() => setSandboxCfg(null));
  }, []);

  const fetchSessionList = useCallback(async () => {
    const r = await fetch('/api/sessions');
    if (r.ok) setSessionsList((await r.json()) as SessionListItem[]);
  }, []);

  const refreshFindings = useCallback(async (sid: string) => {
    const r = await fetch(`/api/sessions/${sid}/findings`);
    if (r.ok) setFindings((await r.json()) as Finding[]);
  }, []);

  const applySessionDetail = useCallback((s: SessionDetail) => {
    setSandboxEnableNovatrix(s.sandboxEnableNovatrix !== false);
    setSandboxEnableExegol(!!s.sandboxEnableExegol);
    setSandboxNovatrixImage(s.sandboxNovatrixImage ?? '');
    setSandboxExegolImage(s.sandboxExegolImage ?? '');
    const net = s.sandboxDockerNetwork;
    if (net === 'bridge' || net === 'none') setSandboxDockerNetwork(net);
    else setSandboxDockerNetwork('bridge');
    setScopeUrl(s.target?.urlPattern ?? '');
  }, []);

  const loadPersistedChat = useCallback(
    async (sid: string) => {
      const r = await fetch(`/api/sessions/${sid}/messages`);
      if (!r.ok) {
        setBlocks([]);
        return;
      }
      const data = (await r.json()) as {
        messages: Array<{ role: string; content: string }>;
      };
      const next: ChatBlock[] = [];
      for (const m of data.messages) {
        if (m.role === 'user') next.push({ kind: 'user', text: m.content });
        else if (m.role === 'assistant') next.push({ kind: 'assistant', text: m.content });
      }
      setBlocks(next);
    },
    []
  );

  const activateSession = useCallback(
    async (sid: string) => {
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(LS_ACTIVE_SESSION, sid);
        const legacy = window.localStorage.getItem(CTX_LS);
        let ctx = window.localStorage.getItem(opCtxKey(sid));
        if (!ctx && legacy) {
          ctx = legacy;
          window.localStorage.setItem(opCtxKey(sid), legacy);
        }
        setOperatorContext(ctx ?? '');
      } else {
        setOperatorContext('');
      }
      setSessionId(sid);
      setToolEntries([]);
      setFeedLines([]);
      setStreaming('');
      const [detailRes] = await Promise.all([fetch(`/api/sessions/${sid}`), loadPersistedChat(sid)]);
      if (detailRes.ok) applySessionDetail((await detailRes.json()) as SessionDetail);
    },
    [applySessionDetail, loadPersistedChat]
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setSessionsLoading(true);
      setError(null);
      try {
        const listRes = await fetch('/api/sessions');
        if (!listRes.ok) throw new Error('Could not load sessions');
        const list = (await listRes.json()) as SessionListItem[];
        if (cancelled) return;
        setSessionsList(list);

        const saved =
          typeof window !== 'undefined' ? window.localStorage.getItem(LS_ACTIVE_SESSION) : null;
        let pick: string | null = null;
        if (saved && list.some((s) => s.id === saved)) pick = saved;
        else if (list.length > 0) pick = list[0].id;

        if (pick) {
          await activateSession(pick);
        } else {
          const cr = await fetch('/api/sessions', { method: 'POST', headers: { ...authHeaders() } });
          if (!cr.ok) {
            throw new Error(
              cr.status === 401
                ? 'Set Mutation API key (Settings) to create a new chat session'
                : 'Could not create session'
            );
          }
          const { id } = (await cr.json()) as { id: string };
          if (cancelled) return;
          if (typeof window !== 'undefined') window.localStorage.setItem(LS_ACTIVE_SESSION, id);
          setSessionId(id);
          setBlocks([]);
          setToolEntries([]);
          setFeedLines([]);
          const legacy = typeof window !== 'undefined' ? window.localStorage.getItem(CTX_LS) : null;
          if (legacy && typeof window !== 'undefined') window.localStorage.setItem(opCtxKey(id), legacy);
          setOperatorContext(legacy ?? '');
          const dRes = await fetch(`/api/sessions/${id}`);
          if (dRes.ok) applySessionDetail((await dRes.json()) as SessionDetail);
          await fetchSessionList();
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setSessionsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- bootstrap sessions once on mount
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

  const pushFeed = useCallback((tag: string, text: string) => {
    const id = `f-${++feedIdRef.current}`;
    setFeedLines((prev) => [...prev.slice(-200), { id, tag, text }]);
  }, []);

  /* ─── Send message ─── */
  const send = useCallback(async () => {
    if (!sessionId || !input.trim() || busy) return;
    const userMsg = input.trim();
    setInput('');
    setError(null);
    setBlocks((b) => [...b, { kind: 'user', text: userMsg }]);
    setStreaming('');
    setBusy(true);
    setToolEntries([]);
    setFeedLines([]);

    const controller = new AbortController();
    abortRef.current = controller;

    const activeTools = new Map<string, number>();

    try {
      if (typeof window !== 'undefined' && sessionId) {
        const t = operatorContext.trim();
        if (t) {
          window.localStorage.setItem(opCtxKey(sessionId), t);
          window.localStorage.setItem(CTX_LS, t);
        }
      }

      const res = await fetch(`/api/sessions/${sessionId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          content: userMsg,
          assessmentContext: operatorContext.trim() || undefined,
          llm: buildLlmPayload(),
        }),
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
          try {
            data = JSON.parse(line.slice(6)) as Record<string, unknown>;
          } catch {
            continue;
          }

          const type = data.type as string | undefined;

          if (type === 'sandbox_pull' && data.status === 'started' && Array.isArray(data.images)) {
            pushFeed('docker', `Pulling images: ${(data.images as string[]).join(', ')}`);
          }
          if (type === 'sandbox_pull' && data.status && data.status !== 'started') {
            pushFeed('docker', `Pull ${String(data.status)}${data.results ? ` — ${JSON.stringify(data.results)}` : ''}`);
          }
          if (type === 'network' && data.line) {
            pushFeed('net', String(data.line));
          }
          if (type === 'api' && data.url) {
            pushFeed('http', `${String(data.method ?? '?')} ${String(data.url)}`);
          }
          if (type === 'browser' && data.preview) {
            pushFeed('browser', String(data.preview).slice(0, 800));
          }

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
              setToolEntries((t) => [...t, { id: tid!, name, streaming: data.chunk as string }]);
            } else {
              setToolEntries((list) =>
                list.map((x) =>
                  x.id === tid ? { ...x, streaming: (x.streaming ?? '') + (data.chunk as string) } : x
                )
              );
            }
          }

          if (type === 'tool' && data.name) {
            const name = data.name as string;
            const result = (data.result as string) ?? '';
            const existingTid = activeTools.get(name);
            if (existingTid !== undefined) {
              setToolEntries((list) =>
                list.map((x) =>
                  x.id === existingTid ? { ...x, result, streaming: undefined, args: data.args as string | undefined } : x
                )
              );
              activeTools.delete(name);
            } else {
              const tid = ++toolIdSeq;
              setToolEntries((t) => [
                ...t,
                { id: tid, name, result, args: data.args as string | undefined },
              ]);
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
      } else {
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
      void fetchSessionList();
    }
  }, [sessionId, refreshFindings, buildLlmPayload, operatorContext, pushFeed, fetchSessionList]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

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
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const saveSandbox = async () => {
    if (!sessionId) return;
    setSandboxSaving(true);
    setError(null);
    try {
      const r = await fetch(`/api/sessions/${sessionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          sandboxEnableNovatrix,
          sandboxEnableExegol,
          sandboxNovatrixImage: sandboxNovatrixImage.trim() || null,
          sandboxExegolImage: sandboxExegolImage.trim() || null,
          sandboxDockerNetwork: sandboxDockerNetwork,
        }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error((j as { error?: string }).error ?? r.statusText);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSandboxSaving(false);
    }
  };

  const pullImages = async () => {
    if (!sessionId) return;
    setSandboxPulling(true);
    setError(null);
    try {
      const r = await fetch(`/api/sessions/${sessionId}/sandbox/pull`, {
        method: 'POST',
        headers: { ...authHeaders() },
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error((j as { error?: string }).error ?? r.statusText);
      pushFeed('docker', `Manual pull: ${JSON.stringify((j as { results?: unknown }).results ?? j)}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSandboxPulling(false);
    }
  };

  const openSession = useCallback(
    async (id: string) => {
      if (busy || id === sessionId) return;
      await activateSession(id);
      await fetchSessionList();
    },
    [activateSession, busy, fetchSessionList, sessionId]
  );

  const startNewChat = useCallback(async () => {
    if (busy) return;
    setError(null);
    try {
      const cr = await fetch('/api/sessions', { method: 'POST', headers: { ...authHeaders() } });
      if (!cr.ok) {
        throw new Error(
          cr.status === 401 ? 'Set Mutation API key (Settings) to create a chat' : 'Could not create chat'
        );
      }
      const { id } = (await cr.json()) as { id: string };
      await activateSession(id);
      await fetchSessionList();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [activateSession, busy, fetchSessionList]);

  const dockerMode = sandboxCfg?.sandboxMode === 'docker';

  const refLinks = useMemo(
    () =>
      [
        { label: 'OWASP Testing Guide', href: 'https://owasp.org/www-project-web-security-testing-guide/' },
        { label: 'OWASP Top 10', href: 'https://owasp.org/www-project-top-ten/' },
        { label: 'CWE — Weakness types', href: 'https://cwe.mitre.org/' },
        { label: 'Exegol docs (optional image)', href: 'https://docs.exegol.com/' },
        { label: 'Novatrix EXEGOL.md', href: 'https://github.com/MaramHarsha/Novatrix/blob/main/docs/EXEGOL.md' },
      ] as const,
    []
  );

  /* ─── Render ─── */
  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="header-left">
          <h1 className="logo">Novatrix</h1>
          <span className="tagline">Autonomous Security Assessment</span>
        </div>
        <div className="header-right">
          {sandboxCfg && (
            <span className={`mode-pill ${dockerMode ? 'mode-docker' : 'mode-mock'}`}>
              {dockerMode ? 'Docker sandbox' : 'Mock sandbox'}
            </span>
          )}
          {findings.length > 0 && (
            <span className="findings-badge">
              {findings.length} finding{findings.length > 1 ? 's' : ''}
            </span>
          )}
          <button
            type="button"
            className="icon-btn"
            onClick={() => setSettingsOpen(!settingsOpen)}
            title="LLM &amp; API keys"
          >
            <SettingsIcon />
          </button>
        </div>
      </header>

      {sandboxCfg && !dockerMode && (
        <div className="mock-warning" role="status">
          <strong>Mock sandbox active.</strong> ProjectDiscovery tools (nuclei, httpx, ffuf, …) and Exegol binaries{' '}
          <em>do not exist on the host</em>. For real tooling: set{' '}
          <code className="inline-code">SANDBOX_MODE=docker</code> in server env, build{' '}
          <code className="inline-code">novatrix-sandbox:latest</code>, pull{' '}
          <code className="inline-code">nwodtuhs/exegol:web-3.1.6</code> (or your tag), use <strong>bridge</strong> network, restart the app, then{' '}
          <strong>Pull images</strong> here.
        </div>
      )}

      <div className="main-area">
        <aside className="session-sidebar" aria-label="Chat history">
          <button
            type="button"
            className="new-chat-btn"
            onClick={() => void startNewChat()}
            disabled={busy || sessionsLoading}
          >
            + New chat
          </button>
          <div className="session-list">
            {sessionsLoading && sessionsList.length === 0 ? (
              <p className="session-loading">Loading chats…</p>
            ) : (
              sessionsList.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className={`session-item ${s.id === sessionId ? 'active' : ''}`}
                  onClick={() => void openSession(s.id)}
                  disabled={busy}
                >
                  <span className="session-title">{s.title?.trim() || 'New chat'}</span>
                  <span className="session-time">{formatChatTime(s.updatedAt)}</span>
                </button>
              ))
            )}
          </div>
        </aside>
        {/* Left rail — scope, methodology, sandbox (AIDA-style operator controls) */}
        <aside className="left-rail">
          <section className="rail-section">
            <h2 className="rail-h">Target &amp; scope</h2>
            <label className="rail-label">Allowed URL prefix</label>
            <input
              value={scopeUrl}
              onChange={(e) => setScopeUrl(e.target.value)}
              placeholder="https://app.example.com"
              className="input rail-input"
            />
            <button
              type="button"
              className="btn btn-sm rail-btn"
              onClick={() => void applyScope()}
              disabled={!sessionId || !scopeUrl.trim()}
            >
              Apply scope
            </button>
          </section>

          <section className="rail-section">
            <h2 className="rail-h">Operator context</h2>
            <p className="rail-hint">
              Sent to the model on every run (methodology notes, paste excerpts from writeups, constraints). Keeps the agent
              aligned with what you know—does not replace command output for proof.
            </p>
            <textarea
              value={operatorContext}
              onChange={(e) => {
                const v = e.target.value;
                setOperatorContext(v);
                if (typeof window !== 'undefined' && sessionId) {
                  window.localStorage.setItem(opCtxKey(sessionId), v);
                  window.localStorage.setItem(CTX_LS, v);
                }
              }}
              placeholder="e.g. Focus on OWASP A07 Auth; staging only; WAF may block aggressive ffuf; prefer nuclei first…"
              className="context-area"
              rows={6}
            />
          </section>

          <section className="rail-section rail-sandbox">
            <h2 className="rail-h">Sandbox profiles</h2>
            <p className="rail-hint">
              <strong>Novatrix</strong> is the default Tier-1 image (ProjectDiscovery stack). Enable <strong>Exegol</strong> for
              the large community image—set <code className="inline-code">SANDBOX_MODE=docker</code> on the server and pull tags
              from Docker Hub.
            </p>
            <label className="check-row">
              <input
                type="checkbox"
                checked={sandboxEnableNovatrix}
                onChange={(e) => setSandboxEnableNovatrix(e.target.checked)}
              />
              <span>Novatrix toolchain profile</span>
            </label>
            <label className="check-row">
              <input
                type="checkbox"
                checked={sandboxEnableExegol}
                onChange={(e) => setSandboxEnableExegol(e.target.checked)}
              />
              <span>Exegol profile (full image)</span>
            </label>
            <label className="rail-label">Novatrix image override</label>
            <input
              value={sandboxNovatrixImage}
              onChange={(e) => setSandboxNovatrixImage(e.target.value)}
              placeholder={sandboxCfg?.defaultNovatrixImage ?? 'novatrix-sandbox:latest'}
              className="input rail-input"
            />
            <label className="rail-label">Exegol image override</label>
            <input
              value={sandboxExegolImage}
              onChange={(e) => setSandboxExegolImage(e.target.value)}
              placeholder={sandboxCfg?.defaultExegolImage ?? 'nwodtuhs/exegol:web-3.1.6'}
              className="input rail-input"
            />
            <label className="rail-label">Container network</label>
            <select
              value={sandboxDockerNetwork}
              onChange={(e) => setSandboxDockerNetwork(e.target.value as 'none' | 'bridge')}
              className="input rail-input"
            >
              <option value="none">none (isolated)</option>
              <option value="bridge">bridge (outbound DNS/HTTP for scans)</option>
            </select>
            <div className="rail-actions">
              <button type="button" className="btn btn-primary btn-sm" disabled={!sessionId || sandboxSaving} onClick={() => void saveSandbox()}>
                {sandboxSaving ? 'Saving…' : 'Save sandbox'}
              </button>
              <button
                type="button"
                className="btn btn-sm"
                disabled={!sessionId || !dockerMode || sandboxPulling}
                onClick={() => void pullImages()}
                title={!dockerMode ? 'Set SANDBOX_MODE=docker on server' : 'docker pull configured images'}
              >
                {sandboxPulling ? 'Pulling…' : 'Pull images'}
              </button>
            </div>
          </section>

          <section className="rail-section">
            <h2 className="rail-h">Reference</h2>
            <ul className="ref-list">
              {refLinks.map((l) => (
                <li key={l.href}>
                  <a href={l.href} target="_blank" rel="noreferrer">
                    {l.label}
                  </a>
                </li>
              ))}
            </ul>
          </section>
        </aside>

        {settingsOpen && (
          <aside className="settings-drawer">
            <h2 className="drawer-title">LLM &amp; keys</h2>
            <div className="drawer-section">
              <label className="drawer-label">Provider</label>
              <select
                value={llmProvider}
                onChange={(e) => setLlmProvider(e.target.value as 'openai' | 'anthropic')}
                className="input"
              >
                <option value="openai">OpenAI-compatible</option>
                <option value="anthropic">Anthropic Claude</option>
              </select>
            </div>
            {llmProvider === 'openai' ? (
              <>
                <div className="drawer-section">
                  <label className="drawer-label">API Key</label>
                  <input
                    type="password"
                    value={llmOpenaiKey}
                    onChange={(e) => setLlmOpenaiKey(e.target.value)}
                    placeholder="sk-..."
                    className="input"
                  />
                </div>
                <div className="drawer-section">
                  <label className="drawer-label">Base URL</label>
                  <input
                    value={llmOpenaiBaseUrl}
                    onChange={(e) => setLlmOpenaiBaseUrl(e.target.value)}
                    placeholder="https://api.openai.com/v1"
                    className="input"
                  />
                </div>
                <div className="drawer-section">
                  <label className="drawer-label">Model</label>
                  <input
                    value={llmOpenaiModel}
                    onChange={(e) => setLlmOpenaiModel(e.target.value)}
                    placeholder="gpt-4o-mini"
                    className="input"
                  />
                </div>
              </>
            ) : (
              <>
                <div className="drawer-section">
                  <label className="drawer-label">API Key</label>
                  <input
                    type="password"
                    value={llmAnthropicKey}
                    onChange={(e) => setLlmAnthropicKey(e.target.value)}
                    placeholder="sk-ant-..."
                    className="input"
                  />
                </div>
                <div className="drawer-section">
                  <label className="drawer-label">Model</label>
                  <input
                    value={llmAnthropicModel}
                    onChange={(e) => setLlmAnthropicModel(e.target.value)}
                    placeholder="claude-opus-4-6"
                    className="input"
                  />
                </div>
              </>
            )}
            <div className="drawer-section">
              <label className="drawer-label">Mutation API Key (optional)</label>
              <input
                value={apiKeyInput}
                onChange={(e) => setApiKeyInput(e.target.value)}
                placeholder="Server MUTATION_API_KEY"
                className="input"
              />
            </div>
            <div className="drawer-section">
              <label className="drawer-label">Embedding model (memory)</label>
              <input
                value={llmEmbeddingModel}
                onChange={(e) => setLlmEmbeddingModel(e.target.value)}
                placeholder="text-embedding-3-small"
                className="input"
              />
            </div>
            <div className="drawer-actions">
              <button type="button" className="btn btn-primary" onClick={saveSettings}>
                Save &amp; Close
              </button>
              <button type="button" className="btn" onClick={() => setSettingsOpen(false)}>
                Cancel
              </button>
            </div>
          </aside>
        )}

        <main className="chat-main">
          <div className="chat-messages">
            {blocks.length === 0 && !busy && (
              <div className="empty-state">
                <h2>Assessment console</h2>
                <p>
                  Configure scope and sandbox profiles on the left. Use the <strong>Live console</strong> on the right for
                  streamed tool output—similar to an IDE output panel or Warp-style split view.
                </p>
                <p className="hint">
                  Findings require <strong>evidence</strong> (tool output, HTTP excerpts); the model is instructed not to claim
                  issues without proof.
                </p>
                <p className="hint">
                  LLM keys:{' '}
                  <button type="button" className="link-btn" onClick={() => setSettingsOpen(true)}>
                    Settings
                  </button>
                </p>
              </div>
            )}

            {blocks.map((block, i) => {
              if (block.kind === 'user') return <UserMsg key={`u-${i}`} text={block.text} />;
              if (block.kind === 'assistant') return <AssistantMsg key={`a-${i}`} text={block.text} />;
              if (block.kind === 'finding') return <FindingBlock key={`fi-${i}`} finding={block.data} />;
              if (block.kind === 'error') return <ErrorBlock key={`e-${i}`} text={block.text} />;
              return null;
            })}

            {streaming && <AssistantMsg text={streaming} live />}

            <div ref={chatEndRef} />
          </div>

          <div className="input-bar">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && void send()}
              placeholder={sessionId ? 'Objective, command intent, or question…' : 'Initializing session…'}
              disabled={!sessionId || busy}
              className="chat-input"
            />
            {busy ? (
              <button type="button" className="btn btn-danger" onClick={stop}>
                Stop
              </button>
            ) : (
              <button type="button" className="btn btn-primary" onClick={() => void send()} disabled={!sessionId || !input.trim()}>
                Send
              </button>
            )}
          </div>
        </main>

        {/* Right: IDE-style live console (terminal-heavy UX) */}
        <aside className="console-panel" aria-label="Live console">
          <div className="console-header">
            <span className="console-title">Live console</span>
            <span className="console-sub">Tools, Docker pull, HTTP — stream</span>
          </div>
          <div className="console-body">
            {feedLines.map((f) => (
              <div key={f.id} className={`feed-line feed-${f.tag}`}>
                <span className="feed-tag">{f.tag}</span>
                <pre className="feed-text">{f.text}</pre>
              </div>
            ))}
            {toolEntries.map((t) => (
              <ToolConsoleBlock key={t.id} tool={t} />
            ))}
            {busy && toolEntries.length === 0 && feedLines.length === 0 && (
              <p className="console-placeholder">Waiting for tool output…</p>
            )}
            {!busy && toolEntries.length === 0 && feedLines.length === 0 && (
              <p className="console-placeholder muted">
                Output from <code className="inline-code">terminal_exec</code>, pull steps, and HTTP lines appears here.
              </p>
            )}
            <div ref={consoleEndRef} />
          </div>
        </aside>
      </div>

      {error && (
        <div className="global-error">
          <span>{error}</span>
          <button type="button" className="error-dismiss" onClick={() => setError(null)}>
            ×
          </button>
        </div>
      )}

      {findings.length > 0 && (
        <div className="findings-strip">
          <strong>Findings</strong>
          <div className="findings-strip-inner">
            {findings.map((f) => (
              <span key={f.id} className="finding-chip" title={f.description}>
                <span className="finding-chip-title">{f.title}</span>
                <span className={`sev sev-${f.severity}`}>{f.severity}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      <style>{styles}</style>
    </div>
  );
}

function ToolConsoleBlock({ tool }: { tool: ToolEntry }) {
  const out = tool.result ?? tool.streaming ?? '';
  const running = !tool.result && !!tool.streaming;
  return (
    <div className={`console-tool ${running ? 'is-running' : ''}`}>
      <div className="console-tool-head">
        <span className="console-tool-icon">{running ? '⏳' : '▶'}</span>
        <code className="console-tool-name">{tool.name}</code>
        {tool.args && <span className="console-tool-args">{tool.args.slice(0, 120)}{tool.args.length > 120 ? '…' : ''}</span>}
      </div>
      <pre className="console-tool-out">{out || (running ? '…' : '(no output)')}</pre>
    </div>
  );
}

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

function FindingBlock({ finding }: { finding: Finding }) {
  return (
    <div className="finding-inline">
      <div className="finding-inline-header">
        <span className="finding-inline-icon">✓</span>
        <strong>{finding.title}</strong>
        <span className={`sev sev-${finding.severity}`}>{finding.severity}</span>
      </div>
      <p className="finding-inline-desc">{finding.description}</p>
      {finding.evidence ? (
        <pre className="finding-evidence-block">{finding.evidence}</pre>
      ) : (
        finding.severity !== 'info' && <p className="evidence-missing">No evidence stored — flag for review.</p>
      )}
    </div>
  );
}

function ErrorBlock({ text }: { text: string }) {
  return (
    <div className="msg msg-error">
      <div className="msg-avatar error-avatar">!</div>
      <div className="msg-body">
        <pre className="msg-text error-text">{text}</pre>
      </div>
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
  padding: 10px 16px;
  border-bottom: 1px solid var(--border);
  background: var(--panel);
  flex-shrink: 0;
}
.header-left { display: flex; align-items: baseline; gap: 12px; }
.logo { margin: 0; font-size: 1.1rem; font-weight: 700; color: var(--text); }
.tagline { font-size: 0.8rem; color: var(--muted); }
.header-right { display: flex; align-items: center; gap: 10px; }
.mode-pill {
  font-size: 0.7rem;
  padding: 3px 8px;
  border-radius: 999px;
  font-weight: 600;
}
.mode-docker { background: #1f3a2f; color: var(--success); }
.mode-mock { background: #2a2a1f; color: var(--warning); }
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

.mock-warning {
  padding: 10px 16px;
  background: #2a2110;
  border-bottom: 1px solid #9e6a03;
  color: #f0c14a;
  font-size: 0.82rem;
  line-height: 1.45;
  flex-shrink: 0;
}
.mock-warning strong { color: #fff; }
.mock-warning em { color: #d29922; }

.main-area {
  display: flex;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.session-sidebar {
  width: 232px;
  flex-shrink: 0;
  border-right: 1px solid var(--border);
  background: #010409;
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.new-chat-btn {
  margin: 12px 12px 8px;
  padding: 10px 12px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: #21262d;
  color: var(--text);
  font-size: 0.88rem;
  font-weight: 600;
  cursor: pointer;
  text-align: left;
}
.new-chat-btn:hover:not(:disabled) { background: #30363d; }
.new-chat-btn:disabled { opacity: 0.45; cursor: not-allowed; }
.session-list {
  flex: 1;
  overflow-y: auto;
  padding: 0 8px 16px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.session-loading {
  font-size: 0.78rem;
  color: var(--muted);
  padding: 8px 10px;
  margin: 0;
}
.session-item {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  width: 100%;
  padding: 10px 10px;
  border-radius: 8px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--text);
  cursor: pointer;
  text-align: left;
  font-family: inherit;
}
.session-item:hover:not(:disabled) { background: #161b22; }
.session-item.active {
  background: #1c2128;
  border-color: #30363d;
}
.session-item:disabled { opacity: 0.5; cursor: not-allowed; }
.session-title {
  font-size: 0.82rem;
  font-weight: 500;
  line-height: 1.35;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  width: 100%;
}
.session-time {
  font-size: 0.68rem;
  color: var(--muted);
}

.left-rail {
  width: 280px;
  flex-shrink: 0;
  border-right: 1px solid var(--border);
  background: #0d1117;
  overflow-y: auto;
  padding: 12px 14px 24px;
}
.rail-section { margin-bottom: 20px; }
.rail-h {
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--muted);
  margin: 0 0 8px;
  font-weight: 600;
}
.rail-label { display: block; font-size: 0.75rem; color: var(--muted); margin-bottom: 4px; }
.rail-hint {
  font-size: 0.78rem;
  color: var(--muted);
  line-height: 1.45;
  margin: 0 0 8px;
}
.rail-input { margin-bottom: 6px; }
.rail-btn { width: 100%; margin-top: 6px; }
.context-area {
  width: 100%;
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--text);
  font-size: 0.8rem;
  line-height: 1.45;
  resize: vertical;
  min-height: 100px;
}
.check-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.82rem;
  margin-bottom: 6px;
  cursor: pointer;
}
.check-row input { accent-color: #238636; }
.rail-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 10px;
}
.inline-code {
  font-family: ui-monospace, monospace;
  font-size: 0.78em;
  background: #21262d;
  padding: 1px 5px;
  border-radius: 4px;
}
.ref-list {
  margin: 0;
  padding-left: 18px;
  font-size: 0.8rem;
}
.ref-list a { color: var(--accent); }

/* Settings drawer */
.settings-drawer {
  width: 300px;
  flex-shrink: 0;
  border-right: 1px solid var(--border);
  background: var(--panel);
  padding: 16px;
  overflow-y: auto;
}
.drawer-title { font-size: 0.95rem; margin: 0 0 14px; font-weight: 600; }
.drawer-section { margin-bottom: 14px; }
.drawer-label { display: block; font-size: 0.75rem; color: var(--muted); margin-bottom: 4px; font-weight: 500; }
.drawer-actions { display: flex; gap: 8px; margin-top: 16px; }

.chat-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.chat-messages {
  flex: 1;
  overflow-y: auto;
  padding: 16px 0;
}
.empty-state {
  text-align: center;
  margin-top: 12vh;
  color: var(--muted);
  padding: 0 20px;
}
.empty-state h2 { color: var(--text); font-size: 1.25rem; margin-bottom: 8px; font-weight: 600; }
.empty-state p { max-width: 520px; margin: 0 auto 10px; font-size: 0.88rem; line-height: 1.5; }
.hint { font-size: 0.82rem; }
.link-btn { background: none; border: none; color: var(--accent); cursor: pointer; font-size: inherit; text-decoration: underline; }

.msg {
  display: flex;
  gap: 12px;
  padding: 12px 20px;
  max-width: 920px;
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
  font-size: 0.88rem;
  line-height: 1.55;
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

.finding-inline {
  max-width: 920px;
  margin: 8px auto;
  width: 100%;
  padding: 0 20px 0 56px;
}
.finding-inline-header {
  display: flex;
  align-items: center;
  gap: 8px;
  background: #152238;
  border: 1px solid #1f6feb44;
  border-radius: 8px 8px 0 0;
  padding: 10px 14px;
  font-size: 0.85rem;
}
.finding-inline-desc {
  margin: 0;
  padding: 10px 14px;
  background: #0d1520;
  border: 1px solid #1f6feb44;
  border-top: none;
  border-radius: 0;
  font-size: 0.82rem;
  color: var(--muted);
}
.finding-evidence-block {
  margin: 0;
  padding: 10px 14px;
  background: #010409;
  border: 1px solid #1f6feb44;
  border-top: none;
  border-radius: 0 0 8px 8px;
  font-size: 0.76rem;
  font-family: ui-monospace, SFMono-Regular, monospace;
  color: #8b949e;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 280px;
  overflow: auto;
}
.evidence-missing { margin: 0; padding: 8px 14px; font-size: 0.75rem; color: #d29922; background: #1c1408; border: 1px solid #a8821444; border-top: none; border-radius: 0 0 8px 8px; }

.console-panel {
  width: min(440px, 42vw);
  min-width: 300px;
  flex-shrink: 0;
  border-left: 1px solid var(--border);
  background: #010409;
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.console-header {
  padding: 10px 14px;
  border-bottom: 1px solid var(--border);
  background: var(--panel);
}
.console-title { font-size: 0.8rem; font-weight: 600; display: block; }
.console-sub { font-size: 0.72rem; color: var(--muted); }
.console-body {
  flex: 1;
  overflow-y: auto;
  padding: 10px;
}
.console-placeholder { font-size: 0.78rem; color: var(--muted); padding: 8px; }
.console-placeholder.muted { opacity: 0.85; }
.feed-line {
  margin-bottom: 8px;
  font-size: 0.72rem;
  border-radius: 6px;
  overflow: hidden;
  border: 1px solid #21262d;
}
.feed-tag {
  display: block;
  padding: 2px 8px;
  font-size: 0.65rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  background: #161b22;
  color: var(--accent);
}
.feed-text {
  margin: 0;
  padding: 6px 8px;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: ui-monospace, SFMono-Regular, monospace;
  color: #8b949e;
  font-size: 0.72rem;
}
.feed-docker .feed-tag { color: #58a6ff; }
.feed-net .feed-tag { color: #3fb950; }
.feed-http .feed-tag { color: #d29922; }
.feed-browser .feed-tag { color: #a371f7; }

.console-tool {
  margin-bottom: 12px;
  border-radius: 8px;
  border: 1px solid #30363d;
  overflow: hidden;
  background: #0d1117;
}
.console-tool.is-running { border-color: #1f6feb88; box-shadow: 0 0 0 1px #1f6feb33; }
.console-tool-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  background: #161b22;
  font-size: 0.75rem;
  flex-wrap: wrap;
}
.console-tool-icon { font-size: 0.85rem; }
.console-tool-name { color: var(--accent); font-size: 0.8rem; }
.console-tool-args { color: var(--muted); font-size: 0.72rem; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.console-tool-out {
  margin: 0;
  padding: 10px 12px;
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 0.74rem;
  line-height: 1.45;
  color: #c9d1d9;
  white-space: pre-wrap;
  word-break: break-all;
  max-height: min(55vh, 480px);
  overflow: auto;
}

.input-bar {
  display: flex;
  gap: 10px;
  padding: 12px 20px;
  border-top: 1px solid var(--border);
  background: var(--panel);
  flex-shrink: 0;
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
}
.chat-input:focus { border-color: var(--accent); }
.chat-input:disabled { opacity: 0.5; }

.btn {
  padding: 8px 16px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: #21262d;
  color: var(--text);
  cursor: pointer;
  font-size: 0.85rem;
  font-weight: 500;
}
.btn:hover { background: #30363d; }
.btn:disabled { opacity: 0.4; cursor: not-allowed; }
.btn-sm { padding: 5px 12px; font-size: 0.78rem; }
.btn-primary { background: #238636; border-color: #2ea043; color: #fff; }
.btn-primary:hover { background: #2ea043; }
.btn-danger { background: #da3633; border-color: #f85149; color: #fff; }

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

.findings-strip {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 16px;
  border-top: 1px solid var(--border);
  background: #0d1117;
  font-size: 0.78rem;
  flex-shrink: 0;
  overflow: hidden;
}
.findings-strip strong { color: var(--muted); flex-shrink: 0; }
.findings-strip-inner {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  flex: 1;
  min-width: 0;
}
.finding-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: 999px;
  background: #161b22;
  border: 1px solid var(--border);
  white-space: nowrap;
}
.finding-chip-title { max-width: 200px; overflow: hidden; text-overflow: ellipsis; }

.sev { font-size: 0.65rem; padding: 2px 6px; border-radius: 8px; font-weight: 600; }
.sev-critical { background: #4d1f1f; color: #f85149; }
.sev-high { background: #3d2a0f; color: #fb923c; }
.sev-medium { background: #3d340f; color: #d29922; }
.sev-low { background: #1a3d1a; color: #3fb950; }
.sev-info { background: #1c2128; color: #8b949e; }

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
}

@media (max-width: 1100px) {
  .console-panel { width: 340px; min-width: 260px; }
  .left-rail { width: 240px; }
}
@media (max-width: 900px) {
  .main-area { flex-direction: column; overflow-y: auto; }
  .session-sidebar {
    width: 100%;
    max-height: 34vh;
    border-right: none;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }
  .session-list { max-height: 22vh; }
  .left-rail {
    width: 100%;
    border-right: none;
    border-bottom: 1px solid var(--border);
    max-height: 38vh;
    flex-shrink: 0;
  }
  .chat-main { min-height: 42vh; }
  .console-panel {
    width: 100%;
    min-width: 0;
    border-left: none;
    border-top: 1px solid var(--border);
    max-height: 40vh;
  }
}
`;
