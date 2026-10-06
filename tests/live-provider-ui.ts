import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Store } from '../server/store.js';
import { hash } from '../server/auth.js';
import { config } from '../server/config.js';

// Uses the running checkout and real owner records. Only a short-lived diagnostic session
// is inserted; it is removed in finally. No owner password/configuration is changed.
const address = process.argv.slice(2).find(value=>value.startsWith('http')) || 'http://127.0.0.1:5173';
assert.ok(['localhost','127.0.0.1'].includes(new URL(address).hostname));
mkdirSync('.local/verification', { recursive: true });
const store = new Store(config.dataDir);
const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
function snapshot() {
  const records=store.db.prepare('SELECT kind,id,value FROM records ORDER BY kind,id').all() as {kind:string;id:string;value:string}[];
  const rows=Object.fromEntries(records.map(row=>[`${row.kind}/${row.id}`,digest(row.value)]));
  const files:Record<string,string>={};
  const collect=(directory:string)=>{if(!existsSync(directory))return;for(const entry of readdirSync(directory,{withFileTypes:true})){const file=path.join(directory,entry.name);if(entry.isDirectory())collect(file);else if(entry.isFile())files[path.relative(config.root,file)]=digest(readFileSync(file));}};
  collect(path.join(config.dataDir,'files'));
  for(const file of [path.join(config.dataDir,'ai-credentials.key'),path.join(config.dataDir,'ai-credentials.enc'),path.resolve('companion/config.json'),path.resolve('.env')])if(existsSync(file))files[path.relative(config.root,file)]=digest(readFileSync(file));
  return {rows,files};
}
const before=snapshot();
const baseline=path.resolve('.local/verification/preservation-baseline.json');
if(process.argv.includes('--snapshot-only')){writeFileSync(baseline,JSON.stringify(before,null,2));store.close();console.log('Captured owner-record and protected-file hashes for restart verification.');process.exit(0);}
const session=randomBytes(32).toString('base64url');
store.db.prepare('INSERT INTO sessions VALUES(?,?)').run(hash(session),Date.now()+600000);
const {chromium}=await import('playwright');
let browser:Awaited<ReturnType<typeof chromium.launch>>|undefined;
const exceptions:string[]=[],consoleErrors:string[]=[],failed:string[]=[],serverErrors:string[]=[],unexpectedRequests:string[]=[];
try {
  browser=await chromium.launch({headless:true});
  const context=await browser.newContext({viewport:{width:1440,height:1050},reducedMotion:'reduce'});
  await context.addCookies([{name:'lucifer_session',value:session,url:address}]);
  const page=await context.newPage();
  page.on('pageerror',e=>exceptions.push(e.message));
  page.on('console',message=>{if(message.type()==='error')consoleErrors.push(message.text());});
  page.on('requestfailed',request=>failed.push(`${request.method()} ${new URL(request.url()).pathname} ${request.failure()?.errorText}`));
  page.on('response',response=>{if(response.status()>=500)serverErrors.push(`${response.status()} ${new URL(response.url()).pathname}`);});
  page.on('request',request=>{if(!['GET','HEAD'].includes(request.method())&&!request.url().endsWith('/api/integrations/model/test'))unexpectedRequests.push(`${request.method()} ${new URL(request.url()).pathname}`);});
  await page.goto(address);await page.getByLabel('Message LUCIFER').waitFor();
  const state=await context.request.get(address+'/api/state').then(response=>response.json());
  assert.equal(state.ai.credentialSource,'none','Live navigation check requires a no-credential workspace; it will never use an existing key.');
  assert.equal(state.ai.configured,false);
  const form=page.getByRole('form',{name:'AI provider setup'});
  for(const viewport of [{width:1440,height:1050},{width:390,height:844}]){
    await page.setViewportSize(viewport);
    for(const section of ['Settings','Skills & integrations']){
      await page.getByRole('navigation',{name:'Workspace'}).getByRole('button',{name:section,exact:true}).click();
      await page.getByRole('button',{name:'Configure AI provider',exact:true}).click();await form.waitFor();
      for(const provider of ['gemini','openai','ollama']){await form.getByLabel('Provider',{exact:true}).selectOption(provider);await form.getByLabel('Model',{exact:true}).fill(`draft-${provider}`);assert.equal(await form.isVisible(),true);}
      for(const theme of ['light','dark']){
        // Visual check without writing the real owner's theme setting.
        await page.evaluate(theme=>{document.documentElement.dataset.theme=theme;},theme);
        assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
        await page.screenshot({path:`.local/verification/live-${viewport.width}-${theme}-${section==='Settings'?'settings':'integrations'}.png`,fullPage:true});
      }
      await page.reload();await form.waitFor();await form.getByRole('button',{name:'Close',exact:true}).click();
    }
    for(const section of ['Tasks','Devices','Files & reports','Memory','Settings']){
      await page.getByRole('navigation',{name:'Workspace'}).getByRole('button',{name:section,exact:true}).click();
      await page.getByRole('heading',{name:section,exact:true}).waitFor();assert.equal(await page.getByText('This view could not render.',{exact:true}).count(),0);
    }
  }
  // With no credential configured this tests the local error path only, never a provider.
  const test=await context.request.post(address+'/api/integrations/model/test',{headers:{'X-Lucifer-Request':'1'}}).then(response=>response.json());
  assert.match(test.error,/AI is not configured/,'Running API must include the current checkout error handling.');
  assert.equal(test.status.status,'awaiting_configuration');
  assert.deepEqual(snapshot(),before,'Owner records, files, environment, device config, and vault must remain unchanged.');
  if(existsSync(baseline))assert.deepEqual(snapshot(),JSON.parse(readFileSync(baseline,'utf8')),'Project restart must preserve owner records and protected files.');
  assert.deepEqual(exceptions,[]);assert.deepEqual(consoleErrors,[]);assert.deepEqual(failed,[]);assert.deepEqual(serverErrors,[]);assert.deepEqual(unexpectedRequests,[]);
  writeFileSync('.local/verification/live-provider-results.json',JSON.stringify({passed:true,url:address,entryPaths:['Settings','Skills & integrations'],choices:['gemini','openai','ollama'],viewports:[1440,390],themes:['light','dark'],refresh:true,exceptions,consoleErrors,failed,serverErrors,unexpectedRequests,ownerRecordsAndFilesUnchanged:true,recordCount:Object.keys(before.rows).length,protectedFileCount:Object.keys(before.files).length,liveAI:'not tested',blackScreen:'not reproduced after project-only restart'},null,2));
  console.log(`Live checkout navigation passed at ${address}; persistent owner records/files unchanged. No live AI requests.`);
} catch(error) {console.error(JSON.stringify({exceptions,consoleErrors,failed,serverErrors,unexpectedRequests}));throw error;}
finally {await browser?.close();store.db.prepare('DELETE FROM sessions WHERE hash=?').run(hash(session));store.close();}
