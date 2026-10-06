import { useEffect, useRef, useState } from 'react';
import type { AppState } from './App';
import { api } from './api';

type Props = { data: AppState; act: (work: () => Promise<unknown>) => Promise<void> };
type Provider = 'gemini' | 'openai' | 'ollama'|'freellmapi';
type Draft = { model: string; baseUrl: string; apiKey: string;windowsBridge?:boolean;freeRouteAllowed?:boolean };
const defaults: Record<Provider, Draft> = {
  gemini: { model: 'gemini-flash-latest', baseUrl: 'https://generativelanguage.googleapis.com', apiKey: '' },
  openai: { model: '', baseUrl: 'https://api.openai.com/v1', apiKey: '' },
  ollama: { model: 'gemma3:1b', baseUrl: 'http://127.0.0.1:11434', apiKey: '' },
  freellmapi:{model:'',baseUrl:'http://127.0.0.1:31415/v1',apiKey:'',windowsBridge:true,freeRouteAllowed:false},
};
const protocols: Record<Provider, string> = { gemini: 'gemini_generate_content', openai: 'responses', ollama: 'ollama_chat',freellmapi:'chat_completions' };
const isProvider = (value: unknown): value is Provider => value === 'gemini' || value === 'openai' || value === 'ollama'||value==='freellmapi';
const statuses = ['awaiting_configuration', 'configured_unverified', 'connected', 'connection_failed', 'disconnected', 'unsupported'];

export function AIProviderPanel({ data, act }: Props) {
  const [open, setOpen] = useState(()=>location.hash.endsWith('/ai-provider'));
  const configure = useRef<HTMLButtonElement>(null);
  const disconnecting = useRef(false);
  const [busy,setBusy] = useState(false);
  return <>
    <h3>AI provider <span className="pill">{typeof data.ai?.status === 'string' ? data.ai.status.replaceAll('_', ' ') : 'awaiting configuration'}</span></h3>
    <p>Choose Gemini, a privately configured free gateway route, or local Ollama. Paid production routes are disabled. Opening settings makes no model request.</p>
    <button ref={configure} type="button" className="primary" aria-expanded={open} onClick={() => {setOpen(true);history.replaceState(null,'',location.hash.split('/')[0]+'/ai-provider');}}>{data.ai?.configured ? 'Manage AI provider' : 'Configure AI provider'}</button>
    {!open && data.ai?.configured && <button type="button" disabled={busy} onClick={() => {if(disconnecting.current)return;disconnecting.current=true;setBusy(true);void act(()=>api('/integrations/model/disconnect','POST')).finally(()=>{disconnecting.current=false;setBusy(false);});}}>Disconnect AI provider</button>}
    {typeof data.ai?.lastError==='string' && <p className="error">{data.ai.lastError}</p>}
    {data.ai?.runtimeFault&&<p className="error" role="status">Last live model request: {data.ai.runtimeFault.message}{data.ai.runtimeFault.httpStatus?' (HTTP '+data.ai.runtimeFault.httpStatus+')':''}. Saved connection-test status is separate; local actions remain available.</p>}
    {data.ai?.lastDiagnostics && <details><summary className="hint">Connection diagnostics · sanitized metadata</summary><pre className="task-result">{JSON.stringify(data.ai.lastDiagnostics,null,2)}</pre></details>}
    {open && <AISetup data={data} act={act} onClose={() => { setOpen(false);history.replaceState(null,'',location.hash.split('/')[0]); configure.current?.focus(); }} />}
  </>;
}

function AISetup({ data, act, onClose }: Props & { onClose: () => void }) {
  const ai = data.ai;
  const [provider, setProvider] = useState<Provider>(isProvider(ai?.provider) ? ai.provider : 'gemini');
  const [drafts, setDrafts] = useState<Record<Provider, Draft>>(() => {
    const values = structuredClone(defaults);
    const selected:unknown=ai?.provider;
    if (isProvider(selected)) values[selected] = { ...values[selected],model: typeof ai.model === 'string' ? ai.model : values[selected].model, baseUrl: typeof ai.baseUrl === 'string' ? ai.baseUrl : values[selected].baseUrl, apiKey: '',windowsBridge:ai.windowsBridge,freeRouteAllowed:ai.freeRouteAllowed };
    return values;
  });
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<{ text: string; kind: 'note' | 'error' | 'success' } | null>(null);
  const form = useRef<HTMLFormElement>(null);
  const inFlight = useRef<AbortController | null>(null);
  const draft = drafts[provider];
  const [routing,setRouting]=useState<any>(null),[models,setModels]=useState<any[]>([]);
  const edited=useRef(new Set<Provider>());
  useEffect(()=>{void api('/integrations/model/routing').then(setRouting).catch(()=>{});},[]);
  useEffect(()=>{const controller=new AbortController();void api('/integrations/model/profiles','GET',undefined,{signal:controller.signal}).then((profiles:any[])=>setDrafts(values=>{const next={...values};for(const profile of profiles){const name:unknown=profile.provider;if(isProvider(name)&&!edited.current.has(name))next[name]={...next[name],model:profile.model,baseUrl:profile.baseUrl,windowsBridge:profile.windowsBridge,freeRouteAllowed:profile.freeRouteAllowed};}return next;})).catch(()=>{});return()=>controller.abort();},[]);
  useEffect(() => { form.current?.scrollIntoView({ block: 'nearest' }); return () => inFlight.current?.abort(); }, []);
  const update = (field: keyof Draft, value: string|boolean) => {edited.current.add(provider);setDrafts(values => ({ ...values, [provider]: { ...values[provider], [field]: value } }));};
  const discover=async()=>{if(inFlight.current)return;const controller=new AbortController();inFlight.current=controller;setPending(true);setResult({text:'Checking only the configured gateway model list…',kind:'note'});try{const value=await api('/integrations/model/gateway-models','POST',{baseUrl:draft.baseUrl,apiKey:draft.apiKey,windowsBridge:!!draft.windowsBridge},{signal:controller.signal,timeoutMs:20000});setModels(value.models||[]);setResult({text:value.note,kind:'note'});}catch(error){if(!controller.signal.aborted)setResult({text:(error as Error).message,kind:'error'});}finally{if(inFlight.current===controller){inFlight.current=null;setPending(false);}}};
  const cancel = () => { inFlight.current?.abort(); inFlight.current = null; setPending(false); setResult({ text: 'Request cancelled. Any configuration already saved is retained; the connection is not verified by cancellation.', kind: 'note' }); };
  const run = async (test: boolean) => {
    if (inFlight.current || !form.current?.reportValidity()) return;
    const controller = new AbortController(); inFlight.current = controller; setPending(true);
    setResult({ text: 'Saving provider configuration…', kind: 'note' });
    try {
      let response = await api('/integrations/model/config', 'PUT', { provider, protocol: protocols[provider], ...draft, apiKey: provider === 'ollama' ? '' : draft.apiKey }, { signal: controller.signal });
      if (!response?.status || !statuses.includes(response.status.status)) throw new Error('LUCIFER returned an invalid provider status. Retry; your input is still available.');
      if (test) {
        setResult({ text: provider === 'ollama' ? 'Checking local Ollama and the installed model… (up to 30 seconds)' : 'Testing the selected provider… (up to 30 seconds)', kind: 'note' });
        response = await api('/integrations/model/test', 'POST', undefined, { signal: controller.signal, timeoutMs: 35000 });
        if (!response?.status || !statuses.includes(response.status.status)) throw new Error('LUCIFER returned an invalid provider status. Retry; your input is still available.');
      }
      if (controller.signal.aborted) return;
      setResult(response.error ? { text: String(response.error), kind: 'error' } : response.status.status === 'connected' ? { text: 'Connection verified for this provider.', kind: 'success' } : { text: 'Configuration saved. Connection is not verified. Use Save and test connection when ready.', kind: 'note' });
      await act(async () => {});
    } catch (error) {
      if (!controller.signal.aborted) setResult({ text: (error as Error).message || 'Provider request failed. You can retry.', kind: 'error' });
    } finally {
      if (inFlight.current === controller) { inFlight.current = null; setPending(false); }
    }
  };
  return <form ref={form} className="setup-card" aria-label="AI provider setup" aria-busy={pending} onSubmit={e => { e.preventDefault(); void run(false); }}>
    <h4>AI provider setup</h4>
    <p>Local features work without AI credentials. Credentials stay in LUCIFER's encrypted server vault. Paid routes are disabled; optional fallback is explicitly controlled below.</p>
    <label>Provider<select aria-label="Provider" value={provider} disabled={pending} onChange={e => { setProvider(e.target.value as Provider); setResult(null); }}><option value="gemini">Google Gemini · check current free-tier quota</option><option value="freellmapi">FreeLLMAPI · enabled free gateway route</option><option value="openai">OpenAI Responses · paid production route disabled</option><option value="ollama">Ollama · local only</option></select></label>
    <label>API protocol<select aria-label="API protocol" value={protocols[provider]} disabled><option value={protocols[provider]}>{protocols[provider]}</option></select></label>
    <label>Model<input name="model" required maxLength={120} value={draft.model} disabled={pending} onChange={e => update('model', e.target.value)} /></label>
    <label>Base URL<input name="baseUrl" type="url" required maxLength={500} value={draft.baseUrl} disabled={pending} onChange={e => update('baseUrl', e.target.value)} /></label>
    <small>{provider === 'openai' ? <>Legacy Responses configuration is retained; paid production requests are disabled.</> : provider === 'gemini' ? <>The official <code>@google/genai</code> SDK calls this Gemini Developer API endpoint.</> : provider==='freellmapi'?<>Gateway Chat Completions protocol with validated structured tools. Quotas depend on the explicitly enabled upstream route.</>:<>Localhost only. Reachability and installed models are checked during an explicit connection test.</>}</small>
    {provider !== 'ollama' && <label>API key<input name="apiKey" type="password" autoComplete="new-password" maxLength={500} value={draft.apiKey} disabled={pending} onChange={e => update('apiKey', e.target.value)} placeholder={ai?.provider === provider && ai?.credentialSource !== 'none' ? 'Leave blank to keep the server-side credential' : 'Optional until you are ready to configure AI'} /><small>Never paste credentials into chat. Runtime credentials are encrypted in the server-local vault.</small></label>}
    {provider === 'gemini' && <p className="hint">Google AI Studio: quotas depend on the current model, project, and account. Billing is not enabled by LUCIFER.</p>}
    {provider === 'ollama' && <p className="hint">Start with <code>gemma3:1b</code> if you choose to install a local model. A reachable server and the exact installed model are required for a verified connection.</p>}
    {provider==='freellmapi'&&<><label className="check"><input type="checkbox" checked={!!draft.windowsBridge} disabled={pending} onChange={e=>update('windowsBridge',e.target.checked)}/>Bridge WSL to the Windows loopback gateway</label><label className="check"><input type="checkbox" required checked={!!draft.freeRouteAllowed} disabled={pending} onChange={e=>update('freeRouteAllowed',e.target.checked)}/>I enabled this specific free route in the gateway; no paid fallback</label><button type="button" disabled={pending} onClick={()=>void discover()}>Discover gateway models</button>{models.length>0&&<label>Observed gateway model<select value={draft.model} onChange={e=>update('model',e.target.value)}><option value="">Choose an observed model</option>{models.map(model=><option key={model.id} value={model.id}>{model.id}{model.tools?' · advertises tools':''}</option>)}</select></label>}<p>No credentials are copied from other applications. Save and test verifies a real harmless structured tool call.</p></>}
    {routing&&<fieldset><legend>Optional fallback · one bounded switch</legend><label className="check"><input type="checkbox" checked={routing.fallbackEnabled} onChange={e=>setRouting({...routing,fallbackEnabled:e.target.checked})}/>Enable configured fallback after quota/service failure</label><label>Fallback route<select value={routing.fallback} onChange={e=>setRouting({...routing,fallback:e.target.value})}><option value="gemini">Saved Gemini</option><option value="freellmapi">Saved free gateway route</option><option value="ollama">Local Ollama</option></select></label><button type="button" onClick={()=>void act(()=>api('/integrations/model/routing','PUT',{fallbackEnabled:routing.fallbackEnabled,fallback:routing.fallback}))}>Save fallback preference</button><small>Fallback must have its own saved credential/model. Completed actions are not replayed; the serving provider/model appears in task progress.</small></fieldset>}
    <p className={result?.kind || 'hint'} role="status" aria-live="polite">{result?.text || 'Ready to configure. No connection test is running.'}</p>
    <div className="row-actions"><button className="primary" disabled={pending}>Save configuration</button><button type="button" disabled={pending} onClick={() => void run(true)}>Save and test connection</button>{pending && <button type="button" onClick={cancel}>Cancel request</button>}<button type="button" onClick={() => { inFlight.current?.abort(); onClose(); }}>Close</button></div>
  </form>;
}
