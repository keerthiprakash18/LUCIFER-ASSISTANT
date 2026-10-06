import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Store } from '../server/store.js';
import { AIConfigService } from '../server/ai-config.js';
import { GeminiProvider } from '../server/provider.js';
import { GeminiError } from '../server/gemini-response.js';
import { config } from '../server/config.js';

// Explicit, bounded live verification. No request/response content or credentials logged.
// Stop on the first error (including quota); never repeat or switch provider automatically.
const store = new Store(config.dataDir);
const digest=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
const snapshot=()=>{
  const rows=store.db.prepare("SELECT kind,id,value FROM records WHERE kind!='ai_config' ORDER BY kind,id").all() as {kind:string;id:string;value:string}[];
  const files:Record<string,string>={};
  const collect=(dir:string)=>{if(!existsSync(dir))return;for(const entry of readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,entry.name);if(entry.isDirectory())collect(file);else if(entry.isFile())files[path.relative(config.root,file)]=digest(readFileSync(file));}};
  collect(path.join(config.dataDir,'files'));
  for(const name of ['ai-credentials.key','ai-credentials.enc']){const file=path.join(config.dataDir,name);if(existsSync(file))files[name]=digest(readFileSync(file));}
  return {records:rows.map(row=>[row.kind,row.id,digest(row.value)]),files};
};
const before=snapshot();
let requests=0;
const transport:typeof fetch=async(url,init)=>{requests++;return fetch(url,init);};
const ai=new AIConfigService(store,config.dataDir,transport);
const report:Record<string,unknown>={liveVerification:'pending',requests:0};
try {
  const selected=await ai.resolve();
  if(!selected||selected.provider!=='gemini'||!selected.apiKey){report.reason='No selected Gemini server credential is available.';}
  else {
    report.model=selected.model;
    if(process.argv.includes('--context-only')){
      const status=await ai.status();assert.equal(status.status,'connected','Context-only verification requires a previously verified probe.');
      report.probe={verified:status.verified,diagnostics:status.lastDiagnostics,previouslyVerified:true};
    }else{
      const probe=await ai.test(AbortSignal.timeout(35000));
      report.probe={verified:probe.verified,diagnostics:probe.diagnostics};
    }
    const provider=new GeminiProvider(async()=>selected,transport);
    const input={history:[{id:'verification-user-one',role:'user' as const,text:'My test marker is ORCHID-47. Acknowledge the marker in one short sentence.',createdAt:new Date().toISOString()}],context:[],tools:[],signal:AbortSignal.timeout(30000)};
    const first=await provider.respond(input);
    report.contextTurnOne={nonemptyText:!!first.text.trim(),diagnostics:first.diagnostics};
    const second=await provider.respond({...input,signal:AbortSignal.timeout(30000),history:[...input.history,{id:'verification-model-one',role:'assistant',text:first.text,createdAt:new Date().toISOString()},{id:'verification-user-two',role:'user',text:'What test marker did I give in my previous message? Reply only with that marker.',createdAt:new Date().toISOString()}]});
    report.contextTurnTwo={nonemptyText:!!second.text.trim(),retainedContext:second.text.trim()==='ORCHID-47',diagnostics:second.diagnostics};
    assert.equal(second.text.trim(),'ORCHID-47','Two-turn context marker was not retained.');
    report.liveVerification='passed';
  }
} catch(error) {
  // Do not serialize unknown SDK exceptions; only typed sanitized classifications.
  const status=await ai.status();
  report.liveVerification='failed';report.error=error instanceof GeminiError?{code:error.code,message:error.message,diagnostics:error.diagnostics}:{code:status.lastErrorCode,message:status.lastError||'Verification did not complete. Review the sanitized probe status in the UI.',diagnostics:status.lastDiagnostics};process.exitCode=1;
} finally {
  try {assert.deepEqual(snapshot(),before);report.ownerDataAndEncryptedCredentialsPreserved=true;}catch{report.ownerDataAndEncryptedCredentialsPreserved=false;process.exitCode=1;}
  report.requests=requests;store.close();
  mkdirSync('.local/verification',{recursive:true});
  writeFileSync('.local/verification/gemini-live-results.json',JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
}
