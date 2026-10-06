import { readFile,writeFile,mkdir } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { Store,id,now } from '../server/store.js';
import { hash } from '../server/auth.js';

const root=process.cwd();const dir=path.join(root,'.local/native');await mkdir(dir,{recursive:true});
const input=JSON.parse((await readFile(path.join(dir,'install-request.json'),'utf8')).replace(/^\uFEFF/,''));
const owner=root.match(/\/Users\/([^/]+)\//i)?.[1];
if(!owner||input.windowsOwner.toLowerCase()!==owner.toLowerCase())throw new Error('Installer owner does not match this workspace owner location');
const store=new Store(path.join(root,'.local'));
if(!store.get('owner','owner'))throw new Error('Existing owner setup is required; no account will be recreated.');
const protect=(value:string,decrypt=false)=>new Promise<string>((resolve,reject)=>{const script='Add-Type -AssemblyName System.Security; $x=[Console]::In.ReadToEnd(); '+(decrypt?'[Text.Encoding]::UTF8.GetString([Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String($x),$null,[Security.Cryptography.DataProtectionScope]::CurrentUser))':'[Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Protect([Text.Encoding]::UTF8.GetBytes($x),$null,[Security.Cryptography.DataProtectionScope]::CurrentUser))');const child=spawn('/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{stdio:['pipe','pipe','ignore']});let output='';child.stdout.on('data',b=>output+=b);child.on('close',code=>code===0?resolve(output.trim()):reject(new Error('Windows credential protection failed')));child.stdin.end(value);});
try{
  let existing:any;try{existing=JSON.parse(await protect(await readFile(path.join(dir,'credential.bin'),'utf8'),true));}catch{}
  if(existing&&store.get<any>('credential',existing.deviceId)?.hash===hash(existing.token)&&!store.get<any>('device',existing.deviceId)?.revoked){console.log('Existing native device credential retained.');}
  else{
    const deviceId=id(),token=randomBytes(32).toString('base64url');
    store.put('device',{id:deviceId,name:'LUCIFER Windows voice · '+input.windowsOwner,platform:'win32',capabilities:input.capabilities,lastSeen:now(),revoked:false,voiceAuthorized:true});
    store.put('credential',{id:deviceId,hash:hash(token)});
    await writeFile(path.join(dir,'credential.bin'),await protect(JSON.stringify({deviceId,token})),{mode:0o600});
    console.log('Native Windows device authorized; existing devices and owner records preserved.');
  }
}finally{store.close();}
