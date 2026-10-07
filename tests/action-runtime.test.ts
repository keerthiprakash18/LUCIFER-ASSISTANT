import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,rmSync,writeFileSync,readFileSync} from 'node:fs';
import path from 'node:path';
import {z} from 'zod';
import {deviceActionSchema} from '../shared/contracts.js';
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
test('gateway retains NVIDIA/custom profile, credentials never enter metadata, and only explicitly free routes are accepted',async()=>{
 const dir=mkdtempSync(path.resolve('.local/tests/gateway-config-')),store=new Store(dir),service=new AIConfigService(store,dir);
 try{await service.save({provider:'custom',protocol:'chat_completions',customName:'NVIDIA Build',model:'nvidia/fixture',baseUrl:'https://integrate.api.nvidia.com/v1',apiKey:'fixture-nvidia-secret',ownerManagedRoute:true});
 await assert.rejects(service.save({provider:'freellmapi',protocol:'chat_completions',model:'free-fixture',baseUrl:'http://127.0.0.1:31415/v1',apiKey:'fixture-gateway-secret'}),/free model route/);
 await service.save({provider:'freellmapi',protocol:'chat_completions',model:'free-fixture',baseUrl:'http://127.0.0.1:31415/v1',apiKey:'fixture-gateway-secret',freeRouteAllowed:true,windowsBridge:true});
 const savedCustom=await service.resolve('custom');assert.equal(savedCustom?.model,'nvidia/fixture');assert.equal(savedCustom?.apiKey,'fixture-nvidia-secret');assert.ok(!JSON.stringify(store.list('ai_profile')).includes('secret'));assert.equal(service.routing().fallbackEnabled,false);assert.equal(service.saveRouting({fallbackEnabled:true,fallback:'custom'}).paidRoutes,false);
 }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});

test('ordinary conversation uses the fast path without sending the full tool catalog',async()=>{
 const dir=mkdtempSync(path.resolve('.local/tests/fast-chat-')),a=await createApp(dir);let seenTools=-1,seenHistory=-1;
 try{
  a.assistant.provider={respond:async input=>{seenTools=input.tools.length;seenHistory=input.history.length;return {text:'Hello.',calls:[],raw:[]};}};
  const task=await a.assistant.chat('hello lucifer');
  while(a.tasks.controllers.has(task.id))await new Promise(r=>setTimeout(r,5));
  const stored=a.store.get<any>('task',task.id);assert.equal(stored.state,'completed',stored.error);
  assert.equal(seenTools,0);assert.ok(seenHistory>=1);
 }finally{await a.app.close();rmSync(dir,{recursive:true,force:true});}
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
test('Jarvis-inspired fast voice commands stay local and use bounded Windows tools without model calls',async()=>{
 const dir=mkdtempSync(path.resolve('.local/tests/jarvis-local-')),a=await createApp(dir);const deviceId='6f8d52d9-93c5-4d17-8d5b-4abfa8261fc2';let modelCalls=0;const calls:any[]=[];
 try{
  a.assistant.provider={respond:async()=>{modelCalls++;return {text:'MODEL SHOULD NOT RUN',calls:[],raw:[]};}};
  const replace=(name:string,run:(input:any)=>Promise<any>)=>{const tool=a.assistant.tools.find(tool=>tool.name===name);assert.ok(tool,'missing '+name);tool!.run=async(input)=>run(input);};
  replace('windows_open_app',async input=>{calls.push(['open_app',input]);return {processId:123,accepted:true};});
  replace('windows_open_website',async input=>{calls.push(['open_website',input]);return {accepted:true};});
  replace('windows_system_control',async input=>{calls.push(['system_control',input]);return {accepted:true,operation:input.operation};});
  replace('windows_system_info',async input=>{calls.push(['system_info',input]);return {release:'11',logicalCores:16,memoryUsedPercent:42.5,memoryTotalBytes:16*1073741824,uptimeSeconds:7200};});
  const run=async(text:string)=>{const task=await a.assistant.chat(text,[],deviceId,'en');while(a.tasks.controllers.has(task.id))await new Promise(r=>setTimeout(r,5));const stored=a.store.get<any>('task',task.id);assert.equal(stored.state,'completed',stored.error);return stored.result.reply;};
  assert.match(await run('open calculator'),/calculator launch/i);
  assert.match(await run('open camera'),/camera launch/i);
  assert.match(await run('open github'),/Opened github/i);
  assert.match(await run('google search NVIDIA Build models'),/Opened Google search/i);
  assert.match(await run('volume up'),/Volume increased/i);
  assert.match(await run('system info'),/16 logical CPU cores/i);
  assert.match(await run('tell me a joke'),/(programmers|computer|data analyst)/i);
  assert.equal(modelCalls,0);
  assert.deepEqual(calls.map(entry=>entry[0]),['open_app','open_app','open_website','open_website','system_control','system_info']);
 }finally{await a.app.close();rmSync(dir,{recursive:true,force:true});}
});

test('native policy exposes only bounded Jarvis-inspired system operations',async()=>{
 const dir=mkdtempSync(path.resolve('.local/tests/jarvis-policy-'));
 try{
  const policy:Policy={server:'http://127.0.0.1:3001',name:'Fixture',apps:{},folders:{},commands:{},websites:[],actions:['system_info']};
  const info:any=await executeAction(policy,{kind:'system_info'},new AbortController().signal,async()=>false);
  assert.ok(info.logicalCores>=1);assert.ok(info.memoryTotalBytes>0);assert.equal(typeof info.hostname,'string');
  assert.throws(()=>deviceActionSchema.parse({kind:'system_control',operation:'run_powershell'}));
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('general CSV statistics distinguish missing data and nonnumeric columns without inventing measurements',()=>{const a=analyzeTable('item,quantity,price\napples,2,10\npears,3,\n');assert.equal(a.rows,2);const quantity=a.columns.find(column=>column.name==='quantity')!;assert.ok('sum' in quantity);assert.equal(quantity.sum,5);assert.equal(a.columns.find(column=>column.name==='price')?.missing,1);assert.equal(a.columns.find(column=>column.name==='item')?.numeric,false);assert.throws(()=>analyzeTable('a,b\n1,2,3'),/Invalid Record Length/);});
test('general CSV PDF verifies actual saved bytes and supplied statistics after PDF glyph spacing',async()=>{
 const dir=mkdtempSync(path.resolve('.local/tests/csv-pdf-')),a=await createApp(dir);
 try{const text='item,quantity,price\napples,2,10\npears,3,20\n',file=await a.files.save('sample.csv','text/csv',Buffer.from(text),text);const task=await a.assistant.chat('Analyze attached CSV and create a PDF report.',[file.id]);while(a.tasks.controllers.has(task.id))await new Promise(r=>setTimeout(r,20));const value=a.store.get<any>('task',task.id);assert.equal(value.state,'completed',value.error);const result=value.result.steps[0].output;assert.equal(result.analysis.rows,2);assert.equal(result.analysis.columns.find((column:any)=>column.name==='quantity').sum,5);assert.equal((await a.files.read(result.fileId)).subarray(0,5).toString(),'%PDF-');assert.ok(a.store.get<any>('file',result.fileId).text.replace(/\s/g,'').includes('quantity'));}finally{await a.app.close();rmSync(dir,{recursive:true,force:true});}
});
test('explicit fallback switches once to NVIDIA/custom, carries observed receipts, and never repeats a completed side effect',async()=>{
 const dir=mkdtempSync(path.resolve('.local/tests/action-fallback-')),a=await createApp(dir),original=globalThis.fetch;let gatewayCalls=0,customCalls=0,executions=0;
 const gateway={provider:'freellmapi' as const,protocol:'chat_completions' as const,model:'free-fixture',baseUrl:'https://gateway.test/v1',apiKey:'gateway-fixture-key',source:'runtime_vault' as const,freeRouteAllowed:true};
 const custom={provider:'custom' as const,protocol:'chat_completions' as const,customName:'NVIDIA Build',model:'nvidia/fixture',baseUrl:'https://custom.test/v1',apiKey:'nvidia-fixture-key',source:'runtime_vault' as const,ownerManagedRoute:true};
 try{
  a.ai.resolve=async target=>target==='custom'?custom:gateway;a.ai.saveRouting({fallbackEnabled:true,fallback:'custom'});
  a.assistant.tools=a.assistant.tools.filter(tool=>tool.name!=='create_document');a.assistant.tools.push({name:'create_document',description:'Fixture',schema:z.object({name:z.string()}).strict(),permission:'files',run:async()=>{executions++;return {verified:true,fileId:'verified-fixture-document'};}});
  globalThis.fetch=async(url,init)=>{const body=JSON.parse(String(init?.body));if(String(url).includes('gateway.test')){gatewayCalls++;if(gatewayCalls===2)return new Response('{}',{status:429});return Response.json({model:'actual-free-fixture',choices:[{message:{tool_calls:[{id:'gateway-call',function:{name:'create_document',arguments:'{"name":"once"}'}}]}}]});}
   customCalls++;if(customCalls===1){assert.ok(JSON.stringify(body.messages).includes('verified-fixture-document'));assert.ok(!JSON.stringify(body.messages).includes('gateway-call'));return Response.json({model:'nvidia/fixture',choices:[{message:{tool_calls:[{id:'nvidia-call',type:'function',function:{name:'create_document',arguments:'{"name":"once"}'}}]}}]});}
   assert.ok(JSON.stringify(body.messages).includes('verified-fixture-document'));return Response.json({model:'nvidia/fixture',choices:[{message:{content:'Verified prior document receipt; no duplicate action.'}}]});};
  const task=await a.assistant.chat('Create one harmless document and verify it.');while(a.tasks.controllers.has(task.id))await new Promise(r=>setTimeout(r,5));const result=a.store.get<any>('task',task.id);assert.equal(result.state,'completed',result.error);assert.equal(result.result.fallbackUsed,true);assert.equal(executions,1);assert.equal(gatewayCalls,2);assert.equal(customCalls,2);assert.deepEqual([...new Set(result.result.served.map((entry:any)=>entry.provider))],['FreeLLMAPI gateway','NVIDIA Build']);
 }finally{globalThis.fetch=original;await a.app.close();rmSync(dir,{recursive:true,force:true});}
});
