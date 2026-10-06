import { readFile,writeFile,mkdir } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import path from 'node:path';
import { policySchema,validateServer,executeAction } from './policy.js';
import { redact } from '../server/auth.js';
import { dpapi } from './credentials.js';
const directory=path.resolve('.local/companion');await mkdir(directory,{recursive:true,mode:0o700});
const policy=policySchema.parse(JSON.parse(await readFile('companion/config.json','utf8')));validateServer(policy.server);
if(process.platform!=='win32')throw new Error('Run this companion with Windows Node.js 24 in PowerShell. Linux policy behavior is tested separately.');
const capabilities={apps:Object.keys(policy.apps),folders:Object.keys(policy.folders),commands:Object.keys(policy.commands),actions:policy.actions};
const credentialPath=path.join(directory,'credential.bin');
let credentials:{deviceId:string;token:string};
const rl=createInterface({input:process.stdin,output:process.stdout});
async function request(route:string,body:unknown,token?:string){const r=await fetch(policy.server.replace(/\/$/,'')+'/api/companion/'+route,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});const data=await r.json() as any;if(!r.ok)throw new Error(data.error||`Server HTTP ${r.status}`);return data;}
try{credentials=JSON.parse(await dpapi(await readFile(credentialPath,'utf8'),true));}catch{const code=await rl.question('Pairing challenge from the Devices panel: ');credentials=await request('register',{code:code.trim(),name:policy.name,platform:process.platform,capabilities});await writeFile(credentialPath,await dpapi(JSON.stringify(credentials)),{mode:0o600});}
console.log(`LUCIFER companion: ${policy.name}. Enabled actions: ${capabilities.actions.join(', ')}. Ctrl+C stops polling.`);
let receipts:Record<string,any>={};try{receipts=JSON.parse(await readFile(path.join(directory,'receipts.json'),'utf8'));}catch{}
const active=new Map<string,AbortController>();let stopped=false;
process.on('SIGINT',()=>{stopped=true;for(const c of active.values())c.abort();rl.close();});
async function result(commandId:string,body:any){await request('result',{commandId,...body},credentials.token);}
while(!stopped){try{const poll=await request('poll',{capabilities},credentials.token);console.log(poll.stopped?'Emergency stop active.':'Connected · '+new Date().toLocaleTimeString());for(const [key,controller]of active)if(poll.stopped||poll.cancelled.includes(key))controller.abort();const command=poll.command;if(command){if(receipts[command.id]){void result(command.id,receipts[command.id]).catch(()=>{});}else{receipts[command.id]={ok:false,result:{error:'Execution started; final outcome unknown. It will not be replayed.'}};await writeFile(path.join(directory,'receipts.json'),JSON.stringify(receipts),{mode:0o600});const controller=new AbortController();active.set(command.id,controller);void(async()=>{let body:any;try{if(Date.parse(command.expiresAt)<Date.now())throw new Error('Command expired');body={ok:true,result:await executeAction(policy,command.action,controller.signal,async action=>/^yes$/i.test(await rl.question(`Authorize ${action.kind} ${JSON.stringify(action)}? Type yes: `)))};}catch(e){body={ok:false,result:{error:redact((e as Error).message)}};}receipts[command.id]=body;await writeFile(path.join(directory,'receipts.json'),JSON.stringify(receipts),{mode:0o600});try{await result(command.id,body);}catch{console.log('Result retained locally; delivery will retry without re-executing.');}finally{active.delete(command.id);}})();}}
 for(const [commandId,body]of Object.entries(receipts)){if(!active.has(commandId))try{await result(commandId,body);delete receipts[commandId];await writeFile(path.join(directory,'receipts.json'),JSON.stringify(receipts),{mode:0o600});}catch{}}
}catch(e){console.log('Disconnected: '+redact((e as Error).message));for(const controller of active.values())controller.abort();}await new Promise(r=>setTimeout(r,3000));}
