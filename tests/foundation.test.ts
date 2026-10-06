import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync,mkdirSync } from 'node:fs';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { setOwner } from '../server/auth.js';
mkdirSync('.local/tests',{recursive:true});
test('owner authentication, actual time tool, persisted conversation, denied cross-origin action',async()=>{
 const dir=mkdtempSync(path.resolve('.local/tests/foundation-'));const {app,store}=await createApp(dir);setOwner(store,'test-password-long');
 assert.equal((await app.inject('/api/state')).statusCode,401);
 const login=await app.inject({method:'POST',url:'/api/auth/login',headers:{'x-lucifer-request':'1'},payload:{password:'test-password-long'}});assert.equal(login.statusCode,200);
 const cookie=login.headers['set-cookie']!.toString().split(';')[0];const headers={cookie,'x-lucifer-request':'1'};
 assert.equal((await app.inject({method:'POST',url:'/api/chat',headers:{...headers,origin:'https://evil.example'},payload:{text:'What is the time?'}})).statusCode,403);
 const chat=await app.inject({method:'POST',url:'/api/chat',headers,payload:{text:'What is the time?'}});assert.equal(chat.statusCode,200);
 await new Promise(r=>setTimeout(r,50));const state=(await app.inject({url:'/api/state',headers})).json();assert.match(state.messages[1].text,/Asia\/Kolkata/);assert.equal(state.tasks[0].state,'completed');assert.equal(state.tasks[0].events[0].text,'Reading the system clock.');
 await app.close();const restarted=await createApp(dir);assert.equal(restarted.store.list('message').length,2);await restarted.app.close();rmSync(dir,{recursive:true,force:true});
});
