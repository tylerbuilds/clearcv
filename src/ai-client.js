export async function getAiStatus() {
  if (globalThis.location?.hostname?.endsWith('.github.io')) return {enabled:false};
  try {
    const response=await fetch('./api/ai/status',{cache:'no-store',signal:AbortSignal.timeout(5000)});
    if(!response.ok) return {enabled:false};
    const status=await response.json();
    return {enabled:status.enabled===true,...(typeof status.model==='string' ? {model:status.model} : {})};
  } catch { return {enabled:false}; }
}
export async function generateWriting(request, {signal}={}) {
  const response=await fetch('./api/ai',{
    method:'POST',headers:{'Content-Type':'application/json','X-Local-Workspace':'1'},body:JSON.stringify(request),signal:signal ? AbortSignal.any([signal,AbortSignal.timeout(100000)]) : AbortSignal.timeout(100000)
  });
  let result;
  try { result=await response.json(); } catch { throw new Error('The AI service didn’t respond. Check your server connection and try again. Your CV hasn’t changed.'); }
  if(!response.ok || typeof result.text!=='string') throw new Error(result.error || 'The AI service didn’t return text we could use. Try again. Your CV hasn’t changed.');
  return {text:result.text,model:result.model};
}
