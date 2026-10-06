// Narrow Windows loopback bridge for Ollama when the LUCIFER backend runs in WSL.
// stdin/stdout only; no credentials or URLs are placed on argv.
const {readFileSync}=require('node:fs');

async function main(){
  const input=JSON.parse(readFileSync(0,'utf8'));
  const url=new URL(input.url);
  const allowedHost=['localhost','127.0.0.1','[::1]'].includes(url.hostname);
  const allowedPath=['/api/tags','/api/chat'].includes(url.pathname);
  if(!allowedHost||url.protocol!=='http:'||String(url.port||'80')!=='11434'||!allowedPath||url.username||url.password||url.search||url.hash)throw new Error('blocked');
  const method=input.method==='POST'?'POST':'GET';
  const response=await fetch(url,{
    method,
    headers:{'Content-Type':'application/json'},
    body:method==='POST'&&typeof input.body==='string'?input.body:undefined,
    signal:AbortSignal.timeout(70000),
    redirect:'error'
  });
  const body=await response.text();
  if(body.length>2_000_000)throw new Error('response too large');
  process.stdout.write(JSON.stringify({status:response.status,contentType:response.headers.get('content-type')||'application/json',body}));
}
main().catch(()=>{process.stdout.write(JSON.stringify({status:502,contentType:'application/json',body:'{"error":"Windows Ollama bridge failed or timed out"}'}));process.exitCode=1;});
