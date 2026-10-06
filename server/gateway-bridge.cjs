// Fixed local gateway transport. Credentials travel through stdin, never argv.
const {readFileSync}=require('node:fs');
async function main(){
 const input=JSON.parse(readFileSync(0,'utf8')),url=new URL(input.url);
 if(!['localhost','127.0.0.1','[::1]'].includes(url.hostname)||!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash||!/(?:\/models|\/chat\/completions)$/.test(url.pathname))throw new Error();
 const response=await fetch(url,{method:input.body?'POST':'GET',headers:{'Content-Type':'application/json',...(input.apiKey?{Authorization:'Bearer '+input.apiKey}: {})},body:input.body?JSON.stringify(input.body):undefined,signal:AbortSignal.timeout(45000),redirect:'error'});
 if(!response.ok){process.stdout.write(JSON.stringify({status:response.status,data:{error:'Gateway request rejected'}}));return;}
 const value=await response.json();
 const data=url.pathname.endsWith('/models')?{data:(value.data||[]).slice(0,200).map(model=>({id:model.id,owned_by:model.owned_by,free:model.free===true,tools:model.supports_tools===true}))}:{model:value.model,choices:(value.choices||[]).slice(0,1).map(choice=>({finish_reason:choice.finish_reason,message:{content:choice.message?.content,tool_calls:choice.message?.tool_calls}})),usage:value.usage};
 process.stdout.write(JSON.stringify({status:response.status,data}));
}
main().catch(()=>{process.stdout.write(JSON.stringify({status:502,data:{error:'Windows gateway transport failed or timed out'}}));process.exitCode=1;});
