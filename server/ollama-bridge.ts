import {spawn} from 'node:child_process';
import path from 'node:path';
import {existsSync} from 'node:fs';
import type {ResolvedAIConfig} from './ai-config.js';

export async function ollamaFetch(resolved:ResolvedAIConfig,url:string|URL|Request,init:RequestInit|undefined,signal:AbortSignal,transport:typeof fetch=fetch):Promise<Response>{
  const target=typeof url==='string'?url:url instanceof URL?url.toString():url.url;
  if(!resolved.windowsBridge||process.platform==='win32')return transport(target,{...init,signal:AbortSignal.any([signal,init?.signal||new AbortController().signal])});
  const parsed=new URL(target);
  if(!['localhost','127.0.0.1','[::1]'].includes(parsed.hostname)||parsed.protocol!=='http:'||String(parsed.port||'80')!=='11434'||!['/api/tags','/api/chat'].includes(parsed.pathname)||parsed.username||parsed.password||parsed.search||parsed.hash)throw new Error('Ollama Windows bridge blocked a non-loopback or unsupported endpoint');
  const node='/mnt/c/Program Files/nodejs/node.exe';
  if(!existsSync(node))throw new Error('Windows Node is unavailable for the Ollama loopback bridge');
  const helper=path.resolve('server/ollama-bridge.cjs').replace(/^\/mnt\/([a-z])\//,(_,drive)=>drive.toUpperCase()+':/').replaceAll('/','\\');
  return new Promise((resolve,reject)=>{
    const child=spawn(node,[helper],{shell:false,windowsHide:true,signal});let out='';
    const timer=setTimeout(()=>{child.kill();reject(new Error('Windows Ollama bridge timed out'));},73000);
    child.stdout.on('data',data=>{out+=data;if(out.length>2_500_000){child.kill();reject(new Error('Windows Ollama bridge response exceeds the supported size'));}});
    child.stderr.on('data',()=>{});
    child.on('error',()=>{clearTimeout(timer);reject(signal.aborted?signal.reason:new Error('Windows Ollama bridge unavailable'));});
    child.on('close',()=>{clearTimeout(timer);try{const value=JSON.parse(out);resolve(new Response(value.body,{status:value.status,headers:{'Content-Type':value.contentType||'application/json'}}));}catch{reject(new Error('Invalid Windows Ollama bridge response'));}});
    child.stdin.on('error',()=>{});
    const body=typeof init?.body==='string'?init.body:undefined;
    child.stdin.end(JSON.stringify({url:target,method:init?.method||'GET',body}));
  });
}
