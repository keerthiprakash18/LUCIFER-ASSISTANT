import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { config } from '../server/config.js';
import { createApp } from '../server/app.js';
import { setOwner } from '../server/auth.js';
import { defaultSettings } from '../shared/contracts.js';

mkdirSync('.local/verification', { recursive: true });
const directory = mkdtempSync(path.resolve('.local/verification/provider-ui-'));
// No configured credentials, remote requests, model downloads, or owner-data writes.
const previous = { origin: config.origin, provider: config.provider, apiKey: config.apiKey, geminiApiKey: config.geminiApiKey };
config.provider = 'gemini'; config.apiKey = ''; config.geminiApiKey = '';
const service = await createApp(directory);
setOwner(service.store, 'isolated-provider-ui-password');
service.store.put('settings', { id: 'owner', ...structuredClone(defaultSettings) });
const now = new Date().toISOString();
const saved = [
  ['message', { id: 'saved-conversation', role: 'user', text: 'Preserved conversation fixture', createdAt: now }],
  ['memory', { id: 'saved-memory', context: 'personal', key: 'Preserved preference', value: 'Preserved value', provenance: 'Owner fixture', updatedAt: now }],
  ['reminder', { id: 'saved-reminder', title: 'Preserved reminder', at: '2030-01-01T01:00:00Z', timezone: 'Asia/Kolkata', recurrence: 'none', channel: 'in_app', status: 'scheduled' }],
  ['device', { id: 'saved-device', name: 'Preserved laptop', platform: 'windows', lastSeen: now, revoked: false, capabilities: { apps: [], folders: [], commands: [], actions: [] } }],
] as const;
for (const [kind, record] of saved) service.store.put(kind, record);
const owner = JSON.stringify(service.store.get('owner', 'owner'));
const address = await service.app.listen({ host: '127.0.0.1', port: 0 }); config.origin = address;
const { chromium } = await import('playwright');
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1050 }, reducedMotion: 'reduce' });
await context.addInitScript(()=>{
  const target=window as any;target.microphoneStarts=0;
  target.SpeechRecognition=class {
    onstart:any;onerror:any;onend:any;
    start(){target.microphoneStarts++;this.onstart?.();setTimeout(()=>{this.onerror?.({error:'network'});this.onend?.();},10);}
    abort(){}stop(){}
  };
});
const page = await context.newPage();
const exceptions: string[] = [], consoleErrors: string[] = [], httpErrors: string[] = [], failedRequests: string[] = [], sdkRequests: string[] = [];
let configRequests = 0, testRequests = 0;
page.on('pageerror', e => exceptions.push(e.message));
page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('response', r => { if (r.status() >= 400) httpErrors.push(`${r.status()} ${r.request().method()} ${new URL(r.url()).pathname}`); });
page.on('requestfailed', r => failedRequests.push(`${r.method()} ${new URL(r.url()).pathname} ${r.failure()?.errorText}`));
page.on('request', r => {
  if (r.method() === 'PUT' && r.url().endsWith('/api/integrations/model/config')) configRequests++;
  if (r.url().endsWith('/api/integrations/model/test')) testRequests++;
  if (/generativelanguage|api\.openai|11434|@google\/genai|ollama/.test(r.url())) sdkRequests.push(new URL(r.url()).pathname);
});
const form = page.getByRole('form', { name: 'AI provider setup' });
const navigate = async (section: string) => { await page.getByRole('navigation', { name: 'Workspace' }).getByRole('button', { name: section, exact: true }).click(); await page.getByRole('heading', { name: section, exact: true }).waitFor(); };
const open = async (section: string) => { await navigate(section); await page.getByRole('button', { name: /Configure AI provider|Manage AI provider/, exact: true }).click(); await form.waitFor(); };
const ready = () => page.waitForFunction(() => document.querySelector('form.setup-card')?.getAttribute('aria-busy') === 'false');
try {
  await page.goto(address);
  await page.getByLabel('Owner password').fill('isolated-provider-ui-password');
  await page.getByRole('button', { name: 'Enter workspace' }).click();
  await page.getByRole('heading', { name: 'What’s on your mind?' }).waitFor();
  for (const section of ['Settings', 'Skills & integrations']) {
    await open(section);
    // The regression fails against the original live module: Settings had no configure control.
    for (const provider of ['gemini', 'openai', 'ollama', 'custom']) {
      await form.getByLabel('Provider', { exact: true }).selectOption(provider);
      await form.getByLabel('Model', { exact: true }).fill(`unsaved-${provider}`);
      if(provider==='custom'){await form.getByLabel('Provider name',{exact:true}).fill('Unsaved custom');await form.getByLabel('Base URL',{exact:true}).fill('https://custom.example/v1');await form.getByLabel('API protocol',{exact:true}).selectOption('responses');}
    }
    for (const provider of ['gemini', 'openai', 'ollama', 'custom']) {
      await form.getByLabel('Provider', { exact: true }).selectOption(provider);
      assert.equal(await form.getByLabel('Model', { exact: true }).inputValue(), `unsaved-${provider}`);
      assert.equal(await form.getByLabel('API key', { exact: false }).count(), provider === 'ollama' ? 0 : 1);
      if(provider==='custom'){assert.equal(await form.getByLabel('Provider name',{exact:true}).inputValue(),'Unsaved custom');assert.equal(await form.getByLabel('API protocol',{exact:true}).inputValue(),'responses');assert.equal(await form.getByText(/structured function call/i).count(),1);}
    }
    assert.equal(configRequests, 0); assert.equal(testRequests, 0);
    await page.reload(); await form.waitFor(); // Restore navigation/open state, never a key from browser storage.
    await form.getByRole('button', { name: 'Close', exact: true }).click();
  }
  await open('Settings');
  for (const provider of ['gemini', 'openai', 'ollama']) {
    await form.getByLabel('Provider', { exact: true }).selectOption(provider);
    await form.getByLabel('Model', { exact: true }).fill(provider === 'ollama' ? 'gemma3:1b' : `unconfigured-${provider}`);
    if (provider === 'ollama') await form.getByLabel('Base URL', { exact: true }).fill('http://127.0.0.1:1');
    await form.getByRole('button', { name: 'Save and test connection' }).click(); await ready();
    const result = await form.getByRole('status').innerText();
    assert.match(result, provider === 'ollama' ? /not reachable|failed/i : /key|configure/i);
    assert.doesNotMatch(result, /^Connection verified/);
    assert.equal(await form.getByLabel('Model', { exact: true }).inputValue(), provider === 'ollama' ? 'gemma3:1b' : `unconfigured-${provider}`);
  }
  assert.equal(testRequests, 1, 'Only explicit Ollama test should reach the test endpoint without keys');
  assert.equal((await service.ai.status()).status, 'connection_failed');
  await form.getByLabel('Provider', { exact: true }).selectOption('gemini');

  // Slow backend: progress, cancellation, synchronous double-submit guard, draft retention.
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/integrations/model/config', async route => { await gate; await route.fulfill({ status: 503, json: { error: 'Temporary server failure. Retry.' } }).catch(() => {}); });
  const before = configRequests;
  await form.getByRole('button', { name: 'Save and test connection' }).click();
  await form.getByRole('button', { name: 'Cancel request' }).waitFor();
  await form.evaluate((element: HTMLFormElement) => { element.requestSubmit(); element.requestSubmit(); });
  assert.equal(configRequests, before + 1);
  await form.getByRole('button', { name: 'Cancel request' }).click(); await ready();
  assert.match(await form.getByRole('status').innerText(), /cancelled/i);
  release(); await page.unroute('**/api/integrations/model/config');
  assert.equal(await form.getByLabel('Model', { exact: true }).inputValue(), 'unconfigured-gemini');

  for (const response of [
    { status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Temporary server failure. Retry.' }) },
    { status: 200, contentType: 'text/html', body: '<html>Proxy error</html>' },
    { status: 200, contentType: 'application/json', body: '{}' },
  ]) {
    await page.route('**/api/integrations/model/config', route => route.fulfill(response));
    await form.getByRole('button', { name: 'Save configuration' }).click(); await ready();
    assert.match(await form.getByRole('status').innerText(), /failure|unreadable|invalid/i);
    assert.equal(await form.getByLabel('Model', { exact: true }).inputValue(), 'unconfigured-gemini');
    await page.unroute('**/api/integrations/model/config');
  }

  // Workspace polling must retain a usable last-good view after bad JSON or a failed response.
  for (const response of [ { status: 503, json: { error: 'Workspace temporarily unavailable.' } }, { status: 200, json: { settings: null } } ]) {
    await page.route('**/api/state', route => route.fulfill(response));
    await page.getByRole('alert').filter({ hasText: /last loaded workspace/ }).waitFor();
    assert.equal(await form.isVisible(), true);
    await page.unroute('**/api/state');
    await page.getByRole('button', { name: 'Retry loading workspace' }).click();
    await page.getByRole('alert').filter({ hasText: /last loaded workspace/ }).waitFor({ state: 'hidden' });
  }
  // A thrown view error must be contained, with working retry and back navigation.
  const exceptionStart=exceptions.length,consoleStart=consoleErrors.length;
  await page.route('**/api/state',async route=>{const response=await route.fetch();const body=await response.json();body.reminders[0].timezone='invalid-timezone';await route.fulfill({json:body});});
  await navigate('Tasks');
  await page.getByText('This view could not render.',{exact:true}).waitFor();
  await page.unroute('**/api/state');
  await page.waitForTimeout(2000);
  await page.getByRole('button',{name:'Retry view',exact:true}).click();
  await page.getByText('Preserved reminder',{exact:false}).first().waitFor();
  await page.route('**/api/state',async route=>{const response=await route.fetch();const body=await response.json();body.reminders[0].timezone='invalid-timezone';await route.fulfill({json:body});});
  await page.getByText('This view could not render.',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Back to Assistant',exact:true}).click();
  await page.getByLabel('Message LUCIFER').waitFor();
  await page.unroute('**/api/state');
  const boundaryExceptions=exceptions.splice(exceptionStart),boundaryConsole=consoleErrors.splice(consoleStart);
  assert.ok(boundaryExceptions.every(error=>/time zone|timezone/i.test(error)));
  assert.ok(boundaryConsole.every(error=>/LUCIFER UI rendering error|time zone|timezone/i.test(error)));
  for (const viewport of [{ width: 1440, height: 1050 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    for (const theme of ['dark', 'light']) {
      await page.getByRole('button', { name: 'Toggle dark theme' }).click();
      await page.waitForFunction(expected => document.documentElement.dataset.theme === expected, theme);
      for (const section of ['Tasks', 'Devices', 'Skills & integrations', 'Files & reports', 'Memory', 'Settings']) {
        await navigate(section);
        assert.equal(await page.getByText('This view could not render.', { exact: true }).count(), 0);
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${section} overflowed ${viewport.width}px in ${theme}`);
        if(section==='Tasks'){
          await page.getByRole('button',{name:'Edit schedule',exact:true}).click();
          assert.equal(await page.getByLabel('What should I remind you about?',{exact:true}).inputValue(),'Preserved reminder');
          await page.getByRole('button',{name:'Cancel editing',exact:true}).click();
        }
        if(section==='Skills & integrations'){
          await page.getByText('Verification and recovery',{exact:true}).first().click();
          assert.ok(await page.locator('details[open]').count()>0);
        }
      }
      await open('Skills & integrations');
      await form.getByLabel('Provider', { exact: true }).selectOption('ollama');
      await page.screenshot({ path: `.local/verification/provider-${viewport.width}-${theme}.png`, fullPage: true });
      await form.getByRole('button', { name: 'Close', exact: true }).click();
      await page.getByRole('navigation', { name: 'Workspace' }).getByRole('button', { name: 'Assistant', exact: true }).click();
      await page.getByLabel('Message LUCIFER').waitFor();
    }
  }
  // No-AI chat should give setup guidance, and local clock remains independently usable.
  await service.ai.disconnect();
  service.store.remove('ai_config','model');
  const settings=service.store.get<any>('settings','owner');service.store.put('settings',{...settings,permissions:{...settings.permissions,model:true}});
  await page.getByLabel('Message LUCIFER').fill('Help me plan my week');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await page.locator('.message.assistant').filter({ hasText: 'AI is not configured' }).waitFor();
  await page.getByLabel('Message LUCIFER').fill('What is the time?');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await page.locator('.message.assistant').filter({ hasText: 'Asia/Kolkata' }).waitFor();
  assert.equal(await page.evaluate(()=>(window as any).microphoneStarts),0,'Navigation must never start a microphone');
  await page.getByRole('button',{name:'Start microphone',exact:true}).click();
  await page.getByRole('alert').filter({hasText:'browser speech service'}).waitFor();
  await page.waitForTimeout(2100);
  assert.equal(await page.evaluate(()=>(window as any).microphoneStarts),1,'A speech network error must not start a retry loop');
  await page.getByLabel('Message LUCIFER').fill('Text remains available');
  assert.equal(await page.getByLabel('Message LUCIFER').inputValue(),'Text remains available');
  assert.equal(JSON.stringify(service.store.get('owner', 'owner')), owner);
  for (const [kind, record] of saved) assert.deepEqual(service.store.get(kind,record.id), record);
  assert.deepEqual(exceptions, []); assert.deepEqual(sdkRequests, []);
  assert.deepEqual(consoleErrors.filter(error => !/Failed to load resource/.test(error)), []);
  writeFileSync('.local/verification/provider-ui-results.json', JSON.stringify({ passed: true, entryPaths: ['Settings','Skills & integrations'], choices: ['gemini','custom','freellmapi','openai','ollama'], credentials: 'none', pageExceptions: exceptions, consoleErrors, httpErrors, failedRequests, sdkRequests, recovery: ['slow backend','cancel','duplicate submit','HTTP 503','HTML response','invalid status','invalid workspace','error boundary retry/back','refresh'], boundaryExceptions,boundaryConsole,viewports: [1440,390], themes: ['light','dark'], savedRecordsPreserved: true, speech:'synthetic network-error event, no automatic retry, text usable',liveAI: 'not tested' }, null, 2));
  console.log('Provider UI regression passed: both entries, drafts, errors/cancel, refresh, sections, themes, narrow layout. No live AI requests.');
} catch(error) {
  await page.screenshot({ path: '.local/verification/provider-ui-failure.png', fullPage: true }).catch(()=>{});
  console.error(JSON.stringify({ exceptions, consoleErrors, httpErrors, failedRequests })); throw error;
} finally { await browser.close(); await service.app.close(); Object.assign(config,previous); }
