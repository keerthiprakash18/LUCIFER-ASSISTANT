import {readFile,writeFile,rename} from 'node:fs/promises';
import path from 'node:path';
import {z} from 'zod';
import type {FastifyInstance} from 'fastify';
import type {Store} from './store.js';
import {policySchema} from '../companion/policy.js';
export function registerNativePermissions(app:FastifyInstance,store:Store,directory:string){
 const file=path.join(directory,'native/policy.json');
 const load=async()=>policySchema.parse(JSON.parse((await readFile(file,'utf8')).replace(/^\uFEFF/,'')));
 let writing=Promise.resolve();const save=(change:(policy:any)=>void)=>writing=writing.catch(()=>{}).then(async()=>{const policy=await load();change(policy);policySchema.parse(policy);const temporary=file+'.permissions.tmp';await writeFile(temporary,JSON.stringify(policy),{mode:0o600});await rename(temporary,file);});
 app.get('/api/native-permissions',async()=>{try{const policy=await load();return {installed:true,apps:policy.apps,folders:policy.folders,actions:policy.actions,browserAccess:!!policy.browserAccess,routineCommands:store.get<any>('native_preferences','owner')?.routineCommands!==false,discovered:store.list<any>('native_discovery').flatMap(result=>result.apps||[])};}catch{return {installed:false,apps:{},folders:{},actions:[],browserAccess:false,routineCommands:false,discovered:[]};}});
 app.put('/api/native-permissions',async req=>{const input=z.object({browserAccess:z.boolean(),routineCommands:z.boolean()}).strict().parse(req.body);await save(policy=>{policy.browserAccess=input.browserAccess;});store.put('native_preferences',{id:'owner',routineCommands:input.routineCommands});return {saved:true};});
 app.post('/api/native-permissions/apps',async req=>{const {alias,enabled}=z.object({alias:z.string().min(1).max(60),enabled:z.boolean()}).strict().parse(req.body);await save(policy=>{if(!enabled){delete policy.apps[alias];return;}const observed=store.list<any>('native_discovery').flatMap(value=>value.apps||[]).find(app=>app.id===alias);if(!observed)throw new Error('Discover the installed application before granting its launch alias');policy.apps[alias]={executable:observed.executable,args:[]};});return {saved:true};});
}
