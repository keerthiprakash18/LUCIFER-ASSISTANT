import type {Store} from './store.js';
import type {ResolvedAIConfig} from './ai-config.js';
import {gatewayFetch} from './gateway.js';

export type NvidiaCategory='agent'|'reasoning'|'vision'|'translation'|'embedding'|'specialist';
export type NvidiaModelRecord={
  id:string;model:string;category:NvidiaCategory;status:'discovered'|'healthy'|'cooldown';
  failures:number;lastSuccessAt?:string;lastFailureAt?:string;cooldownUntil?:string;lastError?:string;
};

export const isNvidiaSelection=(selected:ResolvedAIConfig|undefined)=>!!selected&&selected.provider==='custom'&&(
  selected.baseUrl.includes('integrate.api.nvidia.com')||/nvidia/i.test(selected.customName||'')
);

export function classifyNvidiaModel(model:string):NvidiaCategory{
  const id=model.toLowerCase();
  if(/embed|embedding|rerank|retrieval/.test(id))return 'embedding';
  if(/translat|nmt|riva/.test(id))return 'translation';
  if(/pose|tabular|relational|calibration|safety|guard/.test(id))return 'specialist';
  if(/vision|vlm|multimodal|image|video|muse|kimi|deepseek-vl|flash/.test(id))return 'vision';
  if(/reason|deepseek|glm|nemotron|llama|qwen|mistral|mixtral|gpt|phi|command|muse-glimmer/.test(id))return 'reasoning';
  return 'agent';
}

export async function syncNvidiaPool(store:Store,selected:ResolvedAIConfig,signal:AbortSignal,transport:typeof fetch=fetch){
  if(!isNvidiaSelection(selected))throw new Error('Select the verified NVIDIA Build provider before syncing its model pool.');
  const response=await gatewayFetch(selected,'models',undefined,signal,transport);
  if(!response.ok)throw Object.assign(new Error('NVIDIA model discovery failed (HTTP '+response.status+').'),{status:response.status});
  const value=await response.json() as any;
  const ids=[...new Set((value.data||[]).map((item:any)=>String(item?.id||'').trim()).filter(Boolean))].sort();
  if(!ids.length)throw new Error('NVIDIA returned no discoverable model IDs.');
  const seen=new Set(ids);
  for(const model of ids){
    const current=store.get<NvidiaModelRecord>('nvidia_model',model);
    store.put('nvidia_model',{id:model,model,category:classifyNvidiaModel(model),status:current?.status||'discovered',failures:current?.failures||0,lastSuccessAt:current?.lastSuccessAt,lastFailureAt:current?.lastFailureAt,cooldownUntil:current?.cooldownUntil,lastError:current?.lastError});
  }
  for(const current of store.list<NvidiaModelRecord>('nvidia_model'))if(!seen.has(current.model))store.remove('nvidia_model',current.id);
  store.put('nvidia_pool',{id:'pool',syncedAt:new Date().toISOString(),count:ids.length});
  return nvidiaPoolSummary(store,selected.model);
}

export function nvidiaPoolSummary(store:Store,primary?:string){
  const models=store.list<NvidiaModelRecord>('nvidia_model');
  const counts={agent:0,reasoning:0,vision:0,translation:0,embedding:0,specialist:0};
  for(const model of models)counts[model.category]++;
  const cooldown=models.filter(model=>model.cooldownUntil&&Date.parse(model.cooldownUntil)>Date.now()).length;
  const healthy=models.filter(model=>model.status==='healthy'&&(!model.cooldownUntil||Date.parse(model.cooldownUntil)<=Date.now())).length;
  return {syncedAt:store.get<any>('nvidia_pool','pool')?.syncedAt,count:models.length,counts,healthy,cooldown,primary:primary||'',models};
}

export function nvidiaAgentCandidates(store:Store,selected:ResolvedAIConfig,limit=4):ResolvedAIConfig[]{
  if(!isNvidiaSelection(selected))return [selected];
  const now=Date.now();
  const records=store.list<NvidiaModelRecord>('nvidia_model')
    .filter(model=>['agent','reasoning'].includes(model.category))
    .filter(model=>!model.cooldownUntil||Date.parse(model.cooldownUntil)<=now)
    .sort((a,b)=>{
      if(a.model===selected.model)return -1;if(b.model===selected.model)return 1;
      const ah=a.status==='healthy'?0:1,bh=b.status==='healthy'?0:1;if(ah!==bh)return ah-bh;
      return (a.failures||0)-(b.failures||0)||a.model.localeCompare(b.model);
    });
  const ids=[selected.model,...records.map(record=>record.model)].filter((id,index,list)=>id&&list.indexOf(id)===index).slice(0,Math.max(1,limit));
  return ids.map(model=>({...selected,model}));
}

export function markNvidiaSuccess(store:Store,model:string){
  const current=store.get<NvidiaModelRecord>('nvidia_model',model)||{id:model,model,category:classifyNvidiaModel(model),status:'discovered',failures:0};
  store.put('nvidia_model',{...current,status:'healthy',failures:0,lastSuccessAt:new Date().toISOString(),cooldownUntil:undefined,lastError:undefined});
}
export function markNvidiaFailure(store:Store,model:string,error:unknown){
  const current=store.get<NvidiaModelRecord>('nvidia_model',model)||{id:model,model,category:classifyNvidiaModel(model),status:'discovered',failures:0};
  const failures=(current.failures||0)+1;
  const cooldownMs=Math.min(30*60_000,60_000*Math.pow(2,Math.min(failures-1,4)));
  const raw=String((error as any)?.message||error).slice(0,300);
  store.put('nvidia_model',{...current,status:'cooldown',failures,lastFailureAt:new Date().toISOString(),cooldownUntil:new Date(Date.now()+cooldownMs).toISOString(),lastError:raw});
}
