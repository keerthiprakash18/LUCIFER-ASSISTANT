import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import staticFiles from '@fastify/static';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { config } from './config.js';
import { Store } from './store.js';
import { login,validSession,hash,redact } from './auth.js';
import { Tasks } from './tasks.js';
import { Assistant } from './assistant.js';
import { skills } from './skills.js';
import { settingsSchema } from '../shared/contracts.js';
import { Devices } from './devices.js';
import { Files } from './files.js';
import { Reports } from './reports.js';
import { Telegram,TelegramClient } from './telegram.js';
import { Scheduler } from './scheduler.js';
import { Proposals } from './proposals.js';
import { AIConfigService,aiConfigInputSchema } from './ai-config.js';
import { registerNativeVoice } from './native-voice.js';
import {registerNativePermissions} from './native-permissions.js';
import {registerDocuments} from './documents.js';
import {registerLocalActions} from './local-actions.js';
const errorMessage=(error:unknown)=>redact(String((error as {message?:unknown})?.message||error));
export async function createApp(directory=config.dataDir,telegramClient?:TelegramClient) {
  const store=new Store(directory),tasks=new Tasks(store),ai=new AIConfigService(store,directory),assistant=new Assistant(store,tasks,ai);
  const app=Fastify({logger:false,bodyLimit:1024*1024,requestTimeout:90000});
  await app.register(cookie);await app.register(helmet,{contentSecurityPolicy:{directives:{defaultSrc:["'self'"],scriptSrc:["'self'"],styleSrc:["'self'","'unsafe-inline'"],fontSrc:["'self'","data:"],imgSrc:["'self'","data:"],connectSrc:["'self'"],frameSrc:["'self'"],objectSrc:["'none'"],upgradeInsecureRequests:config.secure?[]:null}},hsts:config.secure});
  await app.register(rateLimit,{max:180,timeWindow:'1 minute'});
  app.setErrorHandler((error,_req,reply)=>{const e=error as Error&{statusCode?:number};reply.code(e instanceof z.ZodError?400:e.statusCode||400).send({error:redact(e instanceof z.ZodError?e.issues.map(i=>i.message).join('; '):e.message)});});
  app.addHook('preHandler',async(req,reply)=>{
    const route=req.routeOptions.url||req.url.split('?')[0];
    if(!route.startsWith('/api/'))return;
    if(route.startsWith('/api/companion/'))return;
    if(!['GET','HEAD'].includes(req.method)) {
      const allowed=[config.origin];if(config.origin==='http://localhost:5173')allowed.push('http://127.0.0.1:5173','http://localhost:3001','http://127.0.0.1:3001');
      if(req.headers['x-lucifer-request']!=='1'||(req.headers.origin&&!allowed.includes(req.headers.origin)))return reply.code(403).send({error:'Request origin rejected'});
    }
    if(['/api/health','/api/auth/status','/api/auth/login'].includes(route))return;
    if(!validSession(store,req.cookies.lucifer_session))return reply.code(401).send({error:'Sign in as the owner'});
  });
  app.get('/api/health',async()=>({ok:true,name:'LUCIFER'}));
  app.get('/api/auth/status',async(req)=>({configured:!!store.get('owner','owner'),authenticated:validSession(store,req.cookies.lucifer_session)}));
  app.post('/api/auth/login',{config:{rateLimit:{max:5,timeWindow:'1 minute'}}},async(req,reply)=>{const {password}=z.object({password:z.string().max(200)}).parse(req.body);const token=login(store,password);if(!token)return reply.code(401).send({error:'Invalid owner password'});reply.setCookie('lucifer_session',token,{httpOnly:true,sameSite:'strict',secure:config.secure,path:'/',maxAge:604800});return {ok:true};});
  app.post('/api/auth/logout',async(req,reply)=>{if(req.cookies.lucifer_session)store.db.prepare('DELETE FROM sessions WHERE hash=?').run(hash(req.cookies.lucifer_session));reply.clearCookie('lucifer_session',{path:'/'});return {ok:true};});
  const stateExtra:()=>Record<string,unknown>=()=>({});
  const extras={state:stateExtra};
  const devices=new Devices(store,tasks,()=>assistant.settings());devices.register(app);
  assistant.tools.push({name:'list_devices',description:'Discover paired devices and approved aliases. Does not execute actions.',schema:z.object({}).strict(),permission:'devices',run:async()=>store.list<any>('device').map(d=>({...d,online:!d.revoked&&Date.now()-Date.parse(d.lastSeen)<15000}))});
  const files=new Files(store,()=>assistant.settings(),directory);await files.register(app,assistant);
  const reports=new Reports(store,files,tasks,assistant);reports.register(app);
  registerDocuments(app,assistant,files);
  app.get('/api/import-template',async(_req,reply)=>reply.type('text/csv').header('Content-Disposition','attachment; filename="instagram-posts-template.csv"').send('post_id,date,format,theme,caption,reach,views,impressions,likes,comments,shares,saves\n'));
  const telegram=new Telegram(store,assistant,files,tasks,telegramClient);telegram.register(app);
  const scheduler=new Scheduler(store,telegram,()=>assistant.settings());scheduler.register(app);scheduler.start();
  const proposals=new Proposals(store,assistant,tasks,devices,scheduler);proposals.register(app);
  registerNativeVoice(app,store,assistant,devices,tasks,scheduler,proposals);registerNativePermissions(app,store,directory);
  registerLocalActions(assistant);
  extras.state=()=>{const destination=store.get<any>('integration','telegram');const permissions=assistant.settings().permissions;return {emergency:store.get<any>('control','emergency')?.stopped||false,telegram:{connected:!!destination?.connected&&permissions.telegram&&!!telegram.client.token,name:destination?.name},deliveries:store.list('delivery'),integrations:[{id:'instagram',name:'Instagram',status:'import available',detail:'Owner-imported data; direct API connection unsupported in this release'},{id:'telegram',name:'Telegram',status:!permissions.telegram?'disconnected':destination?.connected&&telegram.client.token?'connected':telegram.client.token?'awaiting verification':'awaiting configuration',detail:destination?.connected?`Verified destination: ${destination.name}`:'Configure a server bot token, then verify a private destination'}]};};
  app.get('/api/integrations/model/status',async()=>ai.status());
  app.get('/api/integrations/model/routing',async()=>ai.routing());
  app.get('/api/integrations/model/profiles',async()=>ai.profiles());
  app.put('/api/integrations/model/routing',async req=>ai.saveRouting(req.body));
  app.post('/api/integrations/model/gateway-models',async req=>{const input=z.object({baseUrl:z.string().url(),apiKey:z.string().max(500).optional(),windowsBridge:z.boolean()}).strict().parse(req.body);const probe=aiConfigInputSchema.parse({provider:'freellmapi',protocol:'chat_completions',model:'discovery',...input,apiKey:input.apiKey||'',freeRouteAllowed:true});const saved=await ai.resolve('freellmapi');const {gatewayFetch}=await import('./gateway.js');const response=await gatewayFetch({...probe,apiKey:probe.apiKey||saved?.apiKey,source:'none'},'models',undefined,AbortSignal.timeout(15000));if(!response.ok)throw new Error('Gateway models request returned HTTP '+response.status+'. Enter the gateway key privately in this LUCIFER form.');const value=await response.json() as any;return {models:(value.data||[]).map((model:any)=>({id:model.id,free:model.free===true,tools:model.supports_tools===true||model.tools===true})),note:'Gateway listing is not proof of free eligibility or tool compatibility. Enable a free route in the gateway, then save and test its structured tools.'};});
  app.put('/api/integrations/model/config',async(req)=>{await ai.save(aiConfigInputSchema.parse(req.body));return {status:await ai.status()};});
  app.post('/api/integrations/model/test',async(req,reply)=>{
    const controller=new AbortController();
    const cancel=()=>{if(!reply.raw.writableEnded)controller.abort();};
    req.raw.once('aborted',cancel);reply.raw.once('close',cancel);
    try {if((await ai.resolve())?.provider==='openai')throw new Error('Paid routes are disabled; choose Gemini, local Ollama or an enabled free gateway route.');const result=await ai.test(controller.signal);return {status:await ai.status(),test:result};}
    catch(error){return {status:await ai.status(),error:errorMessage(error)};}
    finally {req.raw.off('aborted',cancel);reply.raw.off('close',cancel);}
  });
  app.post('/api/integrations/:id/disconnect',async(req)=>{const key=(req.params as {id:string}).id;if(!['model','telegram'].includes(key))throw new Error('Integration not connected');if(key==='model')await ai.disconnect();else{const s=assistant.settings();store.put('settings',{id:'owner',...s,permissions:{...s.permissions,telegram:false}});store.remove('integration','telegram');store.remove('verification','telegram');}return {ok:true};});
  const retention=setInterval(()=>{void files.retain();},3600000);retention.unref();
  const deviceExpiry=setInterval(()=>devices.expirePending(),1000);deviceExpiry.unref();
  app.get('/api/state',async()=>{const aiStatus=await ai.status();const extra=extras.state() as any;const label=aiStatus.provider==='gemini'?'Google Gemini':aiStatus.provider==='ollama'?'Ollama':'OpenAI';return {settings:assistant.settings(),messages:store.list('message').slice(-100),tasks:store.list('task').slice(-100).reverse(),memory:store.list('memory'),files:store.list('file'),devices:store.list('device'),reminders:store.list('reminder'),notifications:store.list('notification'),proposals:store.list('proposal'),skills,ai:aiStatus,...extra,integrations:[{id:'model',name:'AI provider',status:aiStatus.status,detail:aiStatus.status==='connected'?`${label} · ${aiStatus.protocol} · ${aiStatus.model}`:aiStatus.status==='unsupported'?'This provider/protocol is not implemented here':`${label} · choose a model`},...((extra.integrations)||[])]};});
  app.put('/api/settings',async(req)=>{const s=settingsSchema.parse(req.body);store.put('settings',{id:'owner',...s});return s;});
  app.post('/api/chat',async(req)=>{if(store.get<{stopped:boolean}>('control','emergency')?.stopped)throw new Error('Emergency stop is active');const body=z.object({text:z.string().min(1).max(12000),fileIds:z.array(z.uuid()).max(5).default([]),deviceId:z.uuid().optional()}).strict().parse(req.body);let target:string|undefined;if(store.get<any>('native_preferences','owner')?.routineCommands!==false){const approved=store.list<any>('device').filter(device=>device.voiceAuthorized&&!device.revoked&&device.platform==='win32'&&Date.now()-Date.parse(device.lastSeen)<15000);if(body.deviceId){if(!approved.some(device=>device.id===body.deviceId))throw new Error('Selected routine-action laptop is offline or not authorized');target=body.deviceId;}else if(approved.length===1)target=approved[0].id;}const task=await assistant.chat(body.text,body.fileIds,target,assistant.settings().language==='ta-IN'?'ta':assistant.settings().language==='en-IN'?'en':'auto');if(target)store.put('native_turn',{id:task.id,deviceId:target,source:'dashboard'});return task;});
  app.delete('/api/conversation',async()=>{for(const m of store.list<{id:string}>('message'))store.remove('message',m.id);return {ok:true};});
  app.post('/api/tasks/:id/cancel',async(req)=>{const {id}=req.params as {id:string};tasks.cancel(id);for(const c of store.list<any>('command'))if((c.taskId===id||c.parentTaskId===id)&&['pending','claimed'].includes(c.status)){store.put('command',{...c,status:'cancelled'});tasks.cancel(c.taskId);}for(const p of store.list<any>('proposal'))if(p.taskId===id&&p.state==='pending')store.put('proposal',{...p,state:'rejected'});return {ok:true};});
  app.post('/api/emergency-stop',async()=>{store.put('control',{id:'emergency',stopped:true});for(const t of store.list<{id:string}>('task'))tasks.cancel(t.id);for(const c of store.list<any>('command'))if(['pending','claimed'].includes(c.status))store.put('command',{...c,status:'cancelled'});for(const p of store.list<any>('proposal'))if(p.state==='pending')store.put('proposal',{...p,state:'rejected'});return {ok:true};});
  app.post('/api/resume',async()=>{store.put('control',{id:'emergency',stopped:false});return {ok:true};});
  if(existsSync(path.join(config.root,'dist'))) {await app.register(staticFiles,{root:path.join(config.root,'dist')});app.setNotFoundHandler((req,reply)=>req.url.startsWith('/api/')?reply.code(404).send({error:'Not found'}):reply.sendFile('index.html'));}
  app.addHook('onClose',async()=>{scheduler.stop();clearInterval(retention);clearInterval(deviceExpiry);for(const controller of tasks.controllers.values())controller.abort();while(tasks.controllers.size||scheduler.busy)await new Promise(r=>setTimeout(r,20));store.close();});
  return {app,store,tasks,assistant,extras,devices,files,reports,telegram,scheduler,proposals,ai};
}
