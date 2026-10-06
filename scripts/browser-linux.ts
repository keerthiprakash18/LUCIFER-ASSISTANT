import { mkdir,readdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
if(process.platform!=='linux')throw new Error('This helper is for Ubuntu/WSL only. Windows Chromium needs no Linux packages.');
const directory=path.resolve('.local/browser-libs');await mkdir(directory,{recursive:true});
const run=(executable:string,args:string[])=>new Promise<void>((resolve,reject)=>{const p=spawn(executable,args,{cwd:directory,stdio:'inherit',shell:false});p.once('error',reject);p.once('exit',code=>code===0?resolve():reject(new Error(executable+' failed')));});
await run('apt-get',['download','libnspr4','libnss3','libasound2t64']);
for(const file of await readdir(directory))if(file.endsWith('.deb'))await run('dpkg-deb',['-x',file,directory]);
console.log('Minimal Chromium libraries extracted inside .local/browser-libs. No system packages installed.');
