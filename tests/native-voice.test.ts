import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,rmSync,writeFileSync,symlinkSync} from 'node:fs';
import path from 'node:path';
import {createApp} from '../server/app.js';
import {setOwner,hash} from '../server/auth.js';
import {scopedPath,executeAction,type Policy} from '../companion/policy.js';
test('native voice requires granted device authorization; routine action waits for actual result; destructive action rejected',async()=>{
 mkdirSync('.local/tests',{recursive:true});const dir=mkdtempSync(path.resolve('.local/tests/native-voice-'));const a=await createApp(dir);setOwner(a.store,'native-voice-test-password');
 const deviceId='a73c61c6-8411-4365-a779-08739d54a289';const token='TEST-NATIVE-DEVICE-CREDENTIAL';
 const device={id:deviceId,name:'Native fixture',platform:'win32',revoked:false,lastSeen:new Date().toISOString(),capabilities:{apps:['notepad'],folders:['notes'],commands:[],actions:['open_app','write_document','read_file']}};
 a.store.put('device',device);a.store.put('credential',{id:deviceId,hash:hash(token)});const headers={authorization:'Bearer '+token};
 try{
  assert.equal((await a.app.inject({method:'POST',url:'/api/companion/voice/turn',headers,payload:{text:'open Notepad'}})).statusCode,403);
  a.store.put('device',{...device,voiceAuthorized:true});
  const turn=(await a.app.inject({method:'POST',url:'/api/companion/voice/turn',headers,payload:{text:'open Notepad'}})).json();
  const pending=(await a.app.inject({method:'POST',url:'/api/companion/voice/result',headers,payload:{taskId:turn.taskId}})).json();assert.equal(pending.state,'running');assert.equal(pending.reply,undefined);
  const poll=(await a.app.inject({method:'POST',url:'/api/companion/poll',headers,payload:{capabilities:device.capabilities}})).json();assert.equal(poll.command.action.app,'notepad');
  await a.app.inject({method:'POST',url:'/api/companion/result',headers,payload:{commandId:poll.command.id,ok:true,result:{accepted:true,detail:'Launch accepted by Windows'}}});
  while(a.tasks.controllers.has(turn.taskId))await new Promise(r=>setTimeout(r,20));
  const result=(await a.app.inject({method:'POST',url:'/api/companion/voice/result',headers,payload:{taskId:turn.taskId}})).json();assert.equal(result.state,'completed');assert.match(result.reply,/Windows confirmed/);
  assert.equal((await a.app.inject({method:'POST',url:'/api/companion/voice/action',headers,payload:{kind:'move_file',folder:'notes',path:'a.txt',destination:'b.txt'}})).statusCode,400);
  let checkedContext=false;
   a.assistant.provider={respond:async input=>{assert.ok(input.history.some(m=>m.text.includes('Spoken response preference: Tamil')));assert.ok(input.history.some(m=>m.text==='open Notepad'));assert.ok(input.tools.some((tool:any)=>tool.name==='windows_open_app'));assert.ok(!input.tools.some((tool:any)=>tool.name==='propose_device_action'));checkedContext=true;return {text:'தமிழில் பதில்.',calls:[],raw:[]};}};
  const tamil=(await a.app.inject({method:'POST',url:'/api/companion/voice/turn',headers,payload:{text:'Tell me about our previous turn',language:'ta'}})).json();
  while(a.tasks.controllers.has(tamil.taskId))await new Promise(r=>setTimeout(r,20));assert.ok(checkedContext);
  const stopping=(await a.app.inject({method:'POST',url:'/api/companion/voice/turn',headers,payload:{text:'open Notepad'}})).json();
  await a.app.inject({method:'POST',url:'/api/companion/voice/stop',headers,payload:{}});
  while(a.tasks.controllers.has(stopping.taskId))await new Promise(r=>setTimeout(r,20));
  assert.equal(a.store.get<any>('task',stopping.taskId).state,'cancelled');
  assert.equal((await a.app.inject({method:'POST',url:'/api/companion/poll',headers,payload:{capabilities:device.capabilities}})).json().command,null);
  a.devices.revoke(deviceId);assert.equal((await a.app.inject({method:'POST',url:'/api/companion/voice/turn',headers,payload:{text:'open Notepad'}})).statusCode,401);
 }finally{await a.app.close();rmSync(dir,{recursive:true,force:true});}
});
test('bounded device search skips private state and symlinks without blocking permitted files',async()=>{
 mkdirSync('.local/tests',{recursive:true});const root=mkdtempSync(path.resolve('.local/tests/native-search-'));
 try{
  mkdirSync(path.join(root,'.local'));mkdirSync(path.join(root,'.git'));mkdirSync(path.join(root,'node_modules'));mkdirSync(path.join(root,'docs'));
  writeFileSync(path.join(root,'.env'),'SYNTHETIC-PRIVATE');writeFileSync(path.join(root,'.local','note-private.txt'),'SYNTHETIC-PRIVATE');writeFileSync(path.join(root,'docs','note-public.txt'),'Public fixture');symlinkSync(path.join(root,'.local'),path.join(root,'linked'),'dir');
  const policy:Policy={server:'http://127.0.0.1:3001',name:'Search fixture',folders:{project:root},apps:{},commands:{},websites:[],actions:['find_files']};
  const result:any=await executeAction(policy,{kind:'find_files',folder:'project',query:'note'},new AbortController().signal,async()=>false);
  assert.deepEqual(result.matches,['docs/note-public.txt']);assert.equal(result.truncated,false);
 }finally{rmSync(root,{recursive:true,force:true});}
});
test('device file scopes never expose project credential vault or private application state',async()=>{
 await assert.rejects(scopedPath(process.cwd(),'.local/ai-credentials.key'),/Private application state/);
 await assert.rejects(scopedPath(process.cwd(),'.env'),/Private application state/);
});
