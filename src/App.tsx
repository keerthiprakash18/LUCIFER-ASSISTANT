import { Component, useEffect, useRef, useState, type ErrorInfo, type ReactNode } from 'react';
import { ArrowUp, Mic, MicOff, Square, Paperclip, MessageSquare, CheckCheck, Monitor, Blocks, FileText, Brain, Settings as SettingsIcon, Sun, Moon, Shield, Plus, ArrowUpRight, Clock, LogOut, ChevronRight, Radio, Volume2 } from 'lucide-react';
import type { Task, Message, Settings, Device, StoredFile, Memory, Reminder, Skill } from '../shared/contracts';
import { api, APIError } from './api';
import { BrowserSpeech, browserSpeechLanguage, type VoiceDiagnostics, type VoiceState } from './voice';
import { Workspace } from './Workspace';
import {NativeVoicePanel} from './NativeVoicePanel';

export interface AppState {
  settings: Settings; messages: Message[]; tasks: Task[]; devices: Device[];
  files: StoredFile[]; memory: Memory[]; reminders: Reminder[]; skills: Skill[];
  integrations: { id: string; name: string; status: string; detail: string }[];
  notifications: any[]; proposals: any[]; deliveries: any[]; emergency?: boolean; telegram?: any;
  ai?: any; nvidiaPool?: any;
}
type BoundaryProps = { children: ReactNode; onBack?: () => void };
type BoundaryState = { error: Error | null };
export class AppErrorBoundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { error: null };
  static getDerivedStateFromError(error: Error): BoundaryState { return { error }; }
  componentDidCatch(_error: Error, info: ErrorInfo) { console.error('LUCIFER UI rendering error', info.componentStack); }
  render() {
    if (!this.state.error) return this.props.children;
    return <section className="render-recovery" role="alert"><h2>This view could not render.</h2><p>Retry this view or return to the Assistant. Your saved data is still available.</p><div className="row-actions"><button className="primary" onClick={() => this.setState({ error: null })}>Retry view</button><button onClick={() => { this.setState({ error: null }); if(this.props.onBack)this.props.onBack();else {location.hash='assistant';location.reload();} }}>Back to Assistant</button></div></section>;
  }
}
const nav = [['Assistant', MessageSquare], ['Tasks', CheckCheck], ['Devices', Monitor], ['Permissions',Shield], ['Skills & integrations', Blocks], ['Files & reports', FileText], ['Memory', Brain], ['Settings', SettingsIcon]] as const;
const slug = (name:string) => name.toLowerCase().replaceAll(' & ', '-').replaceAll(' ', '-');
const hashSection = () => nav.find(([name])=>slug(name)===location.hash.slice(1).split('/')[0])?.[0] || 'Assistant';
function workspaceState(value:any):AppState {
  if(!value || !value.settings || typeof value.settings.theme!=='string' || typeof value.settings.timezone!=='string' || !value.settings.permissions || !['messages','tasks','devices','files','memory','reminders','skills','integrations','notifications','proposals','deliveries'].every(key=>Array.isArray(value[key])))throw new APIError('LUCIFER returned an invalid workspace response. Retry loading; your saved data has not been changed.');
  return value;
}

export function Emblem({ small = false, active = false }: { small?: boolean; active?: boolean }) {
  return <div className={`${small ? 'mini-emblem' : 'emblem'} ${active ? 'active' : ''}`}>
    <svg viewBox="0 0 128 128" aria-label="Original LUCIFER emblem" role="img"><path d="M30 27L64 47L98 27L84 70L64 103L44 70Z" /><path d="M47 55L64 68L81 55M64 68V88" /></svg>
  </div>;
}
function Status({ text }: { text: string }) {
  const good = /completed|online|connected|delivered/.test(text) && !/disconnected/.test(text);
  return <span className={'status ' + (good ? 'good' : '')}><i />{text.replaceAll('_', ' ')}</span>;
}
function deviceStatus(device: Device) {
  return device.revoked ? 'revoked' : Date.now() - Date.parse(device.lastSeen) < 15000 ? 'online' : 'offline';
}

export function App() {
  const [auth, setAuth] = useState<{ configured: boolean; authenticated: boolean } | null>(null);
  const [data, setData] = useState<AppState | null>(null);
  const [section, updateSection] = useState<string>(hashSection);
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState('');
  const [text, setText] = useState('');
  const [voiceState, setVoiceState] = useState<VoiceState>('idle');
  const [mode, setMode] = useState('normal');
  const [muted, setMuted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [offline, setOffline] = useState(!navigator.onLine);
  const [attachments, setAttachments] = useState<StoredFile[]>([]);
  const [voiceInfo, setVoiceInfo] = useState<VoiceDiagnostics | null>(null);
  const speech = useRef<BrowserSpeech | null>(null);
  const session = useRef(false);
  const latest = useRef(data);
  const seen = useRef(new Set<string>());
  const historyLoaded = useRef(false);
  const sending = useRef(false);
  const refreshing = useRef<Promise<void> | null>(null);
  const upload = useRef<HTMLInputElement>(null);
  const thread = useRef<HTMLDivElement>(null);
  latest.current = data;

  const refresh = ():Promise<void> => {
    if(refreshing.current)return refreshing.current;
    const work=(async()=>{
      try { setData(workspaceState(await api('/state','GET',undefined,{timeoutMs:10000}))); setOffline(false);setLoadError(''); }
      catch (e) {
        if(e instanceof APIError&&e.status===401)setAuth(a=>a?{...a,authenticated:false}:a);
        else {setOffline(true);setLoadError((e as Error).message);}
      }
    })();
    refreshing.current=work;
    void work.finally(()=>{if(refreshing.current===work)refreshing.current=null;});
    return work;
  };
  const loadAuth=async()=>{setError('');try{const value=await api('/auth/status','GET',undefined,{timeoutMs:10000});if(typeof value?.authenticated!=='boolean'||typeof value?.configured!=='boolean')throw new Error('LUCIFER returned an invalid sign-in response. Retry loading.');setAuth(value);}catch(e){setError((e as Error).message);}};
  const setSection=(name:string)=>{updateSection(name);history.replaceState(null,'','#'+slug(name));window.scrollTo({top:0,behavior:'auto'});};
  const voiceUpdate = (state: VoiceState, message?: string) => {
    setVoiceState(state);
    if (message) { setError(message); session.current = false; }
  };
  const stop = () => {
    session.current = false; speech.current?.stop(); setVoiceState('idle'); setMuted(false); setMode('normal');
  };
  useEffect(() => {
    speech.current = new BrowserSpeech();
    void loadAuth();
    const hide = () => { if (document.hidden) { session.current = false; speech.current?.stop(); setVoiceState('idle'); } };
    document.addEventListener('visibilitychange', hide);
    return () => { speech.current?.stop(); document.removeEventListener('visibilitychange', hide); };
  }, []);
  useEffect(()=>{const change=()=>updateSection(hashSection());window.addEventListener('hashchange',change);return()=>window.removeEventListener('hashchange',change);},[]);
  useEffect(()=>{if(section!=='Assistant')stop();},[section]);
  useEffect(() => {
    if (!auth?.authenticated) return;
    void refresh(); const timer = setInterval(refresh, 800); return () => clearInterval(timer);
  }, [auth?.authenticated]);
  useEffect(() => { if (data) { document.documentElement.dataset.theme = data.settings.theme; document.documentElement.dataset.accent = data.settings.accent || 'rose'; } }, [data?.settings.theme, data?.settings.accent]);
  useEffect(() => { if (data && speech.current) void speech.current.diagnostics(browserSpeechLanguage(data.settings.language)).then(setVoiceInfo); }, [data?.settings.language, section]);
  useEffect(() => {
    thread.current?.scrollTo({ top: thread.current.scrollHeight, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    if (data && !historyLoaded.current) { historyLoaded.current = true; data.messages.forEach(m => seen.current.add(m.id)); return; }
    const message = data?.messages.at(-1);
    if (message?.role === 'assistant' && !seen.current.has(message.id)) {
      seen.current.add(message.id);
      if (data?.settings.spokenReplies || session.current) speech.current?.speak(message.text, /[\u0b80-\u0bff]/.test(message.text) ? 'ta-IN' : 'en-IN', voiceUpdate);
    }
  }, [data?.messages.length]);
  const act = async (work: () => Promise<unknown>) => {
    setError(''); try { await work(); await refresh(); } catch (e) { setError((e as Error).message); }
  };
  const send = async (value = text) => {
    if (!value.trim() || sending.current) return;
    sending.current = true; setBusy(true); setVoiceState('idle'); setError('');
    if ((latest.current?.settings.spokenReplies || session.current) && value.length > 30) {
      speech.current?.speak(/[\u0b80-\u0bff]/.test(value) ? 'சரி, பார்க்கிறேன்.' : "I'll work on that.", /[\u0b80-\u0bff]/.test(value) ? 'ta-IN' : 'en-IN', voiceUpdate);
    }
    try {
      await api('/chat', 'POST', { text: value, fileIds: attachments.map(f => f.id) });
      setText(''); setAttachments([]); await refresh();
    } catch (e) { setError((e as Error).message); }
    finally { sending.current = false; setBusy(false); }
  };
  const startListening = () => {
    setMuted(false); setError('');
    speech.current?.listen(browserSpeechLanguage(latest.current?.settings.language || 'auto'), (value, final) => {
      setText(value);
      if (final) { setVoiceState('idle'); if (session.current) void send(value); }
    }, voiceUpdate);
  };
  const changeMode = (value: string) => {
    stop(); setMode(value);
    if (value === 'realtime') setError('Realtime is a foreground, turn-based browser voice session. Press the microphone for each turn; only final transcripts are sent. Audio may be processed by your browser’s speech service.');
  };
  const mic = () => {
    if (['listening', 'transcribing'].includes(voiceState)) { speech.current?.recognition?.stop(); return; }
    session.current = mode === 'realtime'; startListening();
  };
  const mute = () => { session.current = false; speech.current?.stop(); setVoiceState('idle'); setMuted(true); };
  const activeTask = data?.tasks.find(t => t.state === 'running');
  const state = offline ? 'offline' : ['listening', 'transcribing', 'speaking', 'failed'].includes(voiceState) ? voiceState
    : activeTask ? /laptop|sending authorized|claimed the command/i.test(activeTask.title + activeTask.events.map(e => e.text).join(' ')) ? 'executing' : 'processing'
    : data?.proposals.some(p => p.state === 'pending' && Date.parse(p.expiresAt) > Date.now()) ? 'waiting for input'
    : data?.tasks[0]?.state === 'failed' ? 'failed' : data?.tasks[0]?.state === 'completed' ? 'completed' : 'idle';

  if (!auth) return <main className="auth"><div className="auth-card"><Emblem small /><h1>Connecting to LUCIFER…</h1>{error && <><p role="alert" className="error">{error}</p><button onClick={()=>void loadAuth()}>Retry connection</button></>}</div></main>;
  if (!auth.authenticated) return <main className="auth"><div className="auth-card">
    <Emblem small /><span className="eyebrow">YOUR PERSONAL ASSISTANT</span><h1>Meet LUCIFER.</h1>
    <p>A little clarity. A lot of possibility.<br />Your private workspace starts here.</p>
    {auth?.configured ? <form onSubmit={e => {
      e.preventDefault(); const password = new FormData(e.currentTarget).get('password');
      void api('/auth/login', 'POST', { password }).then(() => { historyLoaded.current = false; setAuth({ ...auth, authenticated: true }); }).catch(e => setError(e.message));
    }}><label>Owner password<input name="password" type="password" autoComplete="current-password" required minLength={12} /></label>
      <button className="primary">Enter workspace <ArrowUpRight size={18} /></button></form>
      : <div className="notice">Create your owner password in this project’s terminal:<code>npm run setup</code><button onClick={() => void api('/auth/status').then(setAuth)}>Check setup</button></div>}
    {error && <p role="alert" className="error">{error}</p>}
    <small><Shield size={13} /> Single-owner access · Stored in your private server</small>
  </div></main>;
  if (!data) return <main className="auth"><div className="auth-card"><h1>Loading your workspace…</h1>{loadError && <><p role="alert" className="error">{loadError}</p><button onClick={()=>void refresh()}>Retry loading workspace</button></>}</div></main>;

  const pending = data.proposals.filter(p => p.state === 'pending' && Date.parse(p.expiresAt) > Date.now());
  return <div className="app-shell">
    <aside className="sidebar">
      <a className="brand" href="#" onClick={e => { e.preventDefault(); setSection('Assistant'); }}><Emblem small /><div>LUCIFER<small>PERSONAL INTELLIGENCE</small></div></a>
      <span className="nav-label">WORKSPACE</span>
      <nav aria-label="Workspace">{nav.map(([name, Icon]) => <button key={name} className={section === name ? 'selected' : ''} onClick={() => setSection(name)}>
        <Icon size={19} /><span>{name}</span>{name === 'Tasks' && data.tasks.some(t => t.state === 'running') && <b>{data.tasks.filter(t => t.state === 'running').length}</b>}
      </button>)}</nav>
      <div className="sidebar-bottom"><div className="private"><Shield size={17} /><div>Your space. Your control.<small>Actions stay within your permissions.</small></div></div>
        <button className="owner" onClick={() => void api('/auth/logout', 'POST').then(() => { stop(); setData(null); setAuth({ ...auth, authenticated: false }); })}>
          <span className="avatar">M</span><span>My workspace<small>Personal account</small></span><LogOut size={16} />
        </button>
      </div>
    </aside>
    <main className="main">
      <header><div><span className="breadcrumb">WORKSPACE <ChevronRight size={12} /> {section}</span><h1>{section === 'Assistant' ? 'A space to think. And do.' : section}</h1></div>
        <div className="header-actions"><Status text={offline ? 'offline' : 'workspace online'} />
          <button className="icon-button" aria-label="Toggle dark theme" onClick={() => void act(() => api('/settings', 'PUT', { ...data.settings, theme: data.settings.theme === 'light' ? 'dark' : 'light' }))}>{data.settings.theme === 'light' ? <Moon size={19} /> : <Sun size={19} />}</button>
          <button className="icon-button danger" aria-label="Emergency stop all tasks" onClick={() => { stop(); void act(() => api('/emergency-stop', 'POST')); }}><Square size={16} /></button>
        </div>
      </header>
      {data.emergency && <div className="notice">Emergency stop is active. New actions are blocked.<button onClick={() => void act(() => api('/resume', 'POST'))}>Resume actions</button></div>}
      {error && <div className="banner" role="alert">{error}<button aria-label="Dismiss message" onClick={() => setError('')}>×</button></div>}
      {loadError && <div className="banner" role="alert">{loadError} Showing the last loaded workspace.<button onClick={()=>void refresh()}>Retry loading workspace</button></div>}
      {section === 'Assistant' ? <>
        <div className="workspace">
          <div className="column">
            <section className="panel"><div className="panel-heading"><span><CheckCheck size={17} /> On your radar</span><button aria-label="View all tasks" onClick={() => setSection('Tasks')}><ArrowUpRight size={17} /></button></div>
              {data.tasks.length ? data.tasks.slice(0, 3).map(t => <div className="mini-row" key={t.id}><span className="task-dot" /><div><strong>{t.title}</strong><small>{t.events.at(-1)?.text || t.state.replaceAll('_', ' ')}</small></div><Status text={t.state} /></div>)
                : <div className="empty"><Clock size={23} /><p>A clear slate.</p><small>Your tasks will appear here as they happen.</small></div>}
              <button className="panel-link" onClick={() => setSection('Tasks')}>Plan a reminder <Plus size={14} /></button>
            </section>
            <section className="panel"><div className="panel-heading"><span><FileText size={17} /> Recent files</span><button aria-label="View files" onClick={() => setSection('Files & reports')}><ArrowUpRight size={17} /></button></div>
              {data.files.length ? data.files.slice(-3).reverse().map(f => <a className="mini-row" href={'/api/files/' + f.id + '/download'} target="_blank" rel="noreferrer" key={f.id}><FileText size={19} /><div><strong>{f.name}</strong><small>{(f.bytes / 1024).toFixed(1)} KB · {f.generated ? 'Generated' : 'Imported'}</small></div></a>)
                : <div className="empty"><p>Bring your context.</p><small>Documents, exports, and reports, in one place.</small></div>}
            </section>
          </div>
          <section className="assistant-center">
            <div className="mode-control" role="group" aria-label="Conversation mode">
              <button className={mode === 'normal' ? 'chosen' : ''} onClick={() => changeMode('normal')}><MessageSquare size={14} />Normal</button>
              <button className={mode === 'realtime' ? 'chosen' : ''} onClick={() => changeMode('realtime')}><Radio size={14} />Realtime</button>
            </div>
            <div className="orbit"><div className="orbit-ring one" /><div className="orbit-ring two" /><Emblem active={['processing', 'executing', 'listening', 'speaking', 'transcribing'].includes(state)} /></div>
            <span className="assistant-state" role="status"><i className={state === 'idle' ? '' : 'lit'} />{muted ? 'microphone muted' : state}</span>
            <h2>What’s on your mind?</h2><p>Think out loud. I’ll help make it happen.</p>
            <div className="suggestions">
              <button onClick={() => void send('What is the time?')}><Clock size={15} />Check my local time<ArrowUpRight size={13} /></button>
              <button onClick={() => setSection('Files & reports')}><FileText size={15} />Turn data into a report<ArrowUpRight size={13} /></button>
              <button onClick={() => setSection('Devices')}><Monitor size={15} />Connect my laptop<ArrowUpRight size={13} /></button>
            </div>
              <small className="provider-note">Local tools ready · AI {data.integrations.find(i => i.id === 'model')?.status?.replaceAll('_',' ')}</small>
              {data.ai?.runtimeFault&&<small role="status" className="error">Last primary model request failed{data.ai.runtimeFault.httpStatus?' (HTTP '+data.ai.runtimeFault.httpStatus+')':''}. Local action commands are ready; task progress identifies any enabled fallback. See Settings for the saved provider and gateway.</small>}
             {!data.ai?.configured && <button onClick={()=>{setSection('Settings');history.replaceState(null,'','#settings/ai-provider');}}>Configure AI provider</button>}
          </section>
          <div className="column">
            <section className="panel"><div className="panel-heading"><span><Monitor size={17} /> Your devices</span><button aria-label="Manage devices" onClick={() => setSection('Devices')}><ArrowUpRight size={17} /></button></div>
              {data.devices.length ? data.devices.map(d => <div className="mini-row" key={d.id}><Monitor size={20} /><div><strong>{d.name}</strong><small>{d.capabilities.actions.length} approved capabilities</small></div><Status text={deviceStatus(d)} /></div>)
                : <div className="empty"><Monitor size={25} /><p>Connect your world.</p><small>Pair a laptop to securely take action from your phone.</small></div>}
              <button className="panel-link" onClick={() => setSection('Devices')}>Pair a device <Plus size={14} /></button>
            </section>
            <section className="panel"><div className="panel-heading"><span><Blocks size={17} /> Connected apps</span><button aria-label="Manage integrations" onClick={() => setSection('Skills & integrations')}><ArrowUpRight size={17} /></button></div>
              {data.integrations.map(i => <button className="integration-row" key={i.id} onClick={() => setSection('Skills & integrations')}><span className={'app-icon ' + i.id}>{i.id === 'instagram' ? '◎' : i.id === 'telegram' ? '↗' : '✦'}</span><span><strong>{i.name}</strong><small>{i.status}</small></span><ChevronRight size={14} /></button>)}
            </section>
            <div className="quiet-note"><Brain size={18} /><p>Built around you.<small>You decide what LUCIFER remembers.</small></p></div>
          </div>
        </div>
         <NativeVoicePanel compact onActivate={stop}/>
         {activeTask&&<section className="list-card" aria-label="Current action"><h3>Current action: {activeTask.title}</h3><p role="status">{activeTask.events.at(-1)?.text||'Starting'}</p><button className="danger" onClick={()=>void act(()=>api('/tasks/'+activeTask.id+'/cancel','POST'))}>Stop current task</button>{activeTask.result!==undefined&&<details><summary>Observed step results</summary><pre className="task-result">{JSON.stringify(activeTask.result,null,2)}</pre></details>}</section>}
         {pending.length > 0 && <section className="proposal-section" aria-label="Actions awaiting authorization">{pending.map(p => <div className="list-card" key={p.id}>
          <h3>{p.summary} <span className="pill">waiting for your input</span></h3>
          <pre className="task-result">{JSON.stringify(p.input, null, 2)}</pre><small>No action has run. Expires {new Date(p.expiresAt).toLocaleTimeString()}.</small>
          <div className="row-actions"><button className="primary" onClick={() => void act(() => api('/proposals/' + p.id + '/accept', 'POST'))}>Authorize this exact action</button><button onClick={() => void act(() => api('/proposals/' + p.id + '/reject', 'POST'))}>Decline</button></div>
        </div>)}</section>}
        <section className="conversation" aria-label="Conversation">
          <div className="conversation-title">CONVERSATION <span>{data.messages.length ? 'Your ongoing thread' : 'Start with an idea'}</span></div>
          <div className="thread" ref={thread}>{data.messages.slice(-12).map(m => <article key={m.id} className={'message ' + m.role}>
            <span className="message-label">{m.role === 'user' ? 'YOU' : 'LUCIFER'}</span><p>{m.text}</p>
            {m.role === 'assistant' && <button aria-label="Read reply aloud" className="icon-button" onClick={() => speech.current?.speak(m.text, /[\u0b80-\u0bff]/.test(m.text) ? 'ta-IN' : 'en-IN', voiceUpdate)}><Volume2 size={14} /></button>}
          </article>)}</div>
        </section>
        <form className="composer" onSubmit={e => { e.preventDefault(); void send(); }}>
          {attachments.length > 0 && <div className="attachment-list">{attachments.map(f => <span key={f.id}>{f.name}<button type="button" aria-label={'Remove ' + f.name} onClick={() => setAttachments(a => a.filter(v => v.id !== f.id))}>×</button></span>)}</div>}
          <textarea aria-label="Message LUCIFER" placeholder="Ask LUCIFER anything, or describe an outcome…" value={text} onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }} rows={1} />
          <div className="composer-toolbar"><div>
            <input ref={upload} type="file" accept=".txt,.csv,.pdf,.png,.jpg,.jpeg" hidden onChange={e => {
              const f = e.target.files?.[0]; if (f) { const form = new FormData(); form.append('file', f); void act(async () => { const stored = await api('/files', 'POST', form); setAttachments(a => [...a, stored]); }); } e.target.value = '';
            }} />
            <button type="button" aria-label="Attach file" className="icon-button" onClick={() => upload.current?.click()}><Paperclip size={18} /></button>
            <button type="button" aria-label={voiceState === 'listening' ? 'Finish recording' : 'Start microphone'} className={'icon-button ' + (voiceState === 'listening' ? 'recording' : '')} onClick={mic}><Mic size={18} /></button>
            {mode === 'realtime' && <button type="button" aria-label="Mute microphone and pause voice session" className="icon-button" onClick={mute}><MicOff size={18} /></button>}
            <button type="button" aria-label="Stop speech and voice session" className="icon-button" onClick={stop}><Square size={15} /></button><span>English · தமிழ் · Tanglish</span>
          </div><button type="submit" className="send-button" aria-label="Send message" disabled={busy || !text.trim() || offline || data.emergency}><ArrowUp size={20} /></button></div>
        </form>
        <footer><Shield size={12} /> You’re in control. Real tools. Visible results.<span>{data.settings.timezone} · {mode === 'realtime' ? 'Turn-based voice' : 'Normal mode'}</span></footer>
       </> : <AppErrorBoundary key={section} onBack={() => setSection('Assistant')}><Workspace section={section} data={data} act={act} refresh={refresh} voiceInfo={voiceInfo} /></AppErrorBoundary>}
    </main>
  </div>;
}
