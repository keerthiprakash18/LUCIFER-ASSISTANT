import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { deviceActionSchema,reminderSchema } from '../shared/contracts.js';
import { Store,id,now } from './store.js';
import type { Assistant } from './assistant.js';
import type { Devices } from './devices.js';
import type { Scheduler } from './scheduler.js';
import type { Tasks } from './tasks.js';
import { redact } from './auth.js';
export interface Proposal {id:string;taskId:string;kind:'device'|'reminder'|'memory';input:any;state:'pending'|'accepted'|'rejected'|'expired'|'failed';summary:string;expiresAt:string;createdAt:string;result?:unknown}
const memoryInput=z.object({context:z.string().min(1).max(80),key:z.string().min(1).max(100),value:z.string().min(1).max(5000)}).strict();
const reminderInput=reminderSchema.omit({at:true}).extend({localTime:z.string()}).strict();
export class Proposals {
 constructor(public store:Store,public assistant:Assistant,public tasks:Tasks,public devices:Devices,public scheduler:Scheduler){}
 create(kind:Proposal['kind'],input:unknown,summary:string){
  if(this.store.get<{stopped:boolean}>('control','emergency')?.stopped)throw new Error('Emergency stop is active');
  const task=this.tasks.create(summary,'awaiting_authorization');this.tasks.event(task.id,'Waiting for the owner to review the exact scope. No external action has run.');
  return this.store.put('proposal',{id:id(),taskId:task.id,kind,input,state:'pending',summary,expiresAt:new Date(Date.now()+300000).toISOString(),createdAt:now()} as Proposal);
 }
 register(app:FastifyInstance){
  this.assistant.tools.push(
   {name:'propose_device_action',description:'Prepare a structured action for an explicit target laptop. Use discovered app, folder and command aliases. This does not execute; the owner reviews the exact scope in the action card.',schema:z.object({deviceId:z.uuid(),action:deviceActionSchema}).strict(),permission:'devices',run:async input=>{const device=this.store.get<any>('device',input.deviceId);if(!device||device.revoked)throw new Error('Choose a paired device');return this.create('device',input,`${device.name}: ${input.action.kind.replaceAll('_',' ')}`);}},
   {name:'propose_reminder',description:'Resolve an explicit reminder request to a concrete local date and time in the selected timezone. Ask about ambiguity. Recurrence only when explicitly requested. Owner reviews the date and delivery channel before scheduling.',schema:reminderInput,permission:'reminders',run:async input=>this.create('reminder',input,`Remind: ${input.title} · ${input.localTime} ${input.timezone}`)},
   {name:'propose_memory',description:'Prepare durable memory only when the owner explicitly asks to remember something. Do not store secrets. Keep project/brand context distinct. Owner reviews before saving.',schema:memoryInput,permission:null,run:async input=>{if(!this.assistant.settings().memoryEnabled)throw new Error('Memory is disabled');return this.create('memory',input,`Remember ${input.key} in ${input.context}`);}},
  );
  app.post('/api/proposals/:id/accept',async(req)=>{
   const proposal=this.store.get<Proposal>('proposal',(req.params as {id:string}).id);if(!proposal||proposal.state!=='pending')throw new Error('This proposal has already been resolved');
   if(Date.parse(proposal.expiresAt)<=Date.now()){this.store.put('proposal',{...proposal,state:'expired'});this.tasks.update(proposal.taskId,'failed',undefined,'Proposal expired; issue a fresh instruction.');throw new Error('Proposal expired. Issue a fresh instruction.');}
   if(this.store.get<{stopped:boolean}>('control','emergency')?.stopped)throw new Error('Emergency stop is active');
   this.store.put('proposal',{...proposal,state:'accepted'});
   try{let result:unknown;
    if(proposal.kind==='device'){const input=z.object({deviceId:z.uuid(),action:deviceActionSchema}).strict().parse(proposal.input);result=this.devices.enqueue(input.deviceId,input.action,true);}
    else if(proposal.kind==='reminder')result=this.scheduler.save(proposal.input);
    else{if(!this.assistant.settings().memoryEnabled)throw new Error('Memory is disabled');const m=memoryInput.parse(proposal.input);if(redact(m.value)!==m.value||/password|api.?key|token|secret/i.test(m.key))throw new Error('Credentials cannot be stored in memory');result=this.store.put('memory',{id:id(),...m,provenance:'Explicit owner-approved chat request',updatedAt:now()});}
    this.store.put('proposal',{...proposal,state:'accepted',result});this.tasks.update(proposal.taskId,'completed',result);this.tasks.event(proposal.taskId,proposal.kind==='device'?'Authorized command submitted; follow its separate device task.':'Owner-approved result saved.');return result;
   }catch(e){this.store.put('proposal',{...proposal,state:'failed'});this.tasks.update(proposal.taskId,'failed',undefined,(e as Error).message);throw e;}
  });
  app.post('/api/proposals/:id/reject',async(req)=>{const p=this.store.get<Proposal>('proposal',(req.params as {id:string}).id);if(p?.state==='pending'){this.store.put('proposal',{...p,state:'rejected'});this.tasks.cancel(p.taskId);}return {ok:true};});
 }
}
