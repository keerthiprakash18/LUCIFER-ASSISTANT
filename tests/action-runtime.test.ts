import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,rmSync,writeFileSync,readFileSync} from 'node:fs';
import path from 'node:path';
import {z} from 'zod';
import {createApp} from '../server/app.js';
import {setOwner} from '../server/auth.js';
import {executeAction,type Policy} from '../companion/policy.js';
import {AIConfigService} from '../server/ai-config.js';
import {Store} from '../server/store.js';
import {GatewayProvider,testGateway} from '../server/gateway.js';
import {analyzeTable} from '../server/documents.js';
test('overwrites require exact confirmation and an unchanged preview; exclusive creation never replaces existing data',async()=>{
 mkdirSync('.local/tests',{recursive:true});const dir=mkdtempSync(path.resolve('.local/tests/action-policy-'));
 try{const policy:Policy={server:'http://127.0.0.1:3001',name:'Fixture',apps:{},folders:{notes:dir},commands:{},websites:[],actions:['read_file','edit_file','write_document','move_file']};writeFileSync(path.join(dir,'note.txt'),'Original');const signal=new AbortController().signal;
 const read:any=await executeAction(policy,{kind:'read_file',folder:'notes',path:'note.txt'},signal,async()=>false);
 await assert.rejects(executeAction(policy,{kind:'edit_file',folder:'notes',path:'note.txt',text:'New',expectedHash:read.hash},signal,async()=>false),/denied/);
 await assert.rejects(executeAction(policy,{kind:'write_document',folder:'notes',path:'note.txt',text:'New'},signal,async()=>true),/already exists/);
 writeFileSync(path.join(dir,'note.txt'),'Changed by owner');await assert.rejects(executeAction(policy,{kind:'edit_file',folder:'notes',path:'note.txt',text:'New',expectedHash:read.hash},signal,async()=>true),/changed since preview/);assert.equal(readFileSync(path.join(dir,'note.txt'),'utf8'),'Changed by owner');
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('gateway retains Gemini profile, credentials never enter metadata, and only explicitly free routes are accepted',async()=>{
 const dir=mkdtempSync(path.resolve('.local/tests/gateway-config-')),store=new Store(dir),service=new AIConfigService(store,dir);
 try{await service.save({provider:'gemini',protocol:'gemini_generate_content',model:'gemini-fixture',baseUrl:'https://generativelanguage.googleapis.com',apiKey:'fixture-gemini-secret'});
 await assert.rejects(service.save({provider:'freellmapi',protocol:'chat_completions',model:'free-fixture',baseUrl:'http://127.0.0.1:31415/v1',apiKey:'fixture-gateway-secret'}),/free model route/);
 await service.save({provider:'freellmapi',protocol:'chat_completions',model:'free-fixture',baseUrl:'http://127.0.0.1:31415/v1',apiKey:'fixture-gateway-secret',freeRouteAllowed:true,windowsBridge:true});assert.equal((await service.resolve('gemini'))?.model,'gemini-fixture');assert.equal((await service.resolve('gemini'))?.apiKey,'fixture-gemini-secret');assert.ok(!JSON.stringify(store.list('ai_profile')).includes('secret'));assert.equal(service.routing().fallbackEnabled,false);assert.equal(service.saveRouting({fallbackEnabled:true,fallback:'gemini'}).paidRoutes,false);
 }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});
test('gateway tool parsing excludes private reasoning and rejects text-only models for action readiness',async()=>{
 const selected={provider:'freellmapi' as const,protocol:'chat_completions' as const,model:'free-fixture',baseUrl:'https://gateway.test/v1',apiKey:'fixture-secret',source:'runtime_vault' as const,freeRouteAllowed:true};
 const transport:typeof fetch=async(_url,init)=>{assert.equal((init?.headers as any).Authorization,'Bearer fixture-secret');return new Response(JSON.stringify({model:'actual-free-model',choices:[{message:{content:'',reasoning_content:'PRIVATE REASONING',tool_calls:[{id:'call-1',function:{name:'current_time',arguments:'{}'}}]}}]}));};
 const answer=await new GatewayProvider(async()=>selected,transport).respond({history:[],context:[],tools:[],signal:new AbortController().signal});assert.equal(answer.calls[0].name,'current_time');assert.equal(answer.served.model,'actual-free-model');assert.ok(!JSON.stringify(answer).includes('PRIVATE REASONING'));
 await assert.rejects(testGateway(selected,async()=>new Response(JSON.stringify({choices:[{message:{content:'Looks connected'}}]})),new AbortController().signal),/structured tool call/);
});
test('action loop reuses duplicate side-effect receipts and preserves actual results across turns',async()=>{
 const dir=mkdtempSync(path.resolve('.local/tests/action-loop-')),a=await createApp(dir);let executions=0,turn=0;
 try{a.assistant.tools.push({name:'create_document',description:'Fixture',schema:z.object({name:z.string()}).strict(),permission:'files',run:async()=>{executions++;return {verified:true,fileId:'fixture-file'};}});a.assistant.tools=a.assistant.tools.filter(tool=>tool.name!=='create_document'||tool.description==='Fixture');a.assistant.provider={respond:async input=>{turn++;if(turn===3){assert.equal(input.turns?.length,2);return {text:'Verified saved file.',calls:[],raw:[]};}return {text:'',calls:[{id:'call-'+turn,name:'create_document',arguments:'{"name":"test"}'}],raw:[]};}};
 const task=await a.assistant.chat('Create one harmless document.');while(a.tasks.controllers.has(task.id))await new Promise(r=>setTimeout(r,5));assert.equal(executions,1);const result=a.store.get<any>('task',task.id);assert.equal(result.state,'completed');assert.equal(result.result.steps.length,2);assert.ok(result.events.some((event:any)=>event.text.includes('no duplicate execution')));
 }finally{await a.app.close();rmSync(dir,{recursive:true,force:true});}
});
test('owner dashboard chat executes only an authorized online laptop; cancellation prevents queued replay',async()=>{
 const dir=mkdtempSync(path.resolve('.local/tests/action-chat-')),a=await createApp(dir);setOwner(a.store,'fixture-owner-password');const deviceId='9e78a4e0-a23a-469f-8dfb-84bc66e98951';
 try{a.store.put('device',{id:deviceId,name:'Fixture laptop',platform:'win32',voiceAuthorized:true,lastSeen:new Date().toISOString(),revoked:false,capabilities:{apps:['notepad'],folders:[],commands:[],actions:['open_app']}});const login=await a.app.inject({method:'POST',url:'/api/auth/login',headers:{'x-lucifer-request':'1'},payload:{password:'fixture-owner-password'}}),headers={cookie:String(login.headers['set-cookie']).split(';')[0],'x-lucifer-request':'1'};
 const response=await a.app.inject({method:'POST',url:'/api/chat',headers,payload:{text:'Open Notepad'}});assert.equal(response.statusCode,200);const task=response.json();const command=a.store.list<any>('command').find(command=>command.parentTaskId===task.id);assert.ok(command);assert.equal(command.ownerApproved,false);await a.app.inject({method:'POST',url:'/api/tasks/'+task.id+'/cancel',headers});while(a.tasks.controllers.has(task.id))await new Promise(r=>setTimeout(r,5));assert.equal(a.store.get<any>('command',command.id).status,'cancelled');assert.equal(a.store.get<any>('task',task.id).state,'cancelled');
 }finally{await a.app.close();rmSync(dir,{recursive:true,force:true});}
});
test('general CSV statistics distinguish missing data and nonnumeric columns without inventing measurements',()=>{const a=analyzeTable('item,quantity,price\napples,2,10\npears,3,\n');assert.equal(a.rows,2);const quantity=a.columns.find(column=>column.name==='quantity')!;assert.ok('sum' in quantity);assert.equal(quantity.sum,5);assert.equal(a.columns.find(column=>column.name==='price')?.missing,1);assert.equal(a.columns.find(column=>column.name==='item')?.numeric,false);assert.throws(()=>analyzeTable('a,b\n1,2,3'),/Invalid Record Length/);});
test('general CSV PDF verifies actual saved bytes and supplied statistics after PDF glyph spacing',async()=>{
 const dir=mkdtempSync(path.resolve('.local/tests/csv-pdf-')),a=await createApp(dir);
 try{const text='item,quantity,price\napples,2,10\npears,3,20\n',file=await a.files.save('sample.csv','text/csv',Buffer.from(text),text);const task=await a.assistant.chat('Analyze attached CSV and create a PDF report.',[file.id]);while(a.tasks.controllers.has(task.id))await new Promise(r=>setTimeout(r,20));const value=a.store.get<any>('task',task.id);assert.equal(value.state,'completed',value.error);const result=value.result.steps[0].output;assert.equal(result.analysis.rows,2);assert.equal(result.analysis.columns.find((column:any)=>column.name==='quantity').sum,5);assert.equal((await a.files.read(result.fileId)).subarray(0,5).toString(),'%PDF-');assert.ok(a.store.get<any>('file',result.fileId).text.replace(/\s/g,'').includes('quantity'));}finally{await a.app.close();rmSync(dir,{recursive:true,force:true});}
});
test('explicit fallback switches once, carries observed receipts without foreign signatures, and never repeats a completed side effect',async()=>{
 const dir=mkdtempSync(path.resolve('.local/tests/action-fallback-')),a=await createApp(dir),original=globalThis.fetch;let gatewayCalls=0,geminiCalls=0,executions=0;
 const gateway={provider:'freellmapi' as const,protocol:'chat_completions' as const,model:'free-fixture',baseUrl:'https://gateway.test/v1',apiKey:'gateway-fixture-key',source:'runtime_vault' as const,freeRouteAllowed:true};
 const gemini={provider:'gemini' as const,protocol:'gemini_generate_content' as const,model:'gemini-fixture',baseUrl:'https://gemini.test',apiKey:'gemini-fixture-key',source:'runtime_vault' as const};
 try{
  a.ai.resolve=async target=>target==='gemini'?gemini:gateway;a.ai.saveRouting({fallbackEnabled:true,fallback:'gemini'});
  a.assistant.tools=a.assistant.tools.filter(tool=>tool.name!=='create_document');a.assistant.tools.push({name:'create_document',description:'Fixture',schema:z.object({name:z.string()}).strict(),permission:'files',run:async()=>{executions++;return {verified:true,fileId:'verified-fixture-document'};}});
  globalThis.fetch=async(url,init)=>{const body=JSON.parse(String(init?.body));if(String(url).includes('gateway.test')){gatewayCalls++;if(gatewayCalls===2)return new Response('{}',{status:429});return Response.json({model:'actual-free-fixture',choices:[{message:{tool_calls:[{id:'gateway-call',function:{name:'create_document',arguments:'{"name":"once"}'}}]}}]});}
   geminiCalls++;if(geminiCalls===1){assert.ok(JSON.stringify(body.contents).includes('verified-fixture-document'));assert.ok(!JSON.stringify(body.contents).includes('gateway-call'));return Response.json({modelVersion:'gemini-fixture',candidates:[{finishReason:'STOP',content:{parts:[{functionCall:{name:'create_document',args:{name:'once'}},thoughtSignature:'opaque-fixture-signature'}]}}]});}
   assert.ok(JSON.stringify(body.contents).includes('opaque-fixture-signature'));return Response.json({modelVersion:'gemini-fixture',candidates:[{finishReason:'STOP',content:{parts:[{text:'Verified prior document receipt; no duplicate action.'}]}}]});};
  const task=await a.assistant.chat('Create one harmless document and verify it.');while(a.tasks.controllers.has(task.id))await new Promise(r=>setTimeout(r,5));const result=a.store.get<any>('task',task.id);assert.equal(result.state,'completed',result.error);assert.equal(result.result.fallbackUsed,true);assert.equal(executions,1);assert.equal(gatewayCalls,2);assert.equal(geminiCalls,2);assert.deepEqual([...new Set(result.result.served.map((entry:any)=>entry.provider))],['FreeLLMAPI gateway','Gemini']);assert.ok(!JSON.stringify(result).includes('opaque-fixture-signature'));
 }finally{globalThis.fetch=original;await a.app.close();rmSync(dir,{recursive:true,force:true});}
});
