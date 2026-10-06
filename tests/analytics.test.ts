import {test} from 'node:test';
import assert from 'node:assert/strict';
import {analyzeCSV,sixIdeas,reportInputSchema} from '../server/analytics.js';
const input={fileId:'00000000-0000-4000-8000-000000000001',account:'@test-only',brand:'Test brand',start:'2026-09-01',end:'2026-09-30',timezone:'Asia/Kolkata',logoId:null,language:'en' as const};
test('actual supplied metrics, coverage, exact six briefs, missing and zero denominators',()=>{
 const csv='post_id,date,format,theme,reach,views,likes,comments,shares,saves\np1,2026-09-10,reel,Learning,100,200,10,2,3,5\np2,2026-09-11,photo,Process,0,20,0,0,0,0\np3,2026-08-10,reel,Old,99,100,10,1,1,1';
 const a=analyzeCSV(csv,input,'test fixture only');assert.equal(a.posts.length,2);assert.equal(a.metrics.reach.total,100);assert.equal(a.interactionRate,20);assert.equal(a.strong?.id,'p1');assert.equal(a.weak?.id,'p2');const ideas=sixIdeas(a,'en');assert.equal(ideas.length,6);assert.ok(ideas.every(i=>i.reason.includes('p1')&&i.title.includes('Learning')&&i.scenes.length===4));
 const b=analyzeCSV('post_id,date,format,theme,reach,likes\np1,2026-09-10,reel,Learning,0,0',input,'test');assert.equal(b.interactionRate,null);assert.equal(b.metrics.saves.total,null);assert.equal(b.metrics.saves.coverage,0);
 assert.throws(()=>analyzeCSV(csv.replace('100,200','bad,200'),input,'test'));assert.throws(()=>reportInputSchema.parse({...input,start:'2026-02-31'}));assert.throws(()=>analyzeCSV('post_id,date,format,theme,__proto__\nx,2026-09-10,reel,theme,evil',input,'test'));
});
