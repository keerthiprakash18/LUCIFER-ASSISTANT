import {Store} from '../server/store.js';
import {config} from '../server/config.js';
const store=new Store(config.dataDir);
try{const task=store.list<any>('task').filter(task=>task.title==='Open https://example.com and tell me what you see.').at(-1);const step=task?.result?.steps?.find((step:any)=>step.tool==='windows_browser_action');console.log(JSON.stringify({state:task?.state,error:task?.error,observation:step?.output},null,2));}finally{store.close();}
