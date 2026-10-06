import { createApp } from './app.js';
import { config } from './config.js';
const {app}=await createApp();
await app.listen({port:config.port,host:config.host});
console.log(`LUCIFER API listening on ${config.host}:${config.port}`);
for(const signal of ['SIGINT','SIGTERM'] as const)process.on(signal,()=>{void app.close().then(()=>process.exit(0));});
