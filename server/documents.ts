import {z} from 'zod';
import {parse} from 'csv-parse/sync';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {chromium} from 'playwright';
import type {FastifyInstance} from 'fastify';
import type {Assistant} from './assistant.js';
import type {Files} from './files.js';
import type {StoredFile} from '../shared/contracts.js';
import {extractPDF} from './files.js';
import {redact} from './auth.js';
const inputSchema=z.object({name:z.string().min(1).max(100),format:z.enum(['txt','md','pdf']),text:z.string().min(1).max(20000)}).strict();
const escape=(value:string)=>value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const compact=(value:string)=>value.normalize('NFC').replace(/\s+/g,'');
export function analyzeTable(text:string){
 const rows=parse(text,{columns:true,bom:true,skip_empty_lines:true,relax_column_count:false,max_record_size:20000}) as Record<string,string>[];
 if(!rows.length||rows.length>10000)throw new Error('CSV needs 1–10,000 supplied data rows');
 const names=Object.keys(rows[0]);if(names.length>80)throw new Error('CSV exceeds 80 columns');
 return {rows:rows.length,columns:names.map(name=>{
  const values=rows.map(row=>row[name]?.trim()||''),present=values.filter(Boolean),numbers=present.filter(value=>/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(value)).map(Number).filter(Number.isFinite);
  const numeric=present.length>0&&numbers.length===present.length;
  return {name,missing:values.length-present.length,numeric,...(numeric?{sum:numbers.reduce((a,b)=>a+b,0),minimum:Math.min(...numbers),maximum:Math.max(...numbers),mean:numbers.reduce((a,b)=>a+b,0)/numbers.length}:{distinct:new Set(present).size})};
 }),sample:rows.slice(0,8),source:'Statistics calculated only from the supplied CSV; no external or invented metrics'};
}
export function registerDocuments(app:FastifyInstance,assistant:Assistant,files:Files){
 const create=async(input:z.infer<typeof inputSchema>,taskId:string,signal:AbortSignal)=>{
  files.enabled();if(!assistant.settings().permissions.reports&&input.format==='pdf')throw new Error('Report permission disabled');
  if(input.text!==redact(input.text))throw new Error('Credentials cannot be generated into documents');
  signal.throwIfAborted();assistant.tasks.event(taskId,'Creating '+input.format+' document from supplied contents.');
  let bytes:Buffer=Buffer.from(input.text),text=input.text;const name=input.name.replace(/\.(txt|md|pdf)$/i,'')+'.'+input.format;
  if(input.format==='pdf'){
   const latin=(await readFile(path.resolve('node_modules/@fontsource/inter/files/inter-latin-400-normal.woff2'))).toString('base64');
   const tamil=(await readFile(path.resolve('node_modules/@fontsource/noto-sans-tamil/files/noto-sans-tamil-tamil-400-normal.woff2'))).toString('base64');
   const browser=await chromium.launch({headless:true}),abort=()=>{void browser.close().catch(()=>{});};signal.addEventListener('abort',abort,{once:true});
   try{
    const page=await browser.newPage();await page.route('**/*',route=>route.abort());
    await page.setContent(`<html><head><meta charset="utf-8"><style>@font-face{font-family:Inter;src:url(data:font/woff2;base64,${latin})}@font-face{font-family:Tamil;src:url(data:font/woff2;base64,${tamil})}@page{size:A4;margin:18mm}body{font:12px/1.7 Inter,Tamil,sans-serif;color:#282833;overflow-wrap:anywhere}h1{color:#a82448;font-size:24px;font-weight:400}pre{white-space:pre-wrap;font:inherit}p{font-size:10px}</style></head><body><h1>${escape(input.name)}</h1><p>LUCIFER · Local document · ${new Date().toISOString()}</p><pre>${escape(input.text)}</pre></body></html>`);
    await page.evaluate(()=>document.fonts.ready);signal.throwIfAborted();bytes=await page.pdf({format:'A4',printBackground:true});text=await extractPDF(bytes);
    // PDF extraction can insert spaces between positioned glyphs. Check the
    // logical heading and supplied content independently of those line breaks.
    if(!compact(text).includes(compact(input.name))||!compact(text).includes(compact(input.text)))throw new Error('PDF extracted-text verification failed');
   }finally{signal.removeEventListener('abort',abort);await browser.close();}
  }
  signal.throwIfAborted();files.enabled();const file=await files.save(name,input.format==='pdf'?'application/pdf':input.format==='md'?'text/markdown':'text/plain',bytes,text,true);
  if(!(await files.read(file.id)).equals(bytes))throw new Error('Saved document verification failed');
  return {fileId:file.id,name:file.name,download:'/api/files/'+file.id+'/download',bytes:file.bytes,verified:true};
 };
 const analyze=async({fileId,reportFormat,name}:{fileId:string;reportFormat?:'txt'|'pdf';name?:string},taskId:string,signal:AbortSignal)=>{
  files.enabled();const file=assistant.store.get<StoredFile>('file',fileId);if(file?.type!=='text/csv'||!file.text)throw new Error('Choose a supplied CSV');
  const analysis=analyzeTable(file.text);signal.throwIfAborted();if(!reportFormat)return {analysis};
  const content='Source: '+file.name+'\nRows: '+analysis.rows+'\n\n'+analysis.columns.map(column=>column.name+': '+JSON.stringify(column)).join('\n')+'\n\n'+analysis.source;
  const document=await create({name:name||'CSV analysis',format:reportFormat,text:content},taskId,signal);return {analysis,...document};
 };
 app.post('/api/documents',async req=>{const input=inputSchema.parse(req.body);return assistant.tasks.run('Create document · '+input.name,(task,signal)=>create(input,task.id,signal));});
 const csvSchema=z.object({fileId:z.uuid(),reportFormat:z.enum(['txt','pdf']).optional(),name:z.string().min(1).max(100).optional()}).strict();
 app.post('/api/csv-analysis',async req=>{const input=csvSchema.parse(req.body);return assistant.tasks.run('Analyze supplied CSV',(task,signal)=>analyze(input,task.id,signal));});
 assistant.tools.push({name:'create_document',description:'Create a new downloadable UTF-8 text/Markdown or English/Tamil PDF document from explicitly requested content. Does not overwrite existing files or send it.',schema:inputSchema,permission:'files',run:(input,ctx)=>create(input,ctx.taskId,ctx.signal)},
 {name:'analyze_csv',description:'Calculate real row/column/missing/numeric statistics from an attached general CSV. Optionally create a downloadable text or PDF report. No Instagram account/date fields required; no invented metrics.',schema:csvSchema,permission:'files',run:(input,ctx)=>{if(!ctx.fileIds.includes(input.fileId))throw new Error('CSV must be attached or explicitly referred to in this conversation');return analyze(input,ctx.taskId,ctx.signal);}});
}
