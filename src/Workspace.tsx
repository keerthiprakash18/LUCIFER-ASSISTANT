import { useState } from 'react';
import type { AppState } from './App';
import type { Reminder } from '../shared/contracts';
import { api } from './api';
import { FilesPanel } from './FilesPanel';
import type { VoiceDiagnostics } from './voice';
import { AIProviderPanel } from './AISetup';
import { NativeVoicePanel } from './NativeVoicePanel';
import {PermissionsPanel} from './PermissionsPanel';
type Act = (work: () => Promise<unknown>) => Promise<void>;
type PanelProps = { data: AppState; act: Act };

export function Workspace({ section, data, act, voiceInfo }: PanelProps & { section: string; refresh: () => Promise<void>; voiceInfo: VoiceDiagnostics|null }) {
  if (section === 'Devices') return <DevicesPanel data={data} act={act} />;
  if (section === 'Tasks') return <TasksPanel data={data} act={act} />;
  if(section==='Permissions')return <PermissionsPanel data={data} act={act}/>;
  if (section === 'Files & reports') return <FilesPanel data={data} act={act} />;
  if (section === 'Memory') return <MemoryPanel data={data} act={act} />;
  if (section === 'Skills & integrations') return <IntegrationsPanel data={data} act={act} />;
  return <SettingsPanel data={data} act={act} voiceInfo={voiceInfo} />;
}

function DevicesPanel({ data, act }: PanelProps) {
  const [pairing, setPairing] = useState<any>(null);
  const [deviceId, setDeviceId] = useState('');
  const [kind, setKind] = useState('open_app');
  const device = data.devices.find(d => d.id === deviceId);
  return <section className="page-content"><p>Outbound-only companion connection. Select the target explicitly. Commands expire rather than replaying after reconnection.</p>
    <div className="grid">
      <div className="form-panel"><h3>Pair your Windows laptop</h3>
        <p>Start the companion from Windows PowerShell, then enter this five-minute, single-use challenge. Remote connections require HTTPS.</p>
        <button className="primary" onClick={() => void act(async () => setPairing(await api('/devices/pairing', 'POST')))}>Create pairing challenge</button>
        {pairing && <div className="notice"><code style={{ overflowWrap: 'anywhere' }}>{pairing.code}</code><small>Expires {new Date(pairing.expiresAt).toLocaleTimeString()}</small></div>}
        <p>Configure approved apps, folder aliases, website origins, and fixed commands in <code>companion/config.json</code>. Enabled capabilities are advertised by the laptop.</p>
      </div>
      <form className="form-panel" onSubmit={e => {
        e.preventDefault(); const f = new FormData(e.currentTarget), action: any = { kind }; if (!device) return;
        if (kind === 'open_app') action.app = f.get('app');
        if (kind === 'open_website') action.url = f.get('url');
        if (['open_project', 'read_file', 'write_document', 'move_file', 'run_command'].includes(kind)) action.folder = f.get('folder');
        if (['read_file', 'write_document', 'move_file'].includes(kind)) action.path = f.get('path');
        if (kind === 'write_document') action.text = f.get('text');
        if (kind === 'move_file') action.destination = f.get('destination');
        if (kind === 'run_command') action.command = f.get('command');
        void act(() => api('/devices/' + device.id + '/action', 'POST', action));
      }}><h3>Take an approved action</h3>
        <label>Target device<select value={deviceId} onChange={e => { setDeviceId(e.target.value); setKind('open_app'); }} required>
          <option value="">Choose paired laptop</option>{data.devices.filter(d => !d.revoked).map(d => <option key={d.id} value={d.id}>{d.name} · {Date.now() - Date.parse(d.lastSeen) < 15000 ? 'online' : 'offline'}</option>)}
        </select></label>
        <label>Action<select aria-label="Action" value={kind} onChange={e => setKind(e.target.value)}>{['open_app', 'open_project', 'open_website', 'read_file', 'write_document', 'move_file', 'run_command'].map(k => <option value={k} key={k} disabled={!!device && !device.capabilities.actions.includes(k)}>{k.replaceAll('_', ' ')}</option>)}</select></label>
        {kind === 'open_app' && <label>Approved app<select name="app" required>{device?.capabilities.apps.map(a => <option key={a}>{a}</option>)}</select></label>}
        {kind === 'open_website' && <label>Approved HTTPS website<input name="url" type="url" placeholder="https://code.visualstudio.com" required /></label>}
        {['open_project', 'read_file', 'write_document', 'move_file', 'run_command'].includes(kind) && <label>Approved folder<select name="folder" required>{device?.capabilities.folders.map(a => <option key={a}>{a}</option>)}</select></label>}
        {['read_file', 'write_document', 'move_file'].includes(kind) && <label>Relative path<input name="path" placeholder="notes.txt" required /></label>}
        {kind === 'write_document' && <label>Document contents<textarea name="text" required /></label>}
        {kind === 'move_file' && <label>New relative path (no overwrite)<input name="destination" required /></label>}
        {kind === 'run_command' && <label>Approved fixed command<select name="command" required>{device?.capabilities.commands.map(a => <option key={a}>{a}</option>)}</select></label>}
        <button className="primary" disabled={!device || !device.capabilities.actions.includes(kind)}>Execute on {device?.name || 'selected laptop'}</button>
        <small>Move and development commands also require approval in the laptop terminal.</small>
      </form>
    </div>
    {data.devices.map(d => <div className="list-card" key={d.id}><h3>{d.name} <span className="pill">{d.revoked ? 'revoked' : Date.now() - Date.parse(d.lastSeen) < 15000 ? 'online' : 'offline'}</span></h3>
      <p>{d.platform} · Last heartbeat {new Date(d.lastSeen).toLocaleString()}<br />Enabled: {d.capabilities.actions.join(', ')}<br />Folders: {d.capabilities.folders.join(', ') || 'none'}</p>
      {!d.revoked && <button onClick={() => void act(() => api('/devices/' + d.id, 'DELETE'))}>Revoke device</button>}
    </div>)}
  </section>;
}

function localInput(at: string, timezone: string) {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(at));
  const get = (key: string) => p.find(v => v.type === key)!.value;
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}
function TasksPanel({ data, act }: PanelProps) {
  const [editing, setEditing] = useState<Reminder | null>(null);
  const timezone = editing?.timezone || data.settings.timezone;
  return <section className="page-content">
    <div className="form-panel"><h3>{editing ? 'Edit reminder' : 'Schedule a reminder'}</h3>
      <p>Timezone: {timezone}. In-app delivery is a persistent inbox item; it does not wake a closed browser. Telegram can deliver while the browser is closed.</p>
      <form className="grid" key={editing?.id || 'new'} onSubmit={e => {
        e.preventDefault(); const f = new FormData(e.currentTarget), form = e.currentTarget;
        void act(async () => { await api('/reminders' + (editing ? '/' + editing.id : ''), editing ? 'PUT' : 'POST', { title: f.get('title'), localTime: f.get('localTime'), timezone, recurrence: f.get('recurrence'), channel: f.get('channel') }); form.reset(); setEditing(null); });
      }}>
        <label>What should I remind you about?<input name="title" required maxLength={300} defaultValue={editing?.title} /></label>
        <label>Date and time in {timezone}<input name="localTime" type="datetime-local" required defaultValue={editing ? localInput(editing.at, timezone) : ''} /></label>
        <label>Repeat (only when requested)<select name="recurrence" defaultValue={editing?.recurrence || 'none'}><option value="none">One time</option><option value="daily">Daily</option><option value="weekly">Weekly</option></select></label>
        <label>Delivery channel<select name="channel" defaultValue={editing?.channel || 'in_app'}><option value="in_app">In-app inbox</option><option value="telegram">Verified Telegram destination</option></select></label>
        <button className="primary">{editing ? 'Save changes' : 'Schedule reminder'}</button>{editing && <button type="button" onClick={() => setEditing(null)}>Cancel editing</button>}
      </form>
    </div>
    {data.reminders.map(r => <div className="list-card" key={r.id}><h3>{r.title} <span className="pill">{r.status}</span></h3>
      <p>{new Date(r.at).toLocaleString('en-IN', { timeZone: r.timezone })} · {r.timezone} · {r.recurrence} · {r.channel}</p>
      {r.lastError && <p className="error">{r.lastError}</p>}<div className="row-actions"><button onClick={() => { setEditing(r); window.scrollTo({ top: 0, behavior: 'auto' }); }}>Edit schedule</button><button onClick={() => void act(() => api('/reminders/' + r.id, 'DELETE'))}>Cancel reminder</button></div>
    </div>)}
    {data.notifications.length > 0 && <h2>Reminder inbox</h2>}
    {data.notifications.map(n => <div className="list-card" key={n.id}><span className="pill">Delivered to in-app inbox</span><p>{n.text}</p><small>{new Date(n.createdAt).toLocaleString()}{n.missed ? ' · Delivered after a missed scheduled time' : ''}</small></div>)}
    <h2>Execution history</h2>
    {data.tasks.length ? data.tasks.map(t => <div className="list-card" key={t.id}><h3>{t.title} <span className="pill">{t.state.replaceAll('_', ' ')}</span></h3>
      {t.events.map((e, i) => <div className="event" key={i}><time>{new Date(e.at).toLocaleTimeString()}</time>{e.text}</div>)}
      {t.error && <p className="error">{t.error}</p>}{t.result !== undefined && <details><summary className="hint">Actual result</summary><pre className="task-result">{JSON.stringify(t.result, null, 2)}</pre></details>}
      {!['completed', 'failed', 'cancelled'].includes(t.state) && <div className="row-actions"><button onClick={() => void act(() => api('/tasks/' + t.id + '/cancel', 'POST'))}>Cancel task</button></div>}
    </div>) : <p>No tasks yet. Try “What is the time?” in Assistant.</p>}
  </section>;
}

function MemoryPanel({ data, act }: PanelProps) {
  return <section className="page-content"><div className="grid">
    <form className="form-panel" onSubmit={e => { e.preventDefault(); const form = e.currentTarget, f = new FormData(form); void act(async () => { await api('/memory', 'POST', { context: f.get('context'), key: f.get('key'), value: f.get('value'), provenance: 'Explicit owner entry' }); form.reset(); }); }}>
      <h3>Remember something useful</h3><p>Durable memory is separate from chat. Only matching entries in your selected context are retrieved. Never put credentials here.</p>
      <label>Project or brand context<input name="context" defaultValue={data.settings.context} required /></label><label>Label<input name="key" placeholder="Report style" required /></label><label>What to remember<textarea name="value" required /></label><button className="primary">Save memory</button>
    </form>
    <div className="form-panel"><h3>Your memory, your control</h3><label className="check"><input type="checkbox" checked={data.settings.memoryEnabled} onChange={e => void act(() => api('/settings', 'PUT', { ...data.settings, memoryEnabled: e.target.checked }))} />Enable relevant memory retrieval</label>
      <a href="/api/memory/export" download="lucifer-memory.json">Export memory as JSON ↗</a><p>Deleting a memory removes it from future retrieval. Conversation history has its own controls.</p>
    </div>
  </div>{data.memory.map(m => <form className="list-card" key={m.id + m.updatedAt} onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget); void act(() => api('/memory/' + m.id, 'PUT', { context: f.get('context'), key: f.get('key'), value: f.get('value'), provenance: 'Owner correction' })); }}>
    <h3>{m.key} <span className="pill">{m.context}</span></h3><div className="grid"><label>Context<input name="context" defaultValue={m.context} required /></label><label>Label<input name="key" defaultValue={m.key} required /></label></div><label>Memory value<textarea name="value" defaultValue={m.value} /></label>
    <p>{m.provenance} · Updated {new Date(m.updatedAt).toLocaleString()}</p><div className="row-actions"><button>Save correction</button><button type="button" onClick={() => void act(() => api('/memory/' + m.id, 'DELETE'))}>Delete</button></div>
  </form>)}</section>;
}

function IntegrationsPanel({ data, act }: PanelProps) {
  const [verification, setVerification] = useState<any>(null);
  return <section className="page-content"><div className="grid">{data.integrations.map(i => <div className="form-panel" key={i.id}>
    {i.id !== 'model' && <><h3>{i.name} <span className="pill">{i.status.replaceAll('_', ' ')}</span></h3><p>{i.detail}</p></>}
     {i.id === 'model' && <AIProviderPanel data={data} act={act} />}
    {i.id === 'telegram' && <>
      <button onClick={() => void act(async () => setVerification(await api('/telegram/challenge', 'POST')))}>Verify Telegram destination</button>
      {verification?.telegramCode && <div className="notice">Open <a href={verification.url} target="_blank" rel="noreferrer">@{verification.bot}</a>, or send <code>/start {verification.telegramCode}</code>in a private chat, then click:<button onClick={() => void act(async () => { await api('/telegram/verify', 'POST'); setVerification(null); })}>Check verification</button></div>}
      {data.telegram?.name && <p>Verified destination: {data.telegram.name}</p>}
    </>}
    {i.id !== 'model' && <button disabled={i.id === 'instagram'} onClick={() => void act(() => api('/integrations/' + i.id + '/disconnect', 'POST'))}>Disconnect {i.name}</button>}
  </div>)}</div>
    {data.deliveries.length > 0 && <h2>Delivery receipts and recovery</h2>}
    {data.deliveries.map(d => <div className="list-card" key={d.id}><h3>{d.key} <span className="pill">{d.state}</span></h3>
      <p>{d.receipt ? `Confirmed Telegram message ${d.receipt.messageId} · chat ${d.receipt.chatId}` : d.error || 'Delivery in progress'}</p>
      {d.state === 'uncertain' && <form className="grid" onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget); void act(() => api('/telegram/delivery/' + d.id + '/reconcile', 'POST', { outcome: f.get('outcome'), messageId: f.get('messageId') ? Number(f.get('messageId')) : null })); }}>
        <label>After checking Telegram, what happened?<select name="outcome"><option value="not_received">Not received · allow an explicit retry</option><option value="received">Received · record the observed receipt</option></select></label><label>Message ID, if received<input name="messageId" type="number" min={1} /></label><button>Save reconciliation</button>
      </form>}
    </div>)}
    <h2>Reusable skills</h2><div className="grid">{data.skills.map(s => <div className="list-card" key={s.id}><h3>{s.purpose}</h3><p>Inputs: {s.inputs.join(', ')}<br />Tools: {s.tools.join(', ')}<br />Permissions: {s.permissions.join(', ')}</p><details><summary className="hint">Verification and recovery</summary><p>Output: {s.output}<br />{s.checks.join(' · ')}<br />{s.recovery}</p></details></div>)}</div>
  </section>;
}

function SettingsPanel({ data, act, voiceInfo }: PanelProps & { voiceInfo: VoiceDiagnostics|null }) {
  const s = data.settings;
  return <section className="page-content"><div className="grid"><div className="form-panel"><AIProviderPanel data={data} act={act} /></div><div className="form-panel"><h3>Make it yours</h3>
    <label>Speech recognition language<select value={s.language} onChange={e => void act(() => api('/settings', 'PUT', { ...s, language: e.target.value }))}><option value="auto">Mixed/Tamil · ta-IN recognition</option><option value="en-IN">English · en-IN</option><option value="ta-IN">தமிழ் · ta-IN</option></select></label>
    <p>Browser recognition uses one locale per turn. Tanglish interpretation is handled by your configured model; language accuracy needs a real microphone test.</p>
    <div className="list-card"><h3>Voice diagnosis</h3><p><span className="pill">{voiceInfo?.supported ? 'browser capability detected' : 'text fallback available'}</span> · {voiceInfo?.microphone || 'permission unknown'} · {voiceInfo?.language || 'language pending'}</p><p>{voiceInfo?.note || 'Open this section to inspect browser support and microphone permission without starting a recording.'}</p><small>Speech-service network errors are produced by the browser recognition service and do not test or indicate AI provider connectivity. LUCIFER will not automatically retry recording.</small></div>
    <label>Timezone<input defaultValue={s.timezone} onBlur={e => { if (e.target.value !== s.timezone) void act(() => api('/settings', 'PUT', { ...s, timezone: e.target.value })); }} /></label>
    <label>Selected project / brand context<input defaultValue={s.context} onBlur={e => { if (e.target.value !== s.context) void act(() => api('/settings', 'PUT', { ...s, context: e.target.value })); }} /></label>
    <label className="check"><input type="checkbox" checked={s.spokenReplies} onChange={e => void act(() => api('/settings', 'PUT', { ...s, spokenReplies: e.target.checked }))} />Speak assistant replies</label>
    <label>File retention days (new files)<input type="number" min={1} max={365} defaultValue={s.retentionDays} onBlur={e => { if (Number(e.target.value) !== s.retentionDays) void act(() => api('/settings', 'PUT', { ...s, retentionDays: Number(e.target.value) })); }} /></label>
  </div><div className="form-panel"><h3>Tool permissions</h3><p>Revoking a permission blocks new steps. Already-started external operations may finish; their outcomes stay in task history.</p>
    {Object.entries(s.permissions).map(([key, value]) => <label className="check" key={key}><input type="checkbox" checked={value} onChange={e => void act(() => api('/settings', 'PUT', { ...s, permissions: { ...s.permissions, [key]: e.target.checked } }))} />{key}</label>)}
    <button onClick={() => void act(() => api('/conversation', 'DELETE'))}>Clear conversation history</button>
   </div><NativeVoicePanel /><div className="form-panel wide"><h3>Phone and voice capabilities</h3>
    <p>Android browser/PWA: chat, foreground voice, attachments, PDF previews, task progress, in-app inbox, and paired laptop commands. Open your private HTTPS URL in Chrome, sign in, and use Add to home screen where offered.</p>
    <p>Native Android background push, wake word, app automation, accessibility control, and lock-screen actions are not implemented. Telegram is the supported alternative for notifications while the browser is closed.</p>
    <p>Browser voice sessions are foreground, turn-based Web Speech sessions; their microphone starts when you press its control. Browser Stop cancels browser listening and speech; task cancellation is a separate Tasks control. Windows background listening and its own stop controls are provided by the native tray above.</p>
     <p>Provider setup is also available from Skills & integrations. Google quota, OpenAI API access, and model-dependent charges are separate from this application. Research additionally needs a compatible provider/model.</p>
  </div></div></section>;
}
