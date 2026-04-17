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

const LLM_LS = {
  provider: 'NOVATRIX_LLM_PROVIDER',
  openaiKey: 'NOVATRIX_OPENAI_API_KEY',
  openaiBaseUrl: 'NOVATRIX_OPENAI_BASE_URL',
  openaiModel: 'NOVATRIX_OPENAI_MODEL',
  anthropicKey: 'NOVATRIX_ANTHROPIC_API_KEY',
  anthropicModel: 'NOVATRIX_ANTHROPIC_MODEL',
  embeddingModel: 'NOVATRIX_EMBEDDING_MODEL',
} as const;

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
  const [sbDefaults, setSbDefaults] = useState<{
    sandboxMode: string;
    defaultNovatrixImage: string;
    defaultExegolImage: string;
    defaultDockerNetwork: string;
  } | null>(null);
  const [sbNovatrixEnabled, setSbNovatrixEnabled] = useState(true);
  const [sbExegolEnabled, setSbExegolEnabled] = useState(false);
  const [sbNovatrixImage, setSbNovatrixImage] = useState('');
  const [sbExegolImage, setSbExegolImage] = useState('');
  const [sbNetwork, setSbNetwork] = useState('');
  const [sbSaving, setSbSaving] = useState(false);
  const [sbPulling, setSbPulling] = useState(false);
  const [llmProvider, setLlmProvider] = useState<'openai' | 'anthropic'>('openai');
  const [llmOpenaiKey, setLlmOpenaiKey] = useState('');
  const [llmOpenaiBaseUrl, setLlmOpenaiBaseUrl] = useState('');
  const [llmOpenaiModel, setLlmOpenaiModel] = useState('');
  const [llmAnthropicKey, setLlmAnthropicKey] = useState('');
  const [llmAnthropicModel, setLlmAnthropicModel] = useState('');
  const [llmEmbeddingModel, setLlmEmbeddingModel] = useState('');

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

  useEffect(() => {
    if (!sessionId) return;
    void (async () => {
      try {
        const [cfgRes, sessRes] = await Promise.all([
          fetch('/api/sandbox-config'),
          fetch(`/api/sessions/${sessionId}`),
        ]);
        if (cfgRes.ok) {
          const cfg = (await cfgRes.json()) as {
            sandboxMode: string;
            defaultNovatrixImage: string;
            defaultExegolImage: string;
            defaultDockerNetwork: string;
          };
          setSbDefaults(cfg);
        }
        if (sessRes.ok) {
          const sess = (await sessRes.json()) as {
            sandboxEnableNovatrix?: boolean;
            sandboxEnableExegol?: boolean;
            sandboxNovatrixImage?: string | null;
            sandboxExegolImage?: string | null;
            sandboxDockerNetwork?: string | null;
          };
          setSbNovatrixEnabled(sess.sandboxEnableNovatrix !== false);
          setSbExegolEnabled(!!sess.sandboxEnableExegol);
          setSbNovatrixImage(sess.sandboxNovatrixImage ?? '');
          setSbExegolImage(sess.sandboxExegolImage ?? '');
          setSbNetwork(sess.sandboxDockerNetwork ?? '');
        }
      } catch {
        /* ignore */
      }
    })();
  }, [sessionId]);

  const saveApiKey = () => {
    window.localStorage.setItem('MUTATION_API_KEY', apiKeyInput.trim());
    setError(null);
  };

  const saveLlmToBrowser = () => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(LLM_LS.provider, llmProvider);
    window.localStorage.setItem(LLM_LS.openaiKey, llmOpenaiKey);
    window.localStorage.setItem(LLM_LS.openaiBaseUrl, llmOpenaiBaseUrl);
    window.localStorage.setItem(LLM_LS.openaiModel, llmOpenaiModel);
    window.localStorage.setItem(LLM_LS.anthropicKey, llmAnthropicKey);
    window.localStorage.setItem(LLM_LS.anthropicModel, llmAnthropicModel);
    window.localStorage.setItem(LLM_LS.embeddingModel, llmEmbeddingModel);
    setError(null);
  };

  const buildLlmRequestPayload = useCallback(() => {
    const llm: Record<string, string> = { provider: llmProvider };
    if (llmOpenaiKey.trim()) llm.openaiApiKey = llmOpenaiKey.trim();
    if (llmOpenaiBaseUrl.trim()) llm.openaiBaseUrl = llmOpenaiBaseUrl.trim();
    if (llmOpenaiModel.trim()) llm.openaiModel = llmOpenaiModel.trim();
    if (llmAnthropicKey.trim()) llm.anthropicApiKey = llmAnthropicKey.trim();
    if (llmAnthropicModel.trim()) llm.anthropicModel = llmAnthropicModel.trim();
    if (llmEmbeddingModel.trim()) llm.embeddingModel = llmEmbeddingModel.trim();
    return llm;
  }, [
    llmProvider,
    llmOpenaiKey,
    llmOpenaiBaseUrl,
    llmOpenaiModel,
    llmAnthropicKey,
    llmAnthropicModel,
    llmEmbeddingModel,
  ]);

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

  const saveSandboxSettings = async () => {
    if (!sessionId) return;
    setSbSaving(true);
    setError(null);
    try {
      const r = await fetch(`/api/sessions/${sessionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          sandboxEnableNovatrix: sbNovatrixEnabled,
          sandboxEnableExegol: sbExegolEnabled,
          sandboxNovatrixImage: sbNovatrixImage.trim() || null,
          sandboxExegolImage: sbExegolImage.trim() || null,
          sandboxDockerNetwork: sbNetwork.trim() ? sbNetwork.trim() : null,
        }),
      });
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? 'Sandbox save failed');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSbSaving(false);
    }
  };

  const pullSandboxImagesNow = async () => {
    if (!sessionId) return;
    setSbPulling(true);
    setError(null);
    try {
      const r = await fetch(`/api/sessions/${sessionId}/sandbox/pull`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({}),
      });
      const j = (await r.json()) as { results?: { image: string; ok: boolean; error?: string }[]; error?: string };
      if (!r.ok) throw new Error(j.error ?? 'Pull failed');
      const lines = (j.results ?? []).map((x) => `${x.image}: ${x.ok ? 'ok' : x.error ?? 'fail'}`).join('\n');
      setTerminalLog((t) => `${t}\n\n--- docker pull (manual) ---\n${lines}\n`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSbPulling(false);
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
        body: JSON.stringify({ content: userMsg, llm: buildLlmRequestPayload() }),
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
            status?: string;
            images?: string[];
            results?: { image: string; ok: boolean; error?: string }[];
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
          if (data.type === 'sandbox_pull') {
            const detail =
              data.status === 'started'
                ? `pull started: ${(data.images ?? []).join(', ')}`
                : `pull ${data.status ?? ''}: ${JSON.stringify(data.results ?? [])}`;
            setTerminalLog((t) => `${t}\n[sandbox] ${detail}\n`);
          }
          if (data.type === 'error') {
            const errText = data.message ?? 'Unknown error';
            setError(errText);
            assistant += `\n⚠ Agent error: ${errText}`;
            setStreaming(assistant);
          }
          if (data.type === 'done' && data.runId) {
            setLastRunId(data.runId);
            void refreshFindings(sessionId);
          }
        }
      }

      setMessages((m) => [...m, { role: 'assistant', content: assistant || (error ? `⚠ ${error}` : '(empty response — check LLM keys & model in sidebar)') }]);
      setStreaming('');
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      setError(errMsg);
      setMessages((m) => [...m, { role: 'assistant', content: `⚠ Error: ${errMsg}` }]);
    } finally {
      setBusy(false);
    }
  }, [sessionId, input, busy, refreshFindings, buildLlmRequestPayload]);

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
            HTTP/API trace, evidence-backed findings. Set LLM keys and models in the sidebar (stored in the browser) or
            via server <code>.env</code>; optional <code>MUTATION_API_KEY</code> for mutating APIs; configure scope below.
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

          <div style={{ fontSize: '0.72rem', color: 'var(--muted)', margin: '1rem 0 0.35rem' }}>LLM (browser only)</div>
          <p style={{ fontSize: '0.68rem', color: 'var(--muted)', margin: '0 0 0.4rem' }}>
            Keys and models are stored in <code>localStorage</code> and sent with each chat request (not written to{' '}
            <code>.env</code>). Use HTTPS in production. Switching provider or model keeps the same session transcript so
            the next model sees prior user/assistant turns.
          </p>
          <select
            value={llmProvider}
            onChange={(e) => setLlmProvider(e.target.value as 'openai' | 'anthropic')}
            style={{ ...inputStyle, marginBottom: '0.35rem' }}
          >
            <option value="openai">OpenAI-compatible</option>
            <option value="anthropic">Anthropic Claude</option>
          </select>
          <input
            type="password"
            value={llmOpenaiKey}
            onChange={(e) => setLlmOpenaiKey(e.target.value)}
            placeholder="OpenAI API key (or ollama / LiteLLM key)"
            style={{ ...inputStyle, marginBottom: '0.35rem' }}
          />
          <input
            value={llmOpenaiBaseUrl}
            onChange={(e) => setLlmOpenaiBaseUrl(e.target.value)}
            placeholder="OpenAI base URL (empty = https://api.openai.com/v1)"
            style={{ ...inputStyle, marginBottom: '0.35rem' }}
          />
          <input
            value={llmOpenaiModel}
            onChange={(e) => setLlmOpenaiModel(e.target.value)}
            placeholder="OpenAI model id (e.g. gpt-4o-mini)"
            style={{ ...inputStyle, marginBottom: '0.35rem' }}
          />
          <input
            type="password"
            value={llmAnthropicKey}
            onChange={(e) => setLlmAnthropicKey(e.target.value)}
            placeholder="Anthropic API key"
            style={{ ...inputStyle, marginBottom: '0.35rem' }}
          />
          <input
            value={llmAnthropicModel}
            onChange={(e) => setLlmAnthropicModel(e.target.value)}
            placeholder="Anthropic model (e.g. claude-opus-4-6)"
            style={{ ...inputStyle, marginBottom: '0.35rem' }}
          />
          <input
            value={llmEmbeddingModel}
            onChange={(e) => setLlmEmbeddingModel(e.target.value)}
            placeholder="Embedding model (OpenAI-compatible; optional)"
            style={{ ...inputStyle, marginBottom: '0.35rem' }}
          />
          <button type="button" onClick={saveLlmToBrowser} style={{ ...btnStyle, width: '100%' }}>
            Save LLM settings to browser
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

          <div style={{ fontSize: '0.72rem', color: 'var(--muted)', margin: '1rem 0 0.35rem' }}>Sandbox (per session)</div>
          <p style={{ fontSize: '0.68rem', color: 'var(--muted)', margin: '0 0 0.4rem' }}>
            Server <code>SANDBOX_MODE</code>: {sbDefaults?.sandboxMode ?? '…'}. When mode is <code>docker</code>, the first
            chat run pulls configured images automatically. Enable both Novatrix and Exegol so the model can choose{' '}
            <code>sandbox_profile</code> per command.
          </p>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.8rem', marginBottom: '0.25rem' }}>
            <input
              type="checkbox"
              checked={sbNovatrixEnabled}
              onChange={(e) => setSbNovatrixEnabled(e.target.checked)}
              disabled={!sessionId}
            />
            Novatrix (Tier-1 tools)
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.8rem', marginBottom: '0.45rem' }}>
            <input
              type="checkbox"
              checked={sbExegolEnabled}
              onChange={(e) => setSbExegolEnabled(e.target.checked)}
              disabled={!sessionId}
            />
            Exegol (full image)
          </label>
          <input
            value={sbNovatrixImage}
            onChange={(e) => setSbNovatrixImage(e.target.value)}
            placeholder={`Novatrix image (empty = server default${sbDefaults ? `: ${sbDefaults.defaultNovatrixImage}` : ''})`}
            disabled={!sessionId}
            style={{ ...inputStyle, marginBottom: '0.35rem' }}
          />
          <input
            value={sbExegolImage}
            onChange={(e) => setSbExegolImage(e.target.value)}
            placeholder={`Exegol image (empty = ${sbDefaults?.defaultExegolImage ?? 'nwodtuhs/exegol:web'})`}
            disabled={!sessionId}
            style={{ ...inputStyle, marginBottom: '0.35rem' }}
          />
          <select
            value={sbNetwork}
            onChange={(e) => setSbNetwork(e.target.value)}
            disabled={!sessionId}
            style={{ ...inputStyle, marginBottom: '0.35rem' }}
          >
            <option value="">Docker network (server default{sbDefaults ? `: ${sbDefaults.defaultDockerNetwork}` : ''})</option>
            <option value="none">none (no outbound)</option>
            <option value="bridge">bridge (Internet)</option>
          </select>
          <button
            type="button"
            onClick={() => void saveSandboxSettings()}
            disabled={!sessionId || sbSaving}
            style={{ ...btnStyle, marginTop: '0.2rem', width: '100%' }}
          >
            {sbSaving ? 'Saving…' : 'Save sandbox settings'}
          </button>
          <button
            type="button"
            onClick={() => void pullSandboxImagesNow()}
            disabled={!sessionId || sbPulling || sbDefaults?.sandboxMode !== 'docker'}
            style={{ ...btnStyle, marginTop: '0.35rem', width: '100%' }}
          >
            {sbPulling ? 'Pulling…' : 'Pull images now (docker)'}
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
