import {normalisePlainText} from './formats.js';
export async function extractPdf(input,{signal,password}={}) {
  const source=input instanceof Uint8Array ? input : input instanceof ArrayBuffer ? new Uint8Array(input) : null;
  if(!source || source.length<5 || source.length>2_000_000 || new TextDecoder().decode(source.subarray(0,5))!=='%PDF-') throw new Error('Choose a PDF file smaller than 2 MB.');
  if(signal?.aborted) throw new DOMException('Import cancelled.','AbortError');
  const bytes=new Uint8Array(source);
  const pdfjs=await import('../public/vendor/pdfjs/pdf.mjs');
  if(signal?.aborted) throw new DOMException('Import cancelled.','AbortError');
  pdfjs.GlobalWorkerOptions.workerSrc=new URL('../public/vendor/pdfjs/pdf.worker.mjs',import.meta.url).href;
  const task=pdfjs.getDocument({data:new Uint8Array(bytes),password,isEvalSupported:false,stopAtErrors:true,disableFontFace:true,useSystemFonts:false,useWorkerFetch:false,
    cMapUrl:new URL('../public/vendor/pdfjs/cmaps/',import.meta.url).href,cMapPacked:true,standardFontDataUrl:new URL('../public/vendor/pdfjs/standard_fonts/',import.meta.url).href,wasmUrl:new URL('../public/vendor/pdfjs/wasm/',import.meta.url).href});
  let timedOut=false,cancelled=false;
  const abort=()=>{cancelled=true;void task.destroy();};
  signal?.addEventListener('abort',abort,{once:true});
  const timer=setTimeout(()=>{timedOut=true;void task.destroy();},30000);
  try {
    const pdf=await task.promise;
    if(pdf.numPages>20) throw new Error('Import at most 20 PDF pages at once.');
    const lines=[];
    for(let pageNumber=1;pageNumber<=pdf.numPages;pageNumber++) {
      if(cancelled) throw new DOMException('Import cancelled.','AbortError');
      const page=await pdf.getPage(pageNumber),content=await page.getTextContent();
      let line='';
      for(const item of content.items) {
        if(typeof item.str!=='string')continue;
        line += (line && !line.endsWith(' ') ? ' ' : '')+item.str;
        if(item.hasEOL){lines.push(line);line='';}
      }
      if(line)lines.push(line);
      lines.push('');
      if(lines.join('\n').length>50000) throw new Error('PDF text must contain at most 50,000 characters.');
      page.cleanup();
    }
    if(!lines.join('').trim()) throw new Error('This PDF has no selectable text. Use image text recognition in Import CV, or choose a Word or text file.');
    return normalisePlainText(lines.join('\n'));
  } catch(error) {
    if(timedOut) throw new Error('Reading the PDF took longer than 30 seconds. Choose a smaller document.');
    if(cancelled)throw new DOMException('Import cancelled.','AbortError');
    if(error.name==='PasswordException')throw new Error('This PDF needs a password. Export an unlocked copy before importing.');
    throw error;
  } finally {clearTimeout(timer);signal?.removeEventListener('abort',abort);await task.destroy().catch(()=>{});}
}
