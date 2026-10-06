export class APIError extends Error {
  constructor(message: string, public status?: number) { super(message); }
}
type RequestOptions = { signal?: AbortSignal; timeoutMs?: number };

export async function api<T=any>(url:string,method='GET',body?:unknown,options:RequestOptions={}):Promise<T> {
  const timeout=new AbortController();
  const timer=setTimeout(()=>timeout.abort(),options.timeoutMs ?? 30000);
  const signal=options.signal ? AbortSignal.any([options.signal,timeout.signal]) : timeout.signal;
  try {
    const response=await fetch('/api'+url,{method,headers:body===undefined||body instanceof FormData?{'X-Lucifer-Request':'1'}:{'Content-Type':'application/json','X-Lucifer-Request':'1'},body:body===undefined?undefined:body instanceof FormData?body:JSON.stringify(body),signal});
    // An HTML proxy error or a broken JSON response must never become application state.
    let data: any;
    try { data=await response.json(); }
    catch(error) {
      if(signal.aborted)throw error;
      throw new APIError('LUCIFER returned an unreadable response. Retry the request; your form is still available.',response.status);
    }
    if(!response.ok)throw new APIError(typeof data?.error==='string' ? data.error : `LUCIFER request failed (${response.status}).`,response.status);
    return data as T;
  } catch(error) {
    if(options.signal?.aborted)throw new APIError('Request cancelled.');
    if(timeout.signal.aborted)throw new APIError('Request timed out. Check that the LUCIFER server is running, then try again.');
    if(error instanceof TypeError)throw new APIError('Unable to reach the LUCIFER server. Retry when it is available.');
    throw error;
  } finally { clearTimeout(timer); }
}
