import { useEffect, useRef, useState } from 'react';
import type { AppState } from './App';
import { api } from './api';

type Props = { data: AppState; act: (work: () => Promise<unknown>) => Promise<void> };
type Provider = 'openai' | 'ollama' | 'freellmapi' | 'custom';
type Protocol = 'responses' | 'gemini_generate_content' | 'ollama_chat' | 'chat_completions';
type Draft = { model: string; baseUrl: string; apiKey: string; protocol: Protocol; customName?: string; windowsBridge?: boolean; freeRouteAllowed?: boolean; ownerManagedRoute?: boolean };
const defaults: Record<Provider, Draft> = {
  custom: { model: 'nvidia/nemotron-3.5-lightning-30b-a3b', baseUrl: 'https://integrate.api.nvidia.com/v1', apiKey: '', protocol: 'chat_completions', customName: 'NVIDIA Build', ownerManagedRoute: false, windowsBridge: false },
  openai: { model: '', baseUrl: 'https://api.openai.com/v1', apiKey: '', protocol: 'responses' },
  ollama: { model: 'qwen2.5:1.5b', baseUrl: 'http://127.0.0.1:11434', apiKey: '', protocol: 'ollama_chat', windowsBridge: true },
  freellmapi: { model: '', baseUrl: 'http://127.0.0.1:31415/v1', apiKey: '', protocol: 'chat_completions', windowsBridge: true, freeRouteAllowed: false },
};
const isProvider = (value: unknown): value is Provider => value === 'openai' || value === 'ollama' || value === 'freellmapi' || value === 'custom';
const statuses = ['awaiting_configuration', 'configured_unverified', 'connected', 'connection_failed', 'disconnected', 'unsupported'];

export function AIProviderPanel({ data, act }: Props) {
  const [open, setOpen] = useState(() => location.hash.endsWith('/ai-provider'));
  const configure = useRef<HTMLButtonElement>(null);
  const disconnecting = useRef(false);
  const [busy, setBusy] = useState(false);
  const providerLabel = data.ai?.provider === 'custom' ? data.ai.customName || 'NVIDIA Build / Custom provider' : data.ai?.provider === 'ollama' ? 'Ollama' : data.ai?.provider === 'freellmapi' ? 'FreeLLMAPI' : data.ai?.provider === 'openai' ? 'OpenAI' : 'Legacy provider';
  return <>
    <h3>AI provider <span className="pill">{typeof data.ai?.status === 'string' ? data.ai.status.replaceAll('_', ' ') : 'awaiting configuration'}</span></h3>
    <p>{providerLabel}{data.ai?.model ? ' · ' + data.ai.model : ''}. Choose a preset or add your own OpenAI-compatible provider. Credentials stay server-side.</p>
    <button ref={configure} type="button" className="primary" aria-expanded={open} onClick={() => { setOpen(true); history.replaceState(null, '', location.hash.split('/')[0] + '/ai-provider'); }}>{data.ai?.configured ? 'Manage AI provider' : 'Configure AI provider'}</button>
    {!open && data.ai?.configured && <button type="button" disabled={busy} onClick={() => { if (disconnecting.current) return; disconnecting.current = true; setBusy(true); void act(() => api('/integrations/model/disconnect', 'POST')).finally(() => { disconnecting.current = false; setBusy(false); }); }}>Disconnect AI provider</button>}
    {typeof data.ai?.lastError === 'string' && <p className="error">{data.ai.lastError}</p>}
    {data.ai?.runtimeFault && <p className="error" role="status">Last live model request: {data.ai.runtimeFault.message}{data.ai.runtimeFault.httpStatus ? ' (HTTP ' + data.ai.runtimeFault.httpStatus + ')' : ''}. Saved connection-test status is separate; local actions remain available.</p>}
    {data.ai?.lastDiagnostics && <details><summary className="hint">Connection diagnostics · sanitized metadata</summary><pre className="task-result">{JSON.stringify(data.ai.lastDiagnostics, null, 2)}</pre></details>}
    {open && <AISetup data={data} act={act} onClose={() => { setOpen(false); history.replaceState(null, '', location.hash.split('/')[0]); configure.current?.focus(); }} />}
  </>;
}

function AISetup({ data, act, onClose }: Props & { onClose: () => void }) {
  const ai = data.ai;
  const [provider, setProvider] = useState<Provider>(isProvider(ai?.provider) ? ai.provider : 'custom');
  const [drafts, setDrafts] = useState<Record<Provider, Draft>>(() => {
    const values = structuredClone(defaults);
    const selected: unknown = ai?.provider;
    if (isProvider(selected)) values[selected] = {
      ...values[selected],
      model: typeof ai.model === 'string' ? ai.model : values[selected].model,
      baseUrl: typeof ai.baseUrl === 'string' ? ai.baseUrl : values[selected].baseUrl,
      protocol: (typeof ai.protocol === 'string' ? ai.protocol : values[selected].protocol) as Protocol,
      apiKey: '',
      windowsBridge: ai.windowsBridge,
      freeRouteAllowed: ai.freeRouteAllowed,
      customName: ai.customName || values[selected].customName,
      ownerManagedRoute: ai.ownerManagedRoute,
    };
    return values;
  });
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<{ text: string; kind: 'note' | 'error' | 'success' } | null>(null);
  const form = useRef<HTMLFormElement>(null);
  const inFlight = useRef<AbortController | null>(null);
  const draft = drafts[provider];
  const [routing, setRouting] = useState<any>(null);
  const [models, setModels] = useState<any[]>([]);
  const edited = useRef(new Set<Provider>());
  const localEndpoint = /^http:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::|\/|$)/i.test(draft.baseUrl);

  useEffect(() => { void api('/integrations/model/routing').then(setRouting).catch(() => {}); }, []);
  useEffect(() => {
    const controller = new AbortController();
    void api('/integrations/model/profiles', 'GET', undefined, { signal: controller.signal }).then((profiles: any[]) => setDrafts(values => {
      const next = { ...values };
      for (const profile of profiles) {
        const name: unknown = profile.provider;
        if (isProvider(name) && !edited.current.has(name)) next[name] = { ...next[name], model: profile.model, baseUrl: profile.baseUrl, protocol: profile.protocol || next[name].protocol, windowsBridge: profile.windowsBridge, freeRouteAllowed: profile.freeRouteAllowed, customName: profile.customName || next[name].customName, ownerManagedRoute: profile.ownerManagedRoute };
      }
      return next;
    })).catch(() => {});
    return () => controller.abort();
  }, []);
  useEffect(() => { form.current?.scrollIntoView({ block: 'nearest' }); return () => inFlight.current?.abort(); }, []);

  const update = (field: keyof Draft, value: string | boolean) => {
    edited.current.add(provider);
    setDrafts(values => ({ ...values, [provider]: { ...values[provider], [field]: value } }));
  };
  const discover = async () => {
    if (inFlight.current || !draft.baseUrl) return;
    const controller = new AbortController(); inFlight.current = controller; setPending(true); setModels([]);
    setResult({ text: 'Reading the provider model list only…', kind: 'note' });
    try {
      const value = await api('/integrations/model/gateway-models', 'POST', { provider: provider === 'custom' ? 'custom' : 'freellmapi', baseUrl: draft.baseUrl, apiKey: draft.apiKey, windowsBridge: !!draft.windowsBridge }, { signal: controller.signal, timeoutMs: 20000 });
      setModels(value.models || []); setResult({ text: value.note, kind: 'note' });
    } catch (error) {
      if (!controller.signal.aborted) setResult({ text: (error as Error).message, kind: 'error' });
    } finally {
      if (inFlight.current === controller) { inFlight.current = null; setPending(false); }
    }
  };
  const cancel = () => {
    inFlight.current?.abort(); inFlight.current = null; setPending(false);
    setResult({ text: 'Request cancelled. Saved configuration is retained; cancellation never marks a provider connected.', kind: 'note' });
  };
  const run = async (test: boolean) => {
    if (inFlight.current || !form.current?.reportValidity()) return;
    const controller = new AbortController(); inFlight.current = controller; setPending(true);
    setResult({ text: 'Saving provider configuration…', kind: 'note' });
    try {
      let response = await api('/integrations/model/config', 'PUT', { provider, ...draft, apiKey: provider === 'ollama' ? '' : draft.apiKey }, { signal: controller.signal });
      if (!response?.status || !statuses.includes(response.status.status)) throw new Error('LUCIFER returned an invalid provider status. Retry; your fields are still available.');
      if (test) {
        setResult({ text: provider === 'ollama' ? 'Checking Ollama and the installed model…' : provider === 'custom' ? 'Testing endpoint, model and structured tools… (up to 30 seconds)' : 'Testing the selected provider… (up to 30 seconds)', kind: 'note' });
        response = await api('/integrations/model/test', 'POST', undefined, { signal: controller.signal, timeoutMs: 35000 });
        if (!response?.status || !statuses.includes(response.status.status)) throw new Error('LUCIFER returned an invalid provider status. Retry; your fields are still available.');
      }
      if (controller.signal.aborted) return;
      setResult(response.error ? { text: String(response.error), kind: 'error' } : response.status.status === 'connected' ? { text: provider === 'custom' ? 'Custom provider verified: endpoint, model and structured tools are compatible.' : 'Connection verified for this provider.', kind: 'success' } : { text: 'Configuration saved. Use Save and test connection to verify it before assistant use.', kind: 'note' });
      await act(async () => {});
    } catch (error) {
      if (!controller.signal.aborted) setResult({ text: (error as Error).message || 'Provider request failed. You can retry.', kind: 'error' });
    } finally {
      if (inFlight.current === controller) { inFlight.current = null; setPending(false); }
    }
  };

  return <form ref={form} className="setup-card" aria-label="AI provider setup" aria-busy={pending} onSubmit={e => { e.preventDefault(); void run(false); }}>
    <h4>AI provider setup</h4>
    <p>Pick a preset or add a custom OpenAI-compatible endpoint. API keys are encrypted in LUCIFER's server vault and are never returned to the browser.</p>

    <label>Provider<select aria-label="Provider" value={provider} disabled={pending} onChange={e => { setProvider(e.target.value as Provider); setModels([]); setResult(null); }}>
      <option value="custom">NVIDIA Build / Custom provider</option>
      <option value="freellmapi">FreeLLMAPI gateway</option>
      <option value="ollama">Ollama · local</option>
      <option value="openai">OpenAI Responses</option>
    </select></label>

    {provider === 'custom' && <label>Provider name<input name="customName" required maxLength={60} value={draft.customName || ''} disabled={pending} onChange={e => update('customName', e.target.value)} placeholder="Example: OpenRouter, LM Studio, My Gateway" /></label>}

    <label>API protocol<select aria-label="API protocol" value={draft.protocol} disabled={pending || provider !== 'custom'} onChange={e => update('protocol', e.target.value)}>
      {provider === 'custom' ? <><option value="chat_completions">OpenAI-compatible Chat Completions</option><option value="responses">OpenAI-compatible Responses</option></> : <option value={draft.protocol}>{draft.protocol}</option>}
    </select></label>

    <label>Model<input name="model" required maxLength={120} value={draft.model} disabled={pending} onChange={e => update('model', e.target.value)} placeholder={provider === 'custom' ? 'Exact model ID required by your provider' : undefined} /></label>
    <label>Base URL<input name="baseUrl" type="url" required maxLength={500} value={draft.baseUrl} disabled={pending} onChange={e => update('baseUrl', e.target.value)} placeholder={provider === 'custom' ? 'https://provider.example/v1' : undefined} /></label>

    {provider !== 'ollama' && <label>API key<input name="apiKey" type="password" autoComplete="new-password" maxLength={500} value={draft.apiKey} disabled={pending} onChange={e => update('apiKey', e.target.value)} placeholder={ai?.provider === provider && ai?.credentialSource !== 'none' ? 'Leave blank to keep saved encrypted key' : provider === 'custom' ? 'Optional if your endpoint needs no key' : 'Paste the provider key privately here'} /><small>Never paste credentials into chat or source code.</small></label>}

    {provider === 'ollama' && <><label className="check"><input type="checkbox" checked={!!draft.windowsBridge} disabled={pending} onChange={e => update('windowsBridge', e.target.checked)} />Bridge the WSL production backend to Windows Ollama</label><p className="hint">Recommended lightweight fallback: <code>qwen2.5:1.5b</code>. The explicit test checks localhost reachability, the exact installed model, and a harmless structured tool call before marking it Connected.</p></>}

    {provider === 'freellmapi' && <div className="notice">
      <label className="check"><input type="checkbox" checked={!!draft.windowsBridge} disabled={pending} onChange={e => update('windowsBridge', e.target.checked)} />Bridge WSL to the Windows loopback gateway</label>
      <label className="check"><input type="checkbox" required checked={!!draft.freeRouteAllowed} disabled={pending} onChange={e => update('freeRouteAllowed', e.target.checked)} />I enabled this specific free route in the gateway</label>
      <button type="button" disabled={pending} onClick={() => void discover()}>Discover models</button>
    </div>}

    {provider === 'custom' && <div className="notice">
      <label className="check"><input type="checkbox" required checked={!!draft.ownerManagedRoute} disabled={pending} onChange={e => update('ownerManagedRoute', e.target.checked)} />I configured this endpoint and accept its quota/billing policy</label>
      {localEndpoint && <label className="check"><input type="checkbox" checked={!!draft.windowsBridge} disabled={pending} onChange={e => update('windowsBridge', e.target.checked)} />Endpoint runs on Windows localhost; bridge it from the WSL backend</label>}
      <div className="row-actions"><button type="button" disabled={pending || !draft.baseUrl} onClick={() => void discover()}>Discover models</button></div>
      <small>Save + test verifies a harmless structured function call. LUCIFER only marks the custom provider connected when assistant tools are actually compatible.</small>
    </div>}

    {models.length > 0 && <label>Observed model<select value={draft.model} onChange={e => update('model', e.target.value)}><option value="">Choose a model</option>{models.map(model => <option key={model.id} value={model.id}>{model.id}{model.tools ? ' · tools' : ''}</option>)}</select></label>}

    <details>
      <summary>Advanced routing and fallback</summary>
      {routing && <fieldset><legend>Optional fallback · one bounded switch</legend>
        <label className="check"><input type="checkbox" checked={routing.fallbackEnabled} onChange={e => setRouting({ ...routing, fallbackEnabled: e.target.checked })} />Enable one configured fallback after quota/service failure</label>
        <label>Fallback route<select value={routing.fallback} onChange={e => setRouting({ ...routing, fallback: e.target.value })}><option value="ollama">Local Ollama</option><option value="custom">Saved NVIDIA/custom provider</option><option value="freellmapi">Saved free gateway route</option></select></label>
        <button type="button" onClick={() => void act(() => api('/integrations/model/routing', 'PUT', { fallbackEnabled: routing.fallbackEnabled, fallback: routing.fallback }))}>Save fallback preference</button>
        <small>Fallback must already be configured and verified. Completed side effects are never replayed.</small>
      </fieldset>}
    </details>

    <p className={result?.kind || 'hint'} role="status" aria-live="polite">{result?.text || 'Ready. Saving does not make a network request until you choose Save and test connection.'}</p>
    <div className="row-actions"><button className="primary" disabled={pending}>Save configuration</button><button type="button" disabled={pending} onClick={() => void run(true)}>Save and test connection</button>{pending && <button type="button" onClick={cancel}>Cancel request</button>}<button type="button" onClick={() => { inFlight.current?.abort(); onClose(); }}>Close</button></div>
  </form>;
}
