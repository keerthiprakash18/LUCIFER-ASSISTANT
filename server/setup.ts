import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';
import { Store } from './store.js';
import { config } from './config.js';
import { setOwner } from './auth.js';
let hidden=false;
const output=new Writable({write(chunk,_enc,cb){if(!hidden)process.stdout.write(chunk);cb();}});
const rl=createInterface({input:process.stdin,output,terminal:true});
const ask=(label:string)=>new Promise<string>(resolve=>{process.stdout.write(label);hidden=true;rl.question('',v=>{hidden=false;process.stdout.write('\n');resolve(v);});});
try { const a=await ask('Owner password (12+ characters, hidden): '); const b=await ask('Confirm password: ');if(a!==b)throw new Error('Passwords differ');const store=new Store(config.dataDir);setOwner(store,a);store.close();console.log('Owner configured. Start LUCIFER and sign in.'); } catch(e) {console.error((e as Error).message);process.exitCode=1;} finally {rl.close();}
