import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,symlinkSync,rmSync} from 'node:fs';
import path from 'node:path';
import {createApp} from '../server/app.js';
import {setOwner} from '../server/auth.js';
import {scopedPath,executeAction,validateServer,type Policy} from '../companion/policy.js';
test('paired device transport, actual scoped file action, unauthorized/revoked devices and stale command rejection',async()=>{
 mkdirSync('.local/tests',{recursive:true});const dir=mkdtempSync(path.resolve('.local/tests/device-'));mkdirSync(path.join(dir,'approved'));writeFileSync(path.join(dir,'approved','hello.txt'),'Real device result');
 const {app,store,devices}=await createApp(dir);setOwner(store,'test-password-long');const login=await app.inject({method:'POST',url:'/api/auth/login',headers:{'x-lucifer-request':'1'},payload:{password:'test-password-long'}});const owner={cookie:String(login.headers['set-cookie']).split(';')[0],'x-lucifer-request':'1'};
 const challenge=(await app.inject({method:'POST',url:'/api/devices/pairing',headers:owner})).json();const capabilities={apps:[],folders:['project'],commands:[],actions:['read_file']};const reg=(await app.inject({method:'POST',url:'/api/companion/register',payload:{code:challenge.code,name:'Test laptop transport',platform:'linux',capabilities}})).json();assert.ok(reg.token);
 assert.equal((await app.inject({method:'POST',url:'/api/companion/register',payload:{code:challenge.code,name:'Intruder',platform:'linux',capabilities}})).statusCode,401);
 assert.equal((await app.inject({method:'POST',url:'/api/companion/poll',payload:{capabilities}})).statusCode,401);
 const command=(await app.inject({method:'POST',url:`/api/devices/${reg.deviceId}/action`,headers:owner,payload:{kind:'read_file',folder:'project',path:'hello.txt'}})).json();const bearer={authorization:'Bearer '+reg.token};const poll=(await app.inject({method:'POST',url:'/api/companion/poll',headers:bearer,payload:{capabilities}})).json();assert.equal(poll.command.id,command.id);
 const policy:Policy={server:'https://example.com',name:'Test',folders:{project:path.join(dir,'approved')},apps:{},websites:[],commands:{},actions:['read_file']};const result=await executeAction(policy,poll.command.action,new AbortController().signal,async()=>false);assert.equal((result as any).text,'Real device result');
 await app.inject({method:'POST',url:'/api/companion/result',headers:bearer,payload:{commandId:command.id,ok:true,result}});assert.equal((await app.inject({url:'/api/state',headers:owner})).json().tasks[0].state,'completed');
 const stale=(await app.inject({method:'POST',url:`/api/devices/${reg.deviceId}/action`,headers:owner,payload:{kind:'read_file',folder:'project',path:'hello.txt'}})).json();devices.expirePending(Date.parse(stale.expiresAt)+1);assert.equal(store.get<any>('command',stale.id).status,'failed');assert.equal(store.get<any>('task',stale.taskId).state,'failed');const afterExpiry=(await app.inject({method:'POST',url:'/api/companion/poll',headers:bearer,payload:{capabilities}})).json();assert.equal(afterExpiry.command,null);
 store.put('device',{...store.get<any>('device',reg.deviceId),lastSeen:new Date(0).toISOString()});assert.match((await app.inject({method:'POST',url:`/api/devices/${reg.deviceId}/action`,headers:owner,payload:{kind:'read_file',folder:'project',path:'hello.txt'}})).json().error,/offline/);
 await app.inject({method:'DELETE',url:'/api/devices/'+reg.deviceId,headers:owner});assert.equal((await app.inject({method:'POST',url:'/api/companion/poll',headers:bearer,payload:{capabilities}})).statusCode,401);await app.close();rmSync(dir,{recursive:true,force:true});
});
test('folder traversal, symlink escape, unsafe shell inputs and plaintext remote URLs rejected',async()=>{
 const dir=mkdtempSync(path.resolve('.local/tests/scope-'));mkdirSync(path.join(dir,'approved'));mkdirSync(path.join(dir,'outside'));writeFileSync(path.join(dir,'outside','secret.txt'),'secret');symlinkSync(path.join(dir,'outside'),path.join(dir,'approved','escape'),'dir');
 await assert.rejects(scopedPath(path.join(dir,'approved'),'../outside/secret.txt'));await assert.rejects(scopedPath(path.join(dir,'approved'),'escape/secret.txt'));await assert.rejects(scopedPath(path.join(dir,'approved'),'C:\\secret'));assert.throws(()=>validateServer('http://192.168.1.2:3001'));
 const policy:Policy={server:'https://example.com',name:'Test',folders:{project:path.join(dir,'approved')},apps:{},websites:[],commands:{},actions:['run_command']};await assert.rejects(executeAction(policy,{kind:'run_command',folder:'project',command:'node; whoami'},new AbortController().signal,async()=>true));rmSync(dir,{recursive:true,force:true});
});
