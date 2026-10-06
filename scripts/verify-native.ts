import assert from 'node:assert/strict';
import { readFile,writeFile,rm } from 'node:fs/promises';
import path from 'node:path';
import { spawn,execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createConnection } from 'node:net';
import { dpapi } from '../companion/credentials.js';

// Explicit local acceptance diagnostic. It launches Notepad, creates a scoped
// note, exercises hotkeys/startup, and restarts only this project's processes.
if(process.platform!=='win32')throw new Error('Run the bundled diagnostic with Windows Node.');
const run=promisify(execFile),root=process.cwd(),dir=path.join(root,'.local/native');
const readJSON=async(file:string)=>JSON.parse((await readFile(file,'utf8')).replace(/^\uFEFF/,''));
const runtime=await readJSON(path.join(dir,'runtime.json'));
const credentials=JSON.parse(await dpapi(await readFile(path.join(dir,'credential.bin'),'utf8'),true));
const request=async(route:string,body:unknown)=>{
 const response=await fetch('http://127.0.0.1:3001/api/companion/voice/'+route,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+credentials.token},body:JSON.stringify(body),signal:AbortSignal.timeout(85000)});
 const value=await response.json() as any;if(!response.ok)throw new Error('Native verification request rejected: '+route+' ('+response.status+')');return value;
};
const control=(action:string,text?:string)=>new Promise<any>((resolve,reject)=>{
 const socket=createConnection('\\\\.\\pipe\\LUCIFER.Native.micha');let value='';socket.setTimeout(5000,()=>socket.destroy(new Error('Native control timeout')));
 socket.on('connect',()=>socket.write(JSON.stringify({action,text})+'\n'));socket.on('data',data=>{value+=data.toString();if(value.includes('\n')){try{resolve(JSON.parse(value.split('\n')[0]));}catch(error){reject(error);}finally{socket.destroy();}}});socket.on('error',reject);socket.on('close',()=>reject(new Error('Native control closed before a complete response.')));
});
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
async function waitFor(check:()=>Promise<any>,timeout=60000){const until=Date.now()+timeout;while(Date.now()<until){try{const result=await check();if(result)return result;}catch{}await sleep(500);}throw new Error('Native verification timed out.');}
const state=()=>control('state');
const ready=()=>waitFor(async()=>{const value=await state();return value.state==='Listening'&&value.microphone&&value.connected&&value.modelReady&&Date.now()-Date.parse(value.updatedAt)<3000?value:false;});
const ps=async(script:string)=>(await run('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{windowsHide:true,maxBuffer:1024*1024})).stdout.trim();
const processes=async()=>{const value=await ps("Get-CimInstance Win32_Process | Where-Object {$_.Name -in @('LUCIFER.exe','node.exe','python.exe','Notepad.exe','notepad.exe','wsl.exe')} | Select-Object Name,ProcessId,ParentProcessId,CommandLine | ConvertTo-Json -Compress");return JSON.parse(value||'[]') as any[];};
const owned=(all:any[])=>all.filter(p=>p.CommandLine?.toLowerCase().includes(root.toLowerCase())||p.CommandLine?.includes(runtime.wslRoot));
const counts=(all:any[])=>{const own=owned(all);return {trayAndSupervisor:own.filter(p=>p.Name.toLowerCase()==='lucifer.exe').length,workers:own.filter(p=>p.Name==='node.exe'&&p.CommandLine.includes('companion-worker.cjs')).length,pythonLaunchers:own.filter(p=>p.Name==='python.exe'&&p.CommandLine.includes('speech_worker.py')).length};};
let pauseShift=false;
const shortcut=async(key:number)=>{const shift=key===0x4c&&pauseShift;await ps('Add-Type -TypeDefinition \'using System;using System.Runtime.InteropServices;public class LuciferKeys{[DllImport("user32.dll")]public static extern void keybd_event(byte k,byte s,uint f,UIntPtr x);}\'; '+(shift?'[LuciferKeys]::keybd_event(16,0,0,[UIntPtr]::Zero);':'')+'[LuciferKeys]::keybd_event(17,0,0,[UIntPtr]::Zero);[LuciferKeys]::keybd_event(18,0,0,[UIntPtr]::Zero);[LuciferKeys]::keybd_event('+key+',0,0,[UIntPtr]::Zero);[LuciferKeys]::keybd_event('+key+',0,2,[UIntPtr]::Zero);[LuciferKeys]::keybd_event(18,0,2,[UIntPtr]::Zero);[LuciferKeys]::keybd_event(17,0,2,[UIntPtr]::Zero);'+(shift?'[LuciferKeys]::keybd_event(16,0,2,[UIntPtr]::Zero);':''));};
const report:Record<string,unknown>={date:new Date().toISOString(),platform:'win32',backend:'production:3001',providerRequests:0,physicalWake:'not tested',physicalTamilSpeech:'not tested',physicalReboot:'not tested',phoneBackgroundWake:'unsupported'};
try{
 const initial=await ready();report.microphoneAndLocalModelReady=true;assert.ok(initial.pauseHotkey&&initial.stopHotkey,'Global hotkeys registered');pauseShift=initial.pauseShortcut.includes('Shift');report.pauseShortcut=initial.pauseShortcut;
 await shortcut(0x4c);await waitFor(async()=>{const v=await state();return v.state==='Paused'&&!v.microphone;});report.pauseHotkeyClosesMicrophone=true;
 await shortcut(0x4c);await ready();report.resumeHotkeyReopensMicrophone=true;

 const turn=await request('turn',{text:'open Notepad',language:'en'});
 const result=await waitFor(async()=>{const value=await request('result',{taskId:turn.taskId});if(value.state==='failed'||value.state==='cancelled')throw new Error('Windows action did not complete.');return value.state==='completed'?value:false;});
 assert.match(result.reply,/Windows confirmed/);assert.ok((await processes()).some(p=>p.Name.toLowerCase()==='notepad.exe'));report.actualNotepadLaunchAndConfirmedReply=true;

 const filename='native-verification-'+Date.now()+'.txt',text='Harmless native LUCIFER verification note. Created and read by the actual Windows companion.';
 const created=await request('action',{kind:'write_document',folder:'notes',path:filename,text});assert.equal(created.created,filename);
 const read=await request('action',{kind:'read_file',folder:'notes',path:filename});assert.equal(read.text,text);
 const found=await request('action',{kind:'find_files',folder:'notes',query:filename});assert.ok(found.matches.includes(filename));report.actualScopedNote={path:'.local/notes/'+filename,created:true,readBack:true,searchFound:true};
 const denied=await fetch('http://127.0.0.1:3001/api/companion/voice/action',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+credentials.token},body:JSON.stringify({kind:'move_file',folder:'notes',path:filename,destination:'unrequested-move.txt'})});assert.equal(denied.status,400);report.destructiveActionDenied=true;
 await assert.rejects(request('action',{kind:'read_file',folder:'workspace',path:'.local/ai-credentials.key'}));report.privateVaultDenied=true;

 await control('command','What is the time?');await waitFor(async()=>(await state()).phase==='Speaking',20000);
 await shortcut(0x1b);await waitFor(async()=>(await state()).phase==='Wake',10000);report.actualEnglishSpeechAndGlobalStop=true;
 const previousTask=(await state()).lastTaskId;await control('command','நேரம் என்ன');
 const tamilTurn=await waitFor(async()=>{const v=await state();return v.lastTaskId&&v.lastTaskId!==previousTask&&v.phase==='Speaking'?v:false;},20000);
 const tamilReply=await request('result',{taskId:tamilTurn.lastTaskId});assert.equal(tamilReply.state,'completed');assert.match(tamilReply.reply,/[\u0b80-\u0bff]/);await control('stop');await ready();report.tamilUtf8NativePipelineAndSpeechStart=true;

 const tamilInput=path.join(dir,'audio','verification-tamil.txt'),tamilWav=path.join(dir,'audio','verification-tamil.wav');
 await writeFile(tamilInput,'வணக்கம். இனி தமிழில் பேசுகிறேன்.');
 await run(runtime.espeak,['-v','ta','-b','1','-w',tamilWav,'-f',tamilInput],{cwd:path.dirname(runtime.espeak),env:{...process.env,ESPEAK_DATA_PATH:path.dirname(runtime.espeak)},windowsHide:true,timeout:15000});const wave=await readFile(tamilWav);assert.equal(wave.subarray(0,4).toString(),'RIFF');assert.ok(wave.length>32000);assert.ok(wave.subarray(44).some(value=>value!==0));await rm(tamilInput);await rm(tamilWav);report.localTamilWaveGeneration=true;

 await control('startup-off');await waitFor(async()=>!(await state()).startup);await control('startup-on');await waitFor(async()=>(await state()).startup);report.startupEnableDisable=true;
 const before=counts(await processes());assert.equal(before.trayAndSupervisor,2);assert.equal(before.workers,1);assert.ok(before.pythonLaunchers>=1&&before.pythonLaunchers<=2);
 await new Promise<void>((resolve,reject)=>{const duplicate=spawn(path.join(dir,'LUCIFER.exe'),['--supervise'],{windowsHide:true});duplicate.on('error',reject);duplicate.on('exit',code=>code===0?resolve():reject(new Error('Duplicate did not exit cleanly.')));});await sleep(1000);assert.deepEqual(counts(await processes()),before);report.duplicateSupervisorPrevented=true;

 const crash=await ready();await run('taskkill.exe',['/PID',String(crash.processId),'/F'],{windowsHide:true});
 await waitFor(async()=>{const v=await ready();return v.processId!==crash.processId&&v.workerId!==crash.workerId?v:false;},90000);await sleep(3000);
 const after=counts(await processes());assert.equal(after.trayAndSupervisor,2);assert.equal(after.workers,1);assert.ok(after.pythonLaunchers>=1&&after.pythonLaunchers<=2);report.trayCrashRecoveredWithoutDuplicateStack=true;

 await run('wsl.exe',['-d',runtime.distribution,'--cd',runtime.wslRoot,'--','bash','.local/native/stop-backend.sh'],{windowsHide:true,timeout:15000});
 await waitFor(async()=>{const health=await fetch('http://127.0.0.1:3001/api/health',{signal:AbortSignal.timeout(2000)}).then(r=>r.json()) as any;return health.ok;},60000);await ready();report.productionBackendAutomaticallyRecovered=true;
 const final=await ready();assert.ok(final.startup);assert.notEqual(final.processId,initial.processId);report.finalState=final.state;
 const logs=await readFile(path.join(dir,'backend.log'),'utf8');const processText=JSON.stringify(owned(await processes()));assert.ok(!/AIza[\w-]{20,}|sk-[\w-]{20,}|Bearer\s+[\w-]{20,}/.test(logs+processText));assert.ok(!processText.includes(credentials.token));report.noCredentialInLogsOrArguments=true;
 report.passed=true;await writeFile(path.join(root,'.local/verification/native-runtime-results.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{await control('startup-on').catch(()=>{});await control('stop').catch(()=>{});await control('resume').catch(()=>{});}
