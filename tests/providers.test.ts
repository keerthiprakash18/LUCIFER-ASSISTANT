import {test} from 'node:test';
import assert from 'node:assert/strict';
import {geminiContents,geminiToolDefinitions,normalizeError,ollamaMessages} from '../server/provider.js';
import type {ProviderTurn} from '../shared/contracts.js';
test('Gemini and Ollama adapters preserve conversation turns and structured tool boundaries',()=>{
 const tools=[{type:'function',name:'current_time',description:'Get time',parameters:{$schema:'ignored',type:'object',properties:{},required:[]},strict:true}];const turns:ProviderTurn[]=[{calls:[{id:'call-1',name:'current_time',arguments:'{}'}],results:[{callId:'call-1',name:'current_time',output:{local:'09:00'}}]}];
 const gemini=geminiContents([{id:'u',role:'user',text:'What time?',createdAt:''},{id:'a',role:'assistant',text:'I will check.',createdAt:''}],turns);assert.equal(gemini[0].role,'user');assert.equal(gemini[1].role,'model');assert.equal(gemini[2].parts[0].functionCall.name,'current_time');assert.equal(gemini[3].parts[0].functionResponse.response.local,'09:00');const declaration=geminiToolDefinitions(tools)![0].functionDeclarations[0];assert.equal(declaration.parametersJsonSchema?.$schema,undefined);const ollama=ollamaMessages([{id:'u',role:'user',text:'What time?',createdAt:''}],turns);assert.equal(ollama[1].tool_calls[0].function.name,'current_time');assert.equal(ollama[2].role,'tool');
});
test('provider quota errors are understandable and never trigger a cross-provider fallback',()=>{const message=normalizeError({status:429,message:'RESOURCE_EXHAUSTED quota'},'Gemini');assert.match(message,/quota|rate limit/i);assert.match(message,/fallback.*disabled/i);});
