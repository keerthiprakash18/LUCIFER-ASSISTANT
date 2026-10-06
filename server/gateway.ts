import {spawn} from 'node:child_process';
import path from 'node:path';
import {existsSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import type {ResolvedAIConfig} from './ai-config.js';
import type {ModelProvider,ProviderTurn,Message,Memory} from '../shared/contracts.js';
import {identity} from './provider.js';
export async function gatewayFetch(resolved:ResolvedAIConfig,endpoint:'models'|'chat/completions',body:unknown,signal:AbortSignal,transport:typeof fetch=fetch):Promise<Response>{
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
export async function testGateway(selected:ResolvedAIConfig,transport:typeof fetch,signal:AbortSignal){
 const response=await gatewayFetch(selected,'chat/completions',{model:selected.model,messages:[{role:'user',content:'Call lucifer_connection_check with value "ok". This function is a harmless local connection test.'}],tools:[{type:'function',function:{name:'lucifer_connection_check',description:'Harmless connection check',parameters:{type:'object',properties:{value:{type:'string'}},required:['value'],additionalProperties:false}}}],tool_choice:{type:'function',function:{name:'lucifer_connection_check'}},stream:false,max_tokens:2048},signal,transport);
 if(!response.ok)throw new Error('Gateway connection/tool test failed (HTTP '+response.status+'). Check the private API key, enabled free model and tool compatibility.');
 const value=await response.json() as any,call=value.choices?.[0]?.message?.tool_calls?.[0];if(call?.function?.name!=='lucifer_connection_check')throw new Error('Selected gateway model did not return the required structured tool call; it is not verified for assistant actions');
 const args=JSON.parse(call.function.arguments);if(args.value!=='ok')throw new Error('Gateway returned an invalid connection-check argument');return {text:'Gateway structured tool call verified.',servedModel:value.model,toolsVerified:true,diagnostics:undefined};
}
