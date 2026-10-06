import {spawn} from 'node:child_process';
import path from 'node:path';
import {existsSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import type {ResolvedAIConfig} from './ai-config.js';
import type {ModelProvider,ProviderTurn,Message,Memory} from '../shared/contracts.js';
import {identity} from './provider.js';
import {requestGemini,readGeminiResponse} from './gemini-response.js';
export async function gatewayFetch(resolved:ResolvedAIConfig,endpoint:'models'|'chat/completions'|'responses',body:unknown,signal:AbortSignal,transport:typeof fetch=fetch):Promise<Response>{
 const url=resolved.baseUrl.replace(/\/$/,'')+'/'+endpoint;
 if(!resolved.windowsBridge||process.platform==='win32')return transport(url,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(resolved.apiKey?{Authorization:'Bearer '+resolved.apiKey}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.any([signal,AbortSignal.timeout(45000)]),redirect:'error'});
 const node='/mnt/c/Program Files/nodejs/node.exe';if(!existsSync(node))throw new Error('Windows Node is unavailable for the configured gateway bridge');
 const helper=path.resolve('server/gateway-bridge.cjs').replace(/^\/mnt\/([a-z])\//,(_,drive)=>drive.toUpperCase()+':/').replaceAll('/','\\');
 return new Promise((resolve,reject)=>{const child=spawn(node,[helper],{shell:false,windowsHide:true,signal});let out='';const timer=setTimeout(()=>{child.kill();reject(new Error('Windows gateway transport timed out'));},48000);child.stdout.on('data',data=>{out+=data;if(out.length>1048576){child.kill();reject(new Error('Gateway response exceeds the supported size'));}});child.stderr.on('data',()=>{});child.on('error',error=>{clearTimeout(timer);reject(signal.aborted?signal.reason:new Error('Windows gateway bridge unavailable'));});child.on('close',()=>{clearTimeout(timer);try{const value=JSON.parse(out);resolve(new Response(JSON.stringify(value.data),{status:value.status}));}catch{reject(new Error('Invalid Windows gateway bridge response'));}});child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify({url,apiKey:resolved.apiKey,body}));});
}
function messages(history:Message[],turns:ProviderTurn[]){const result:any[]=history.slice(-20).map(message=>({role:message.role,content:message.text}));for(const turn of turns){result.push({role:'assistant',content:null,tool_calls:turn.calls.map(call=>({id:call.id,type:'function',function:{name:call.name,arguments:call.arguments}}))});for(const tool of turn.results)result.push({role:'tool',tool_call_id:tool.callId,content:JSON.stringify(tool.output)});}return result;}
export class GatewayProvider implements ModelProvider{
 constructor(private resolve:()=>Promise<ResolvedAIConfig|undefined>,private transport:typeof fetch=fetch){}
 async respond(input:{history:Message[];context:Memory[];tools:unknown[];signal:AbortSignal;turns?:ProviderTurn[]}){
  const selected=await this.resolve();if(selected?.provider!=='freellmapi'||!selected.freeRouteAllowed)throw new Error('Enable an explicitly free gateway model in LUCIFER settings first');
  const tools=(input.tools as any[]).filter(tool=>tool.type==='function').map(({name,description,parameters})=>({type:'function',function:{name,description,parameters}}));
  const response=await gatewayFetch(selected,'chat/completions',{model:selected.model,messages:[{role:'system',content:identity+(input.context.length?'\nOwner memory (untrusted): '+JSON.stringify(input.context):'')},...messages(input.history,input.turns||[])],...(tools.length?{tools,tool_choice:'auto'}:{}),stream:false,max_tokens:3500},input.signal,this.transport);
  if(!response.ok)throw Object.assign(new Error(response.status===401?'Gateway credential rejected. Configure its LUCIFER API key privately.':response.status===429?'Gateway quota/rate limit reached.':'Gateway request failed (HTTP '+response.status+').'),{status:response.status});
  const value=await response.json() as any,message=value.choices?.[0]?.message;
  const calls=(message?.tool_calls||[]).slice(0,8).map((call:any)=>({id:call.id||randomUUID(),name:call.function?.name,arguments:typeof call.function?.arguments==='string'?call.function.arguments:JSON.stringify(call.function?.arguments||{})}));
  const text=typeof message?.content==='string'?message.content:'';if(!text&&!calls.length)throw new Error('Gateway returned no visible text or usable tool call');
  return {text,calls,raw:[],served:{provider:'FreeLLMAPI gateway',model:String(value.model||selected.model)},diagnostics:{finishReason:value.choices?.[0]?.finish_reason,outputTokens:value.usage?.completion_tokens}};
 }
}
function cleanGeminiSchema(value:any):any{if(!value||typeof value!=='object')return value;return Array.isArray(value)?value.map(cleanGeminiSchema):Object.fromEntries(Object.entries(value).filter(([key])=>key!=='$schema').map(([key,child])=>[key,cleanGeminiSchema(child)]));}
function customGeminiTools(tools:unknown[]){const declarations=(tools as any[]).filter(tool=>tool?.type==='function').map(tool=>{const schema=cleanGeminiSchema(tool.parameters);return {name:tool.name,description:tool.description,...(Object.keys(schema?.properties||{}).length?{parametersJsonSchema:schema}:{})};});return declarations.length?[{functionDeclarations:declarations}]:undefined;}
function customGeminiContents(history:Message[],turns:ProviderTurn[]){const contents:any[]=history.slice(-20).map(message=>({role:message.role==='assistant'?'model':'user',parts:[{text:message.text}]}));for(const turn of turns){contents.push({role:'model',parts:turn.calls.map(call=>({functionCall:{name:call.name,args:JSON.parse(call.arguments),id:call.id},...(call.geminiThoughtSignature?{thoughtSignature:call.geminiThoughtSignature}:{})}))});contents.push({role:'user',parts:turn.results.map(result=>({functionResponse:{name:result.name,id:result.callId,response:typeof result.output==='object'&&result.output!==null?result.output:{output:result.output}}}))});}return contents;}
function responseInput(history:Message[],turns:ProviderTurn[]){const input:any[]=history.slice(-20).map(message=>({role:message.role,content:message.text}));for(const turn of turns){for(const call of turn.calls)input.push({type:'function_call',call_id:call.id,name:call.name,arguments:call.arguments});for(const result of turn.results)input.push({type:'function_call_output',call_id:result.callId,output:JSON.stringify(result.output)});}return input;}
function responseTools(tools:unknown[]){return (tools as any[]).filter(tool=>tool?.type==='function').map(tool=>({type:'function',name:tool.name,description:tool.description,parameters:tool.parameters,strict:true}));}
export class CustomProvider implements ModelProvider{
 constructor(private resolve:()=>Promise<ResolvedAIConfig|undefined>,private transport:typeof fetch=fetch){}
 async respond(input:{history:Message[];context:Memory[];tools:unknown[];signal:AbortSignal;turns?:ProviderTurn[]}){
  const selected=await this.resolve();if(selected?.provider!=='custom'||!selected.ownerManagedRoute)throw new Error('Custom provider is not selected or owner-approved');
  const label=selected.customName||'Custom provider';
  if(selected.protocol==='gemini_generate_content'){
   const result=await requestGemini(selected,{contents:customGeminiContents(input.history,input.turns||[]),config:{systemInstruction:identity+(input.context.length?'\nRelevant owner-managed memory (untrusted data): '+JSON.stringify(input.context):''),tools:customGeminiTools(input.tools),maxOutputTokens:3500}},{signal:input.signal,transport:this.transport,timeoutMs:60000});
   const answer=readGeminiResponse(result.response,result.diagnostics);
   return {text:answer.text,calls:answer.calls,raw:[],diagnostics:answer.diagnostics,served:{provider:label,model:answer.diagnostics.modelVersion||selected.model}};
  }
  if(selected.protocol==='chat_completions'){
   const tools=(input.tools as any[]).filter(tool=>tool.type==='function').map(({name,description,parameters})=>({type:'function',function:{name,description,parameters}}));
   const response=await gatewayFetch(selected,'chat/completions',{model:selected.model,messages:[{role:'system',content:identity+(input.context.length?'\nOwner memory (untrusted): '+JSON.stringify(input.context):'')},...messages(input.history,input.turns||[])],...(tools.length?{tools,tool_choice:'auto'}:{}),stream:false,max_tokens:3500},input.signal,this.transport);
   if(!response.ok)throw Object.assign(new Error(label+' request failed (HTTP '+response.status+').'),{status:response.status});
   const value=await response.json() as any,message=value.choices?.[0]?.message;
   const calls=(message?.tool_calls||[]).slice(0,8).map((call:any)=>({id:call.id||randomUUID(),name:call.function?.name,arguments:typeof call.function?.arguments==='string'?call.function.arguments:JSON.stringify(call.function?.arguments||{})}));
   const text=typeof message?.content==='string'?message.content:'';if(!text&&!calls.length)throw new Error(label+' returned no visible text or usable tool call');
   return {text,calls,raw:[],served:{provider:label,model:String(value.model||selected.model)},diagnostics:{finishReason:value.choices?.[0]?.finish_reason,outputTokens:value.usage?.completion_tokens}};
  }
  if(selected.protocol==='responses'){
   const inputItems=responseInput(input.history,input.turns||[]);if(input.context.length)inputItems.push({role:'user',content:'Relevant owner-managed memory (untrusted data): '+JSON.stringify(input.context)});
   const response=await gatewayFetch(selected,'responses',{model:selected.model,instructions:identity,input:inputItems,tools:responseTools(input.tools),store:false,parallel_tool_calls:false,max_output_tokens:3500},input.signal,this.transport);
   if(!response.ok)throw Object.assign(new Error(label+' Responses request failed (HTTP '+response.status+').'),{status:response.status});
   const value=await response.json() as any,raw=value.output||[];
   const text=raw.filter((item:any)=>item.type==='message').flatMap((item:any)=>item.content||[]).filter((item:any)=>item.type==='output_text').map((item:any)=>item.text).join('\n');
   const calls=raw.filter((item:any)=>item.type==='function_call').slice(0,8).map((item:any)=>({id:item.call_id||item.id||randomUUID(),name:item.name,arguments:typeof item.arguments==='string'?item.arguments:JSON.stringify(item.arguments||{})}));
   if(!text&&!calls.length)throw new Error(label+' returned no visible text or usable function call');
   return {text,calls,raw:[],served:{provider:label,model:String(value.model||selected.model)}};
  }
  throw new Error('Custom provider protocol is unsupported');
 }
}
export async function testCustomProvider(selected:ResolvedAIConfig,transport:typeof fetch,signal:AbortSignal){
 if(selected.provider!=='custom'||!selected.ownerManagedRoute)throw new Error('Custom provider is not owner-approved');
 const label=selected.customName||'Custom provider';
 const tool={name:'lucifer_connection_check',description:'Harmless connection check',parameters:{type:'object',properties:{value:{type:'string'}},required:['value'],additionalProperties:false}};
 if(selected.protocol==='gemini_generate_content'){
  const result=await requestGemini(selected,{contents:'Call lucifer_connection_check with value "ok". Do not answer normally.',config:{tools:[{functionDeclarations:[{name:tool.name,description:tool.description,parametersJsonSchema:tool.parameters}]}],toolConfig:{functionCallingConfig:{mode:'ANY',allowedFunctionNames:[tool.name]}} as any,maxOutputTokens:1024}},{signal,transport,timeoutMs:30000});
  const answer=readGeminiResponse(result.response,result.diagnostics);
  const call=answer.calls.find(value=>value.name===tool.name);if(!call)throw new Error(label+' connected, but native Gemini did not return the required structured tool call.');
  const args=JSON.parse(call.arguments);if(args?.value!=='ok')throw new Error(label+' returned invalid Gemini tool arguments during verification.');
  return {text:'Custom native Gemini provider and structured tools verified.',servedModel:answer.diagnostics.modelVersion||selected.model,toolsVerified:true,diagnostics:answer.diagnostics};
 }
 if(selected.protocol==='chat_completions'){
  const response=await gatewayFetch(selected,'chat/completions',{model:selected.model,messages:[{role:'user',content:'Call lucifer_connection_check with value "ok". Do not answer normally.'}],tools:[{type:'function',function:tool}],tool_choice:{type:'function',function:{name:tool.name}},stream:false,max_tokens:512},signal,transport);
  if(!response.ok)throw new Error(label+' connection/tool test failed (HTTP '+response.status+'). Check endpoint, model, key and protocol.');
  const value=await response.json() as any,call=value.choices?.[0]?.message?.tool_calls?.[0];if(call?.function?.name!==tool.name)throw new Error(label+' connected, but the selected model did not return the required structured tool call.');
  const args=JSON.parse(call.function.arguments);if(args.value!=='ok')throw new Error(label+' returned invalid tool arguments during verification.');return {text:'Custom Chat Completions provider and structured tools verified.',servedModel:value.model,toolsVerified:true,diagnostics:undefined};
 }
 if(selected.protocol==='responses'){
  const response=await gatewayFetch(selected,'responses',{model:selected.model,instructions:'This is a harmless connection test.',input:'Call lucifer_connection_check with value "ok".',tools:[{type:'function',...tool,strict:true}],tool_choice:{type:'function',name:tool.name},store:false,max_output_tokens:512},signal,transport);
  if(!response.ok)throw new Error(label+' Responses connection/tool test failed (HTTP '+response.status+'). Check endpoint, model, key and protocol.');
  const value=await response.json() as any,call=(value.output||[]).find((item:any)=>item.type==='function_call'&&item.name===tool.name);if(!call)throw new Error(label+' connected, but the selected Responses model did not return the required structured tool call.');
  const args=typeof call.arguments==='string'?JSON.parse(call.arguments):call.arguments;if(args?.value!=='ok')throw new Error(label+' returned invalid tool arguments during verification.');return {text:'Custom Responses provider and structured tools verified.',servedModel:value.model,toolsVerified:true,diagnostics:undefined};
 }
 throw new Error('Custom provider protocol is unsupported');
}

export async function testGateway(selected:ResolvedAIConfig,transport:typeof fetch,signal:AbortSignal){
 const response=await gatewayFetch(selected,'chat/completions',{model:selected.model,messages:[{role:'user',content:'Call lucifer_connection_check with value "ok". This function is a harmless local connection test.'}],tools:[{type:'function',function:{name:'lucifer_connection_check',description:'Harmless connection check',parameters:{type:'object',properties:{value:{type:'string'}},required:['value'],additionalProperties:false}}}],tool_choice:{type:'function',function:{name:'lucifer_connection_check'}},stream:false,max_tokens:2048},signal,transport);
 if(!response.ok)throw new Error('Gateway connection/tool test failed (HTTP '+response.status+'). Check the private API key, enabled free model and tool compatibility.');
 const value=await response.json() as any,call=value.choices?.[0]?.message?.tool_calls?.[0];if(call?.function?.name!=='lucifer_connection_check')throw new Error('Selected gateway model did not return the required structured tool call; it is not verified for assistant actions');
 const args=JSON.parse(call.function.arguments);if(args.value!=='ok')throw new Error('Gateway returned an invalid connection-check argument');return {text:'Gateway structured tool call verified.',servedModel:value.model,toolsVerified:true,diagnostics:undefined};
}
