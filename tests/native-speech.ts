import assert from 'node:assert/strict';
import { spawn,execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile,writeFile,rm } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
if(process.platform!=='win32')throw new Error('This offline speech check requires Windows.');
const run=promisify(execFile),root=process.cwd(),native=path.join(root,'.local/native');
const runtime=JSON.parse((await readFile(path.join(native,'runtime.json'),'utf8')).replace(/^\uFEFF/,''));
const audio=path.join(native,'audio',randomUUID()+'.wav');
const wakeAudio=path.join(native,'audio',randomUUID()+'.wav'),ambientAudio=path.join(native,'audio',randomUUID()+'.wav');
const sentinel=path.join(root,'.local/verification','speech-preserve-'+randomUUID()+'.txt');
const quote=(text:string)=>"'"+text.replaceAll("'","''")+"'";
let exited=false;
try{
 const script="$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.Speech; $format=New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000,[System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen,[System.Speech.AudioFormat.AudioChannel]::Mono); $s=New-Object System.Speech.Synthesis.SpeechSynthesizer; $s.SetOutputToWaveFile("+quote(audio)+",$format); $s.Speak('Lucifer, open Notepad.'); $s.Dispose(); $s=New-Object System.Speech.Synthesis.SpeechSynthesizer; $s.SetOutputToWaveFile("+quote(ambientAudio)+",$format); $s.Speak('This is only a harmless local sound test.'); $s.Dispose();";
 await run('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{windowsHide:true});await writeFile(wakeAudio,await readFile(audio));
 await run('powershell.exe',['-NoProfile','-NonInteractive','-File',path.join(root,'scripts/native-control.ps1'),'-Action','exit'],{windowsHide:true});exited=true;
 await new Promise(r=>setTimeout(r,5000));
 await writeFile(sentinel,'Synthetic outside-audio file: must survive rejected transcription.');
 const messages=await new Promise<any[]>((resolve,reject)=>{
  const child=spawn(runtime.python,['-X','utf8','-u',path.join(root,'companion/native/speech_worker.py')],{cwd:root,windowsHide:true,stdio:['pipe','pipe','pipe']});let output='',errors='';
  const timer=setTimeout(()=>{void run('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true});reject(new Error('Offline transcription timed out.'));},90000);
  child.stdout.on('data',data=>output+=data);child.stderr.on('data',data=>errors+=data);
  child.on('error',error=>{clearTimeout(timer);reject(error);});child.on('exit',code=>{clearTimeout(timer);if(code!==0)return reject(new Error('Offline speech process failed: '+errors.slice(0,200)));resolve(output.trim().split(/\r?\n/).map(line=>JSON.parse(line)));});
   child.stdin.end(JSON.stringify({id:1,path:audio,language:'auto'})+'\n'+JSON.stringify({id:2,path:sentinel,language:'auto'})+'\n'+JSON.stringify({id:3,path:wakeAudio,language:'auto',mode:'wake'})+'\n'+JSON.stringify({id:4,path:ambientAudio,language:'auto',mode:'wake'})+'\n');
 });
 assert.ok(messages.some(m=>m.kind==='ready'&&m.offline));const transcript=messages.find(m=>m.kind==='transcript');assert.match(transcript?.text||'',/lucifer[\s,.]*open notepad/i,'Synthetic fixture diagnostic: '+JSON.stringify(messages));
 assert.ok(messages.some(m=>m.kind==='error'&&m.errorType==='ValueError'));assert.equal(await readFile(sentinel,'utf8'),'Synthetic outside-audio file: must survive rejected transcription.');
 const wake=messages.find(message=>message.kind==='wake'&&message.id===3),ambient=messages.find(message=>message.kind==='wake'&&message.id===4);assert.equal(wake.wake,true);assert.match(wake.text,/open notepad/i);assert.equal(ambient.wake,false);assert.equal(ambient.text,'');
 const report={passed:true,fixture:'Synthetic Windows English system voice, not the microphone',wakeDetector:'Local multilingual Whisper utterance detection',activatedCommand:wake.text,ambientTranscriptWithheld:true,localWhisperTranscript:transcript.text,outsideAudioFileRejectedAndPreserved:true,offline:true,providerRequests:0,physicalEnglishTamilTanglish:'not tested'};
 await writeFile('.local/verification/native-speech-results.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{
  await rm(audio,{force:true});
  await rm(wakeAudio,{force:true});await rm(ambientAudio,{force:true});
 await rm(sentinel,{force:true});
 if(exited){const tray=spawn(path.join(native,'LUCIFER.exe'),['--supervise'],{cwd:root,windowsHide:true,detached:true,stdio:'ignore'});tray.unref();}
}
