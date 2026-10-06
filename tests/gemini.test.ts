import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { BlockedReason, FinishReason, GenerateContentResponse } from '@google/genai';
import { GeminiProvider, geminiContents, testProvider } from '../server/provider.js';
import { GeminiError, GEMINI_PROBE_OUTPUT_TOKENS, geminiMetadata, readGeminiResponse, requestGemini } from '../server/gemini-response.js';
import { AIConfigService, type ResolvedAIConfig } from '../server/ai-config.js';
import { createApp } from '../server/app.js';
import { Store } from '../server/store.js';

const selected:ResolvedAIConfig={provider:'gemini',protocol:'gemini_generate_content',model:'gemini-flash-latest',baseUrl:'https://generativelanguage.googleapis.com',apiKey:'SYNTHETIC-TEST-CREDENTIAL',source:'runtime_vault'};
const response=(value:Partial<GenerateContentResponse>)=>Object.assign(new GenerateContentResponse(),value);
const stopped=(text:string)=>({modelVersion:'gemini-3.8-flash',candidates:[{content:{role:'model',parts:[{text}]},finishReason:'STOP'}],usageMetadata:{promptTokenCount:24,thoughtsTokenCount:64,candidatesTokenCount:8,totalTokenCount:96}});

test('Gemini connection probe budgets thinking plus text; original 30-token probe fails this regression (mock SDK transport)',async()=>{
 let calls=0;
 const transport:typeof fetch=async(_url,init)=>{
   calls++;const body=JSON.parse(String(init?.body));
   assert.equal(body.tools,undefined);assert.equal(body.generationConfig?.thinkingConfig,undefined,'Do not force model-specific thinking settings on a movable alias');
   assert.ok(body.generationConfig.maxOutputTokens<=4096,'Probe budget stays bounded');
   return Response.json(body.generationConfig.maxOutputTokens<1024?{modelVersion:'gemini-3.8-flash',candidates:[{content:{role:'model',parts:[]},finishReason:'MAX_TOKENS'}],usageMetadata:{thoughtsTokenCount:37,totalTokenCount:61}}:stopped('LUCIFER connection test passed.'));
 };
 const result=await testProvider(selected,transport);
 assert.equal(calls,1);assert.ok(GEMINI_PROBE_OUTPUT_TOKENS>=1024);assert.equal(result.text,'LUCIFER connection test passed.');
 assert.equal(result.diagnostics?.httpStatus,200);assert.equal(result.diagnostics?.modelVersion,'gemini-3.8-flash');
});

test('Gemini extraction excludes thought text and diagnostics include no content, headers, calls, or signatures',()=>{
 const value=response({modelVersion:'gemini-3.8-flash',candidates:[{finishReason:FinishReason.STOP,content:{parts:[{thought:true,text:'PRIVATE-THOUGHT-TEST'},{text:'  Visible '},{text:'answer.  ',thoughtSignature:'OPAQUE-SIGNATURE-TEST'}]}}],usageMetadata:{promptTokenCount:24,thoughtsTokenCount:64,totalTokenCount:96}});
 const result=readGeminiResponse(value,geminiMetadata(value,200),true);assert.equal(result.text,'Visible answer.');
 const encoded=JSON.stringify(result.diagnostics);for(const text of ['PRIVATE-THOUGHT-TEST','Visible','answer','OPAQUE-SIGNATURE-TEST','SYNTHETIC-TEST-CREDENTIAL'])assert.equal(encoded.includes(text),false);
 assert.deepEqual(result.diagnostics.candidates[0].partTypes,['thoughtText','text','text','thoughtSignature']);
});

test('Gemini distinguishes output exhaustion, safety, no candidates, genuine empty text, and unexpected probe tool calls',()=>{
 const cases:[Partial<GenerateContentResponse>,string][]=[
   [{candidates:[{finishReason:FinishReason.MAX_TOKENS,content:{parts:[]}}],usageMetadata:{thoughtsTokenCount:37}},'token_exhausted'],
   [{promptFeedback:{blockReason:BlockedReason.SAFETY}},'blocked'],
   [{candidates:[{finishReason:FinishReason.SAFETY,content:{parts:[{text:'Filtered partial text'}]}}]},'blocked'],
   [{candidates:[]},'no_candidates'],
   [{candidates:[{finishReason:FinishReason.STOP,content:{parts:[{text:'  '}]}}]},'empty_response'],
   [{candidates:[{finishReason:FinishReason.STOP,content:{parts:[{functionCall:{name:'current_time',args:{}}}]}}]},'unexpected_tool_response'],
 ];
 for(const [value,code] of cases)assert.throws(()=>readGeminiResponse(response(value),undefined,true),(error:unknown)=>error instanceof GeminiError&&error.code===code);
});

test('Gemini HTTP failures have separate actionable errors and quota is attempted only once (mock SDK transport)',async()=>{
 for(const [status,body,code] of [
   [400,{error:{code:400,status:'INVALID_ARGUMENT',message:'API key not valid. API_KEY_INVALID SYNTHETIC-TEST-CREDENTIAL'}},'invalid_credentials'],
   [403,{error:{code:403,status:'PERMISSION_DENIED',message:'Project permissions denied'}},'access_denied'],
   [404,{error:{code:404,status:'NOT_FOUND',message:'models/x not found'}},'model_unavailable'],
   [429,{error:{code:429,status:'RESOURCE_EXHAUSTED',message:'Quota limit reached'}},'quota'],
   [503,{error:{code:503,status:'UNAVAILABLE',message:'Model is temporarily unavailable'}},'unavailable'],
 ] as const){
   let calls=0;const transport:typeof fetch=async()=>{calls++;return Response.json(body,{status});};
   await assert.rejects(requestGemini(selected,{contents:'Probe'},{transport}),(error:unknown)=>error instanceof GeminiError&&error.code===code&&error.diagnostics?.httpStatus===status&&!JSON.stringify(error).includes('SYNTHETIC-TEST-CREDENTIAL'));
   assert.equal(calls,1,`${code} must not trigger retries or fallback`);
 }
 const transport:typeof fetch=async(_url,init)=>new Promise((_resolve,reject)=>{init?.signal?.addEventListener('abort',()=>reject(init.signal?.reason),{once:true});});
 await assert.rejects(requestGemini(selected,{contents:'Probe'},{transport,timeoutMs:20}),(error:unknown)=>error instanceof GeminiError&&error.code==='timeout');
});

test('normal Gemini function-call-only response preserves signature and reaches the authorized Assistant tool loop (mock SDK transport)',async()=>{
 mkdirSync('.local/tests',{recursive:true});const directory=mkdtempSync(path.resolve('.local/tests/gemini-tool-'));const app=await createApp(directory);
 let requests=0;
 const transport:typeof fetch=async(_url,init)=>{
   requests++;const body=JSON.parse(String(init?.body));
   if(requests===1)return Response.json({candidates:[{finishReason:'STOP',content:{role:'model',parts:[{functionCall:{id:'clock-call',name:'current_time',args:{}},thoughtSignature:'OPAQUE-CLOCK-SIGNATURE'}]}}]});
   const call=body.contents.find((content:any)=>content.parts?.some((part:any)=>part.functionCall));
   assert.equal(call.parts[0].thoughtSignature,'OPAQUE-CLOCK-SIGNATURE');
   const result=body.contents.find((content:any)=>content.parts?.some((part:any)=>part.functionResponse));
   assert.equal(result.parts[0].functionResponse.response.timezone,'Asia/Kolkata');
   return Response.json(stopped('The clock tool returned the actual time.'));
 };
 try {
   await app.ai.save({provider:selected.provider,protocol:selected.protocol,model:selected.model,baseUrl:selected.baseUrl,apiKey:selected.apiKey});
   app.assistant.provider=new GeminiProvider(()=>app.ai.resolve(),transport);
   const task=await app.assistant.chat('Please check my clock with the current_time tool.');
   while(app.tasks.controllers.has(task.id))await new Promise(resolve=>setTimeout(resolve,10));
   assert.equal(app.store.get<any>('task',task.id).state,'completed');assert.equal(requests,2);
   assert.equal(JSON.stringify(app.store.list('message')).includes('OPAQUE-CLOCK-SIGNATURE'),false);
   assert.equal(JSON.stringify(app.store.list('task')).includes('OPAQUE-CLOCK-SIGNATURE'),false);
   app.assistant.provider=new GeminiProvider(()=>app.ai.resolve(),async()=>Response.json({candidates:[{finishReason:'STOP',content:{parts:[{functionCall:{name:'run_shell',args:{command:'not authorized'}}}]}}]}));
   const forbidden=await app.assistant.chat('Review this document.');
   while(app.tasks.controllers.has(forbidden.id))await new Promise(resolve=>setTimeout(resolve,10));
   assert.equal(app.store.get<any>('task',forbidden.id).state,'failed');assert.match(app.store.get<any>('task',forbidden.id).error,/not permitted/);assert.equal(app.store.list('command').length,0);
   const calls=readGeminiResponse(response({candidates:[{finishReason:FinishReason.STOP,content:{parts:[{functionCall:{name:'current_time',args:{}},thoughtSignature:'signature'}]}}]})).calls;
   assert.equal(geminiContents([],[{calls,results:[{callId:calls[0].id,name:'current_time',output:{ok:true}}]}])[0].parts[0].thoughtSignature,'signature');
 } finally {await app.app.close();rmSync(directory,{recursive:true,force:true});}
});

test('Gemini probe with exhausted/empty response never marks the credential connected (mock SDK transport)',async()=>{
 const directory=mkdtempSync(path.resolve('.local/tests/gemini-probe-'));const store=new Store(directory);
 const transport:typeof fetch=async()=>Response.json({modelVersion:'gemini-3.8-flash',candidates:[{finishReason:'MAX_TOKENS',content:{parts:[]}}],usageMetadata:{thoughtsTokenCount:37}});
 const ai=new AIConfigService(store,directory,transport);
 try {
   await ai.save({provider:'gemini',protocol:'gemini_generate_content',model:selected.model,baseUrl:selected.baseUrl,apiKey:selected.apiKey});
   await assert.rejects(ai.test(),/MAX_TOKENS/);
   const status=await ai.status();assert.equal(status.status,'connection_failed');assert.equal(status.verified,false);assert.equal(status.lastErrorCode,'token_exhausted');assert.equal(status.lastDiagnostics?.httpStatus,200);
   assert.equal(JSON.stringify(store.list('ai_config')).includes(selected.apiKey!),false);
 } finally {store.close();rmSync(directory,{recursive:true,force:true});}
});
