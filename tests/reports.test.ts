import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import path from 'node:path';
import {createApp} from '../server/app.js';
import type {Report} from '../server/reports.js';
test('English and Tamil PDF generation, actual PDF raster previews, six ideas and explicit visual-review status',{timeout:120000},async()=>{
 mkdirSync('.local/verification',{recursive:true});const {app,files,reports,store,tasks}=await createApp(path.resolve('.local/verification'));
 const text='post_id,date,format,theme,caption,reach,views,impressions,likes,comments,shares,saves\nfixture-1,2026-09-10,reel,Practical learning,Test fixture only,1000,2100,,90,12,7,35\nfixture-2,2026-09-20,photo,Process,Test fixture only,700,950,,20,5,3,8';
 const file=await files.save('SYNTHETIC-TEST-ONLY.csv','text/csv',Buffer.from(text),text);
 for(const language of ['en','ta'] as const){const task=tasks.create('PDF fixture verification');const result=await reports.generate({fileId:file.id,account:'@synthetic_test_only',brand:language==='ta'?'சோதனை பிராண்ட்':'SYNTHETIC TEST BRAND',start:'2026-09-01',end:'2026-09-30',timezone:'Asia/Kolkata',logoId:null,language},task.id,new AbortController().signal);const r=store.get<Report>('report',result.reportId)!;assert.equal(r.ideas.length,6);assert.equal(r.pages,9);assert.equal(r.status,'awaiting_visual_review');assert.equal(r.analysis.metrics.reach.total,1700);const rendered=store.get<any>('file',r.fileId);assert.match(rendered.text.replace(/\s/g,''),language==='ta'?/பரிந்து/:/VIDEOIDEA/);writeFileSync(path.resolve(`.local/verification/${language}-contact.png`),readFileSync(path.join(files.directory,`${r.fileId}-contact.png`)));writeFileSync(path.resolve(`.local/verification/${language}-idea.png`),readFileSync(path.join(files.directory,`${r.fileId}-page-3.png`)));writeFileSync(path.resolve(`.local/verification/${language}-report.pdf`),await files.read(r.fileId));}
 await app.close();
});
