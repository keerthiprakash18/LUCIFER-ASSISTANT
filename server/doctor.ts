import {existsSync,readFileSync} from 'node:fs';
import path from 'node:path';
import {config} from './config.js';
import {Store} from './store.js';
import {AIConfigService} from './ai-config.js';
let owner=false;
let aiStatus:any={status:'awaiting_configuration',configured:false,verified:false};
if(existsSync(path.join(config.dataDir,'lucifer.db'))){const store=new Store(config.dataDir);owner=!!store.get('owner','owner');aiStatus=await new AIConfigService(store,config.dataDir).status();store.close();}
const {chromium}=await import('playwright');
let nativeVoice:any={installed:existsSync(path.join(config.dataDir,'native/LUCIFER.exe')),state:'Offline'};
try{const status=JSON.parse(readFileSync(path.join(config.dataDir,'native/status.json'),'utf8'));if(Date.now()-Date.parse(status.updatedAt)<5000)nativeVoice={...nativeVoice,state:status.state,microphone:status.microphone,modelReady:status.modelReady,connected:status.connected,startupEnabled:status.startup,pauseShortcut:status.pauseShortcut,stopHotkeyRegistered:status.stopHotkey};}catch{}
console.log(JSON.stringify({product:'LUCIFER',node:process.version,platform:process.platform,ownerConfigured:owner,productionBuild:existsSync(path.resolve('dist/index.html')),model:{provider:aiStatus.provider||config.provider,protocol:aiStatus.protocol||'responses',status:aiStatus.status,configured:!!aiStatus.configured,verified:!!aiStatus.verified,credentialSource:aiStatus.credentialSource||'none',liveCallVerified:aiStatus.status==='connected'},telegram:{tokenConfigured:!!config.telegramToken,liveDeliveryVerified:false},chromiumInstalled:existsSync(chromium.executablePath()),windowsCompanionConfig:existsSync(path.resolve('companion/config.json')),nativeVoice,dataLocation:path.relative(config.root,config.dataDir),notes:['Configuration checks only; this command does not use paid APIs, record audio, send Telegram messages, or launch applications.']},null,2));
