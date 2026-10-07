import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,rmSync} from 'node:fs';
import path from 'node:path';
import {Store} from '../server/store.js';
import {syncNvidiaPool,nvidiaPoolSummary,nvidiaAgentCandidates,markNvidiaFailure} from '../server/nvidia-pool.js';
import {createApp} from '../server/app.js';

test('NVIDIA pool sync catalogues every reported model and separates specialist capabilities',async()=>{
  mkdirSync('.local/tests',{recursive:true});
  const dir=mkdtempSync(path.resolve('.local/tests/nvidia-pool-'));const store=new Store(dir);
  const selected={provider:'custom' as const,protocol:'chat_completions' as const,customName:'NVIDIA Build',model:'nvidia/nemotron-3.5-lightning-30b-a3b',baseUrl:'https://integrate.api.nvidia.com/v1',apiKey:'SYNTHETIC-NVIDIA-KEY',source:'runtime_vault' as const,ownerManagedRoute:true};
  const ids=['nvidia/nemotron-3.5-lightning-30b-a3b','meta/llama-3.3-70b-instruct','nvidia/nemotron-3-embed-1b','nvidia/riva-translate-4b-instruct-v2','nvidia/3d-body-pose','meta/muse-glimmer-30b'];
  const transport:typeof fetch=async(_url,init)=>{
    assert.equal((init?.headers as Record<string,string>).Authorization,'Bearer SYNTHETIC-NVIDIA-KEY');
    return Response.json({data:ids.map(id=>({id}))});
  };
  try{
    const synced=await syncNvidiaPool(store,selected,AbortSignal.timeout(2000),transport);
    assert.equal(synced.count,ids.length);
    assert.equal(synced.counts.embedding,1);assert.equal(synced.counts.translation,1);assert.equal(synced.counts.specialist,1);
    assert.ok((synced.counts.agent+synced.counts.reasoning+synced.counts.vision)>=3);
    const candidates=nvidiaAgentCandidates(store,selected,4);
    assert.equal(candidates[0].model,selected.model);
    assert.ok(candidates.every(candidate=>!candidate.model.includes('embed')&&!candidate.model.includes('translate')&&!candidate.model.includes('pose')));
    markNvidiaFailure(store,selected.model,Object.assign(new Error('quota'),{status:429}));
    const after=nvidiaPoolSummary(store,selected.model);
    assert.equal(after.cooldown,1);
    assert.notEqual(nvidiaAgentCandidates(store,selected,4)[0].model,selected.model);
  }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});

test('LUCIFER rotates to another healthy NVIDIA agent model on a transient primary failure',async()=>{
  mkdirSync('.local/tests',{recursive:true});
  const dir=mkdtempSync(path.resolve('.local/tests/nvidia-runtime-'));const app=await createApp(dir);const original=globalThis.fetch;
  const primary='nvidia/nemotron-3.5-lightning-30b-a3b',secondary='meta/llama-3.3-70b-instruct';const calls:string[]=[];
  try{
    await app.ai.save({provider:'custom',protocol:'chat_completions',customName:'NVIDIA Build',model:primary,baseUrl:'https://integrate.api.nvidia.com/v1',apiKey:'SYNTHETIC-NVIDIA-KEY',ownerManagedRoute:true});
    app.store.put('nvidia_model',{id:primary,model:primary,category:'reasoning',status:'healthy',failures:0});
    app.store.put('nvidia_model',{id:secondary,model:secondary,category:'reasoning',status:'healthy',failures:0});
    globalThis.fetch=async(_url,init)=>{
      const body=JSON.parse(String(init?.body));calls.push(body.model);
      if(body.model===primary)return new Response(JSON.stringify({error:{message:'rate limited'}}),{status:429,headers:{'content-type':'application/json'}});
      return Response.json({model:secondary,choices:[{finish_reason:'stop',message:{role:'assistant',content:'NVIDIA pool failover succeeded.'}}]});
    };
    const task=await app.assistant.chat('Say that the NVIDIA pool is ready.');
    while(app.tasks.controllers.has(task.id))await new Promise(resolve=>setTimeout(resolve,10));
    const stored=app.store.get<any>('task',task.id);
    assert.equal(stored.state,'completed',stored.error);
    assert.deepEqual(calls.slice(0,2),[primary,secondary]);
    assert.match(String(stored.result.reply),/pool failover succeeded/i);
    assert.equal(stored.result.served.at(-1).model,secondary);
    assert.equal(app.store.get<any>('nvidia_model',primary).status,'cooldown');
    assert.equal(app.store.get<any>('nvidia_model',secondary).status,'healthy');
  }finally{globalThis.fetch=original;await app.app.close();rmSync(dir,{recursive:true,force:true});}
});
