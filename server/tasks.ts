import type { Task, TaskState } from '../shared/contracts.js';
import { Store,id,now } from './store.js';
import { redact } from './auth.js';
export class Tasks {
  controllers=new Map<string,AbortController>();
  constructor(public store:Store) {
    for(const t of store.list<Task>('task'))if(['running','queued'].includes(t.state))this.update(t.id,'partially_completed',undefined,'Application restarted. Review completed steps before retrying.');
  }
  create(title:string,state:TaskState='queued') {return this.store.put('task',{id:id(),title:redact(title),state,events:[],createdAt:now()} as Task);}
  event(taskId:string,text:string) {const t=this.store.get<Task>('task',taskId);if(t){t.events.push({at:now(),text:redact(text)});this.store.put('task',t);}}
  update(taskId:string,state:TaskState,result?:unknown,error?:string) {const t=this.store.get<Task>('task',taskId);if(t){if(t.state==='cancelled'&&state!=='cancelled')return t;t.state=state;if(result!==undefined)t.result=result;if(error)t.error=redact(error);this.store.put('task',t);}return t;}
  async run(title:string,work:(task:Task,signal:AbortSignal)=>Promise<unknown>) {
    const task=this.create(title);const controller=new AbortController();this.controllers.set(task.id,controller);
    void (async()=>{try{this.update(task.id,'running');const result=await work(task,controller.signal);controller.signal.throwIfAborted();const outcome=(result as any)?.outcome;const state:TaskState=['awaiting_input','awaiting_authorization','partially_completed'].includes(outcome)?outcome:'completed';this.update(task.id,state,result);this.event(task.id,state==='completed'?'Completed and result saved.':state==='partially_completed'?'Partial result saved; unconfirmed steps are listed.':'Result saved; waiting for owner input.');}catch(e){if(controller.signal.aborted)this.update(task.id,'cancelled',undefined,'Stopped. Already completed actions are not undone.');else {const prior=this.store.get<Task>('task',task.id);this.update(task.id,(prior?.result as any)?.steps?.length?'partially_completed':'failed',undefined,(e as Error).message);}}finally{this.controllers.delete(task.id);}})();
    return task;
  }
  cancel(taskId:string) {this.controllers.get(taskId)?.abort();const task=this.store.get<Task>('task',taskId);if(task&& !['completed','failed','cancelled'].includes(task.state)){this.update(taskId,'cancelled',undefined,'No further steps will start. An OS launch or external send already started may finish.');this.event(taskId,'Cancellation requested by owner.');}}
}
