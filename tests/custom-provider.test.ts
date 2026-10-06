import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { CustomProvider } from '../server/gateway.js';

test('custom Chat Completions provider reaches the existing validated assistant tool loop',async()=>{
  mkdirSync('.local/tests',{recursive:true});
  const directory=mkdtempSync(path.resolve('.local/tests/custom-tool-'));
  const service=await createApp(directory);
  let requests=0;
  const transport:typeof fetch=async(_url,init)=>{
    requests++;
    const body=JSON.parse(String(init?.body));
    assert.equal(body.model,'custom-tools-model');
    assert.equal((init?.headers as Record<string,string>).Authorization,'Bearer custom-tool-secret');
    if(requests===1){
      assert.ok(body.tools.some((tool:any)=>tool.function?.name==='current_time'));
      return Response.json({model:'custom-tools-model',choices:[{finish_reason:'tool_calls',message:{role:'assistant',content:null,tool_calls:[{id:'clock-call',type:'function',function:{name:'current_time',arguments:'{}'}}]}}]});
    }
    const toolMessage=body.messages.find((message:any)=>message.role==='tool');
    assert.ok(toolMessage,'verified tool output must be returned to the custom model');
    const output=JSON.parse(toolMessage.content);
    assert.equal(output.timezone,'Asia/Kolkata');
    return Response.json({model:'custom-tools-model',choices:[{finish_reason:'stop',message:{role:'assistant',content:'The verified clock result was received.'}}]});
  };
  try{
    await service.ai.save({provider:'custom',protocol:'chat_completions',customName:'Test Custom',model:'custom-tools-model',baseUrl:'https://custom.example/v1',apiKey:'custom-tool-secret',ownerManagedRoute:true});
    service.assistant.provider=new CustomProvider(()=>service.ai.resolve(),transport);
    const task=await service.assistant.chat('Use the current_time tool and report the verified result.');
    while(service.tasks.controllers.has(task.id))await new Promise(resolve=>setTimeout(resolve,10));
    const stored=service.store.get<any>('task',task.id);
    assert.equal(stored.state,'completed');
    assert.equal(requests,2);
    assert.match(service.store.list<any>('message').at(-1)?.text||'',/verified clock result/i);
  }finally{
    await service.app.close();
    rmSync(directory,{recursive:true,force:true});
  }
});
