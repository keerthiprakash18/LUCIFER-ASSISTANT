export type VoiceState='idle'|'listening'|'transcribing'|'speaking'|'failed';
export type PermissionState='granted'|'denied'|'prompt'|'unknown';
export interface VoiceDiagnostics { supported:boolean; secureContext:boolean; microphone:PermissionState; browserService:'available'|'unavailable'|'unknown'; language:string; note:string }
export interface SpeechProvider { supported:boolean; diagnostics(language:string):Promise<VoiceDiagnostics>; listen(language:string,onText:(text:string,final:boolean)=>void,onState:(state:VoiceState,error?:string)=>void):void; stop():void; speak(text:string,language:string,onState:(state:VoiceState,error?:string)=>void):void }

function recognitionConstructor(){return typeof window==='undefined'?undefined:(window as any).SpeechRecognition||(window as any).webkitSpeechRecognition;}
export function browserSpeechLanguage(setting:'auto'|'en-IN'|'ta-IN') {
  if(setting!=='auto')return setting;
  return typeof navigator!=='undefined'&&/^ta(?:-|$)/i.test(navigator.language)?'ta-IN':'en-IN';
}
export class BrowserSpeech implements SpeechProvider {
  recognition:any;
  utterance:SpeechSynthesisUtterance|undefined;
  timer:ReturnType<typeof setTimeout>|undefined;
  supported=!!recognitionConstructor();
  async diagnostics(language:string):Promise<VoiceDiagnostics>{
    const secure=typeof window!=='undefined'&&(window.isSecureContext||['localhost','127.0.0.1','[::1]'].includes(location.hostname));
    let microphone:PermissionState='unknown';
    try{const result=await navigator.permissions?.query({name:'microphone' as PermissionName});microphone=(result?.state as PermissionState)||'unknown';}catch{microphone='unknown';}
    const supported=this.supported&&secure;
    return {supported,secureContext:secure,microphone,browserService:this.supported?'unknown':'unavailable',language,note:!this.supported?'This browser does not expose SpeechRecognition. Use Chrome or Edge, or type your request.':!secure?'Microphone recognition requires HTTPS or localhost.':microphone==='denied'?'Microphone permission is denied for this site. Enable it in browser settings, then start a new turn.':'The browser manages the recognition service. A network error here is separate from LUCIFER AI connectivity.'};
  }
  listen(language:string,onText:(text:string,final:boolean)=>void,onState:(state:VoiceState,error?:string)=>void){
    this.stop();const Recognition=recognitionConstructor();if(!Recognition){onState('failed','Browser speech recognition is unavailable. Type your request instead.');return;}
    const secure=window.isSecureContext||['localhost','127.0.0.1','[::1]'].includes(location.hostname);if(!secure){onState('failed','Microphone recognition requires HTTPS or localhost. Type your request instead.');return;}
    const r=this.recognition=new Recognition();r.lang=language;r.continuous=false;r.interimResults=true;r.maxAlternatives=1;
    let finished=false;
    r.onstart=()=>onState('listening');
    r.onresult=(event:any)=>{if(finished)return;let final='',partial='';for(let i=0;i<event.results.length;i++){if(event.results[i].isFinal)final+=event.results[i][0].transcript;else partial+=event.results[i][0].transcript;}onState('transcribing');if(final)finished=true;onText(final||partial,!!final);};
    r.onerror=(event:any)=>{finished=true;const error=event?.error;const message=({
      'not-allowed':'Microphone permission was denied. Enable it for this site and start a new turn.',
      'service-not-allowed':'This browser or device does not allow its speech service. Type your request instead.',
      'no-speech':'No clear speech was detected. No instruction was executed; try push-to-talk again.',
      'audio-capture':'No usable microphone was found. Check the selected audio device, then start a new turn.',
      network:'The browser speech service could not reach its network service. This is separate from LUCIFER AI connectivity; type your request or retry after checking the browser network.',
      aborted:'Listening was stopped before a final transcript. No instruction was executed.'
    } as Record<string,string>)[error]||`Browser speech recognition stopped (${error||'unknown error'}). Type your request instead.`;onState('failed',message);};
    r.onend=()=>{clearTimeout(this.timer);this.recognition=undefined;if(!finished)onState('idle');};
    this.timer=setTimeout(()=>{if(!finished){finished=true;r.onresult=null;r.abort();onState('failed','Listening timed out. No instruction was executed.');}},20000);
    try{r.start();}catch(error){finished=true;onState('failed',error instanceof DOMException&&error.name==='InvalidStateError'?'The microphone session is already active. Press Stop, then start a new turn.':'Unable to start the microphone. Check permission and browser audio settings.');}
  }
  stop(){clearTimeout(this.timer);if(this.recognition){this.recognition.onresult=null;this.recognition.onend=null;this.recognition.onerror=null;this.recognition.onstart=null;try{this.recognition.abort();}catch{}this.recognition=undefined;}if(this.utterance){this.utterance.onend=null;this.utterance.onerror=null;this.utterance.onstart=null;this.utterance=undefined;}window.speechSynthesis?.cancel();}
  speak(text:string,language:string,onState:(state:VoiceState,error?:string)=>void){this.stop();if(!window.speechSynthesis){onState('failed','Speech synthesis is unavailable. The reply remains visible.');return;}const voices=speechSynthesis.getVoices();const tamil=language.startsWith('ta');const voice=voices.find(v=>v.lang.toLowerCase().startsWith(tamil?'ta':'en'));if(tamil&&!voice){onState('failed','A Tamil voice is not installed on this device. The Tamil reply remains visible.');return;}const utterance=this.utterance=new SpeechSynthesisUtterance(text);utterance.lang=language;if(voice)utterance.voice=voice;utterance.onstart=()=>onState('speaking');utterance.onend=()=>{this.utterance=undefined;onState('idle');};utterance.onerror=()=>onState('failed','Speech was interrupted or audio output is unavailable.');speechSynthesis.speak(utterance);}
}
