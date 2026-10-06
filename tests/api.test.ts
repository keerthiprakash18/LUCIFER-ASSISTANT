import { test } from 'node:test';
import assert from 'node:assert/strict';
import { api, APIError } from '../src/api.js';

test('frontend API rejects unreadable responses and reports errors without returning invalid state', async t => {
  const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original;});
  globalThis.fetch=async()=>new Response('<html>Proxy failure</html>',{status:502});
  await assert.rejects(api('/state'),/unreadable response/);
  globalThis.fetch=async()=>Response.json({error:'Temporary failure'},{status:503});
  await assert.rejects(api('/state'),(error:unknown)=>error instanceof APIError&&error.status===503&&error.message==='Temporary failure');
});

test('frontend API times out and honours explicit cancellation', async t => {
  const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original;});
  globalThis.fetch=async(_url,init)=>new Promise((_resolve,reject)=>{
    if(init?.signal?.aborted){reject(init.signal.reason);return;}
    init?.signal?.addEventListener('abort',()=>reject(init.signal?.reason),{once:true});
  });
  await assert.rejects(api('/state','GET',undefined,{timeoutMs:10}),/timed out/);
  const controller=new AbortController();
  const request=api('/integrations/model/test','POST',undefined,{signal:controller.signal});
  controller.abort();await assert.rejects(request,/cancelled/);
});
