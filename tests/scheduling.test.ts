import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,rmSync} from 'node:fs';
import path from 'node:path';
import {createApp} from '../server/app.js';
import {TelegramClient} from '../server/telegram.js';
import {localToISO} from '../server/scheduler.js';
test('persistent reminder survives restart and in-app delivery is not duplicated',async()=>{
 mkdirSync('.local/tests',{recursive:true});const dir=mkdtempSync(path.resolve('.local/tests/reminder-'));let app=await createApp(dir);app.scheduler.stop();const at=new Date(Date.now()+5000).toISOString();app.store.put('reminder',{id:'persist-test',title:'Persistent test reminder',at,timezone:'Asia/Kolkata',recurrence:'none',channel:'in_app',status:'scheduled'});await app.app.close();app=await createApp(dir);app.scheduler.stop();await app.scheduler.tick(Date.parse(at)+1000);await app.scheduler.tick(Date.parse(at)+2000);assert.equal(app.store.list('notification').length,1);assert.equal(app.store.get<any>('reminder','persist-test').status,'delivered');await app.app.close();app=await createApp(dir);app.scheduler.stop();await app.scheduler.tick(Date.parse(at)+3000);assert.equal(app.store.list('notification').length,1);await app.app.close();rmSync(dir,{recursive:true,force:true});
 assert.equal(localToISO('2026-10-06T07:00','Asia/Kolkata'),'2026-10-06T01:30:00.000Z');assert.throws(()=>localToISO('2026-03-08T02:30','America/New_York'));assert.throws(()=>localToISO('2026-11-01T01:30','America/New_York'));
});
test('Telegram adapter contract: receipt deduplication, expired credentials, uncertain delivery and disconnection (mock transport)',async()=>{
 const dir=mkdtempSync(path.resolve('.local/tests/delivery-'));let calls=0;let behavior='success';const transport:typeof fetch=async()=>{calls++;if(behavior==='network')throw new Error('network');return new Response(JSON.stringify(behavior==='expired'?{ok:false,error_code:401}:{ok:true,result:{message_id:123,chat:{id:999}}}),{status:behavior==='expired'?401:200,headers:{'Content-Type':'application/json'}});};const app=await createApp(dir,new TelegramClient('TEST-ONLY-NOT-A-REAL-TOKEN',transport));app.store.put('integration',{id:'telegram',connected:true,chatId:'999',name:'Mock destination'});
 assert.equal((await app.telegram.send('file:test','sendMessage',{text:'test'})).messageId,123);await app.telegram.send('file:test','sendMessage',{text:'test'});assert.equal(calls,1);
 behavior='expired';await assert.rejects(app.telegram.send('file:expired','sendMessage',{text:'test'}),/expired/);behavior='network';await assert.rejects(app.telegram.send('file:uncertain','sendMessage',{text:'test'}),/uncertain/);const before=calls;await assert.rejects(app.telegram.send('file:uncertain','sendMessage',{text:'test'}),/uncertain/);assert.equal(calls,before);
 const s=app.assistant.settings();app.store.put('settings',{id:'owner',...s,permissions:{...s.permissions,telegram:false}});await assert.rejects(app.telegram.send('file:blocked','sendMessage',{text:'test'}),/disconnected/);assert.equal(calls,before);await app.app.close();rmSync(dir,{recursive:true,force:true});
});
