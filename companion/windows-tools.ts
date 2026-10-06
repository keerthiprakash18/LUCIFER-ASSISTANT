import {spawn} from 'node:child_process';
import path from 'node:path';
import {redact} from '../server/auth.js';
export function windowsTool(input:unknown,signal:AbortSignal):Promise<any>{return new Promise((resolve,reject)=>{const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-File',path.resolve('companion/native/windows-tools.ps1')],{shell:false,windowsHide:true,signal});let out='';child.stdout.on('data',data=>out+=data);child.stderr.on('data',()=>{});child.on('error',reject);child.on('close',code=>{if(code!==0)return reject(new Error('Windows capability inspection failed'));try{resolve(JSON.parse(redact(out)));}catch{reject(new Error('Windows inspection returned invalid metadata'));}});child.stdin.end(JSON.stringify(input));});}
export const discoverApps=(signal:AbortSignal)=>windowsTool({operation:'discover'},signal);
export const observeApp=(executable:string,signal:AbortSignal)=>windowsTool({operation:'observe',executable},signal);
