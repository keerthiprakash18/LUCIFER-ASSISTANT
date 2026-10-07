import { readFile,writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import path from 'node:path';
import { createServer } from 'node:net';
import { policySchema,executeAction,validateServer } from './policy.js';
import { dpapi } from './credentials.js';
import { redact } from '../server/auth.js';
import {closeBrowser} from './browser.js';

async function main(){
// A tray crash closes stdin, but an in-flight request can take time to abort.
// Hold an exclusive local named pipe so recovery never runs a second worker.
const ownership=createServer(socket=>socket.destroy());
await new Promise<void>((resolve,reject)=>{ownership.once('error',reject);ownership.listen('\\\\.\\pipe\\LUCIFER.Native.worker.'+process.env.USERNAME,resolve);});
const directory=path.resolve('.local/native');
const readJSON=async(file:string)=>JSON.parse((await readFile(file,'utf8')).replace(/^\uFEFF/,''));
let policy=policySchema.parse(await readJSON(path.join(directory,'policy.json')));validateServer(policy.server);
const credentials=JSON.parse(await dpapi(await readFile(path.join(directory,'credential.bin'),'utf8'),true));
const emit=(value:unknown)=>process.stdout.write(JSON.stringify(value)+'\n');
const capabilities=()=>({apps:Object.keys(policy.apps),folders:Object.keys(policy.folders),commands:Object.keys(policy.commands),actions:policy.actions});
const shutdown=new AbortController();
const request=async(route:string,body:unknown,signal?:AbortSignal)=>{const response=await fetch(policy.server+'/api/companion/'+route,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+credentials.token},body:JSON.stringify(body),signal:AbortSignal.any([...(route==='voice/stop'?[]:[shutdown.signal]),AbortSignal.timeout(route==='voice/stop'?3000:15000),...(signal?[signal]:[])])});const result=await response.json() as any;if(!response.ok)throw new Error(result.error||'Backend request failed');return result;};
const actions=new Map<string,AbortController>();let voice:AbortController|undefined;let stopped=false;let status={state:'Listening',detail:'Waiting for local wake word',microphone:false,modelReady:false};
let receipts:Record<string,any>={};try{receipts=JSON.parse(await readFile(path.join(directory,'receipts.json'),'utf8'));}catch{}
let saving=Promise.resolve();
const saveReceipts=()=>saving=saving.then(()=>writeFile(path.join(directory,'receipts.json'),JSON.stringify(receipts),{mode:0o600}));
let stopPending=Promise.resolve();
const stop=()=>{voice?.abort();for(const controller of actions.values())controller.abort();return stopPending=stopPending.then(()=>request('voice/stop',{})).then(()=>{},()=>{});};
const lines=createInterface({input:process.stdin});
lines.on('line',line=>{void(async()=>{try{const input=JSON.parse(line);if(input.kind==='status'){status=JSON.parse(redact(JSON.stringify(input.status)));return;}if(input.kind==='stop'){await stop();emit({kind:'stopped'});return;}if(input.kind==='exit'){stopped=true;await stop();await closeBrowser();lines.close();return;}
  if(input.kind==='command'){
    await stopPending;
    if(voice&&!voice.signal.aborted){emit({kind:'reply',id:input.id,error:'An instruction is already running.'});return;}
    const controller=voice=new AbortController();
    try{
      const turn=await request('voice/turn',{text:String(input.text).slice(0,12000),language:input.replyLanguage||'auto'},controller.signal);
      const deadline=Date.now()+120000;let observedState='';emit({kind:'progress',id:input.id,taskId:turn.taskId,state:'accepted',detail:'Backend accepted the activated instruction.'});
      while(Date.now()<deadline){controller.signal.throwIfAborted();const result=await request('voice/result',{taskId:turn.taskId},controller.signal);if(result.state&&result.state!==observedState){observedState=result.state;emit({kind:'progress',id:input.id,taskId:turn.taskId,state:result.state,detail:'Backend task state: '+result.state.replaceAll('_',' ')});}if(['completed','failed','cancelled','partially_completed','awaiting_authorization','awaiting_input'].includes(result.state)){emit({kind:'reply',id:input.id,taskId:turn.taskId,state:result.state,reply:result.reply,error:result.error||(['failed','cancelled'].includes(result.state)?'The action did not complete.':undefined)});return;}await new Promise(r=>setTimeout(r,120));}
      await stop();emit({kind:'reply',id:input.id,error:'Timed out waiting for a confirmed result. Completion is not assumed.'});
    }catch(error){if(controller.signal.aborted)await request('voice/stop',{}).catch(()=>{});emit({kind:'reply',id:input.id,error:controller.signal.aborted?'Stopped.':redact((error as Error).message)});}finally{if(voice===controller)voice=undefined;}
  }
}catch{emit({kind:'error',error:'Invalid native control input.'});}})();});
lines.on('close',()=>{stopped=true;voice?.abort();for(const c of actions.values())c.abort();shutdown.abort();void request('voice/stop',{}).catch(()=>{}).then(()=>closeBrowser()).finally(()=>ownership.close());});
while(!stopped){
  try{
    policy=policySchema.parse(await readJSON(path.join(directory,'policy.json')));
    const poll=await request('poll',{capabilities:capabilities()});
    for(const [key,controller] of actions)if(poll.stopped||poll.cancelled.includes(key))controller.abort();
    const command=poll.command;
    if(command&&!actions.has(command.id)){
      if(receipts[command.id])await request('result',{commandId:command.id,...receipts[command.id]});
      else{
        receipts[command.id]={ok:false,result:{error:'Execution began; final outcome unknown. It will not be replayed.'}};await saveReceipts();
        const controller=new AbortController();actions.set(command.id,controller);
        void(async()=>{let result;try{if(Date.parse(command.expiresAt)<Date.now())throw new Error('Command expired');result={ok:true,result:await executeAction(policy,command.action,controller.signal,async()=>command.ownerApproved===true)};}catch(e){result={ok:false,result:{error:redact((e as Error).message)}};}receipts[command.id]=result;await saveReceipts();actions.delete(command.id);})();
      }
    }
    for(const [commandId,result] of Object.entries(receipts))if(!actions.has(commandId)){try{await request('result',{commandId,...result});delete receipts[commandId];await saveReceipts();}catch{}}
    const heartbeat=await request('voice/heartbeat',status);emit({kind:'ready',deviceId:credentials.deviceId,emergency:heartbeat.emergency});if(heartbeat.control)emit({kind:'control',action:heartbeat.control});
  }catch(error){const message=(error as Error).message==='fetch failed'?'Production backend unavailable at localhost:3001; retrying.':redact((error as Error).message);emit({kind:'disconnected',error:message});for(const c of actions.values())c.abort();}
  await new Promise(r=>setTimeout(r,700));
}
await saveReceipts();
}
void main().catch(()=>{process.stderr.write('Native companion initialization failed. Check protected pairing and policy configuration.\n');process.exit(1);});
