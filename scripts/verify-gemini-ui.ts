import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, readdirSync,writeFileSync } from 'node:fs';
import path from 'node:path';
import { Store } from '../server/store.js';
import { hash } from '../server/auth.js';
import { config } from '../server/config.js';

// Read-only owner UI check. Never submits a provider test or creates a chat.
const store=new Store(config.dataDir);
const digest=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
const snapshot=()=>{
  const records=store.db.prepare('SELECT kind,id,value FROM records ORDER BY kind,id').all() as {kind:string;id:string;value:string}[];
   const rows=Object.fromEntries(records.filter(row=>!row.kind.startsWith('native_')&&!(row.kind==='device'&&JSON.parse(row.value).voiceAuthorized)).map(row=>[`${row.kind}/${row.id}`,digest(row.value)]));
  const files:Record<string,string>={};
  const collect=(directory:string)=>{if(!existsSync(directory))return;for(const entry of readdirSync(directory,{withFileTypes:true})){const file=path.join(directory,entry.name);if(entry.isDirectory())collect(file);else if(entry.isFile())files[path.relative(config.root,file)]=digest(readFileSync(file));}};
  collect(path.join(config.dataDir,'files'));
   for(const file of [path.join(config.dataDir,'ai-credentials.key'),path.join(config.dataDir,'ai-credentials.enc'),path.join(config.dataDir,'native/credential.bin'),path.resolve('companion/config.json'),path.resolve('.env')])if(existsSync(file))files[path.relative(config.root,file)]=digest(readFileSync(file));
  return {rows,files};
};
const before=snapshot();
const baseURL=process.env.LUCIFER_URL||'http://127.0.0.1:3001';
const baseline=path.resolve('.local/verification/native-preservation-baseline.json');
if(process.argv.includes('--snapshot-only')){writeFileSync(baseline,JSON.stringify(before));store.close();console.log('Protected owner-record/file baseline saved locally; no credential values printed.');process.exit(0);}
const session=randomBytes(32).toString('base64url');
store.db.prepare('INSERT INTO sessions VALUES(?,?)').run(hash(session),Date.now()+300000);
const {chromium}=await import('playwright');
let browser:Awaited<ReturnType<typeof chromium.launch>>|undefined;
try {
  browser=await chromium.launch({headless:true});
  const context=await browser.newContext({viewport:{width:1440,height:1050}});
   await context.addCookies([{name:'lucifer_session',value:session,url:baseURL}]);
  const page=await context.newPage();const errors:string[]=[];const mutations:string[]=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('request',request=>{if(!['GET','HEAD'].includes(request.method()))mutations.push(request.method());});
   await page.goto(baseURL+'/#settings/ai-provider');
  await page.getByRole('form',{name:'AI provider setup'}).waitFor();
   const state=await context.request.get(baseURL+'/api/state').then(response=>response.json());
  assert.equal(state.ai.provider,'gemini');assert.equal(state.ai.status,'connected');assert.equal(state.ai.apiKey,undefined);
  assert.equal(state.ai.lastDiagnostics.httpStatus,200);assert.equal(state.ai.lastDiagnostics.candidates[0].finishReason,'STOP');
  await page.getByText('Connection diagnostics · sanitized metadata',{exact:true}).click();
  await page.locator('details[open] pre').waitFor();
  assert.equal(await page.getByLabel('API key',{exact:false}).inputValue(),'');
  assert.deepEqual(errors,[]);assert.deepEqual(mutations,[]);
  assert.deepEqual(snapshot(),before,'Owner records and protected files must remain unchanged during the UI check.');
   if(existsSync(baseline)){const expected=JSON.parse(readFileSync(baseline,'utf8'));const actual=snapshot();for(const [key,value]of Object.entries(expected.rows))assert.equal(actual.rows[key],value,'Existing owner record preserved: '+key);for(const [key,value]of Object.entries(expected.files))assert.equal(actual.files[key],value,'Protected file preserved: '+key);}
   await page.getByRole('heading',{name:'Windows background voice',exact:true}).waitFor();
   let nativeReady=false;for(let attempt=0;attempt<40&&!nativeReady;attempt++){const native=await context.request.get(baseURL+'/api/native-voice').then(response=>response.json());nativeReady=native.devices.some((device:any)=>device.state==='Listening'&&device.microphone&&device.modelReady&&Date.now()-Date.parse(device.lastSeen)<10000);if(!nativeReady)await new Promise(r=>setTimeout(r,500));}assert.ok(nativeReady,'Installed native voice heartbeat ready');
   await page.screenshot({path:'.local/verification/native-settings.png',fullPage:true});
  console.log(JSON.stringify({url:page.url(),uiStatus:state.ai.status,modelVersion:state.ai.lastDiagnostics.modelVersion,sanitizedDiagnosticsVisible:true,ownerRecordsPreserved:true,encryptedCredentialsAndFilesPreserved:true,uiErrors:errors,providerRequests:0},null,2));
} finally {await browser?.close();store.db.prepare('DELETE FROM sessions WHERE hash=?').run(hash(session));store.close();}
