import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {AIConfigService} from '../server/ai-config.js';
import {Store} from '../server/store.js';
import {createApp} from '../server/app.js';
import {setOwner} from '../server/auth.js';

test('AI setup stores only metadata in SQLite, encrypts runtime credentials, and verifies an actual Responses-shaped response',async()=>{
 const dir=mkdtempSync(path.resolve('.local/tests/ai-config-'));const store=new Store(dir);let calls=0;
 const transport:typeof fetch=async(_url,init)=>{calls++;assert.equal((init?.headers as Record<string,string>).Authorization,'Bearer sk-test-secret');const body=JSON.parse(String(init?.body));assert.equal(body.model,'test-responses-model');assert.equal(body.store,false);return new Response(JSON.stringify({output:[{type:'message',content:[{type:'output_text',text:'LUCIFER connection test passed.'}]}]}),{status:200,headers:{'Content-Type':'application/json'}});};
 const service=new AIConfigService(store,dir,transport);await service.save({provider:'openai',protocol:'responses',model:'test-responses-model',baseUrl:'https://provider.test/v1',apiKey:'sk-test-secret'});const raw=JSON.stringify(store.list('ai_config'));assert.equal(raw.includes('sk-test-secret'),false);assert.equal((await service.status()).status,'configured_unverified');const result=await service.test();assert.equal(result.verified,true);assert.equal(calls,1);assert.equal((await service.status()).status,'connected');const ciphertext=await readFile(path.join(dir,'ai-credentials.enc'),'utf8');assert.equal(ciphertext.includes('sk-test-secret'),false);await service.disconnect();assert.equal((await service.status()).status,'disconnected');store.close();rmSync(dir,{recursive:true,force:true});
});

test('AI protocol and provider boundaries reject Chat Completions and unsupported runtime providers',async()=>{
 const dir=mkdtempSync(path.resolve('.local/tests/ai-boundary-'));const store=new Store(dir);const service=new AIConfigService(store,dir);
 await assert.rejects(service.save({provider:'openai',protocol:'responses',model:'x',baseUrl:'http://remote.invalid/v1',apiKey:'test-key'}),/HTTPS/);
  await assert.rejects(service.save({provider:'openai',protocol:'chat_completions',model:'x',baseUrl:'https://provider.test/v1',apiKey:'test-key'}),/protocol|Invalid option/i);
 store.put('ai_config',{id:'model',provider:'flagshiprouter',protocol:'unknown',model:'x',baseUrl:'https://router.test',verified:false});assert.equal((await service.status()).status,'unsupported');assert.equal(await service.resolve(),undefined);store.close();rmSync(dir,{recursive:true,force:true});
 });

test('Ollama remains local and reports an unreachable server without downloading a model',async()=>{
 const dir=mkdtempSync(path.resolve('.local/tests/ai-ollama-'));const store=new Store(dir);const service=new AIConfigService(store,dir);await service.save({provider:'ollama',protocol:'ollama_chat',model:'gemma3:1b',baseUrl:'http://127.0.0.1:1',apiKey:''});assert.equal((await service.status()).status,'configured_unverified');await assert.rejects(service.test(),/Ollama|reachable|failed/i);assert.equal((await service.status()).status,'connection_failed');store.close();rmSync(dir,{recursive:true,force:true});
});

test('provider test cancellation aborts Ollama transport, rejects duplicate tests, and does not mark it connected',async()=>{
 const dir=mkdtempSync(path.resolve('.local/tests/ai-cancel-'));const store=new Store(dir);let calls=0;let aborts=0;
 const transport:typeof fetch=async(_url,init)=>new Promise((_resolve,reject)=>{calls++;const cancel=()=>{aborts++;reject(init?.signal?.reason);};if(init?.signal?.aborted)cancel();else init?.signal?.addEventListener('abort',cancel,{once:true});});
 const service=new AIConfigService(store,dir,transport);
 try {
   await service.save({provider:'ollama',protocol:'ollama_chat',model:'gemma3:1b',baseUrl:'http://127.0.0.1:11434',apiKey:''});
   const controller=new AbortController();const request=service.test(controller.signal);
   while(!calls)await new Promise(resolve=>setTimeout(resolve,5));
   await assert.rejects(service.test(),/already running/);
   controller.abort();await assert.rejects(request,/cancelled|aborted/i);
   assert.equal(calls,1);assert.equal(aborts,1);assert.equal((await service.status()).status,'configured_unverified');
 } finally {store.close();rmSync(dir,{recursive:true,force:true});}
});

test('configuration route does not test implicitly and test route returns the final status (mock provider result)',async()=>{
 const dir=mkdtempSync(path.resolve('.local/tests/ai-routes-'));const service=await createApp(dir);setOwner(service.store,'provider-test-password');let calls=0;
 try {
   const login=await service.app.inject({method:'POST',url:'/api/auth/login',headers:{'x-lucifer-request':'1'},payload:{password:'provider-test-password'}});
   const headers={cookie:String(login.headers['set-cookie']).split(';')[0],'x-lucifer-request':'1'};
    service.ai.test=async()=>{calls++;const record=service.store.get<any>('ai_config','model');service.store.put('ai_config',{...record,verified:true});return {verified:true,provider:'ollama',model:'gemma3:1b',testedAt:new Date().toISOString(),diagnostics:undefined};};
   const saved=await service.app.inject({method:'PUT',url:'/api/integrations/model/config',headers,payload:{provider:'ollama',protocol:'ollama_chat',model:'gemma3:1b',baseUrl:'http://127.0.0.1:11434',apiKey:''}});
   assert.equal(saved.statusCode,200);assert.equal(saved.json().status.status,'configured_unverified');assert.equal(calls,0);
   const tested=await service.app.inject({method:'POST',url:'/api/integrations/model/test',headers});
   assert.equal(tested.json().status.status,'connected');assert.equal(calls,1);
 } finally {await service.app.close();rmSync(dir,{recursive:true,force:true});}
});
