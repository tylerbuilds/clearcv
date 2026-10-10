import {normalisePlainText} from './formats.js';

export const OCR_LIMITS=Object.freeze({bytes:10*1024*1024,pages:20,sourcePixels:32_000_000,renderPixels:4_000_000,text:50_000,timeoutMs:120_000});
const cancelled=()=>new DOMException('Document reading cancelled.','AbortError');
const ensureActive=signal=>{if(signal?.aborted)throw cancelled();};
export function detectOcrType(input) {
  const b=input instanceof Uint8Array?input:new Uint8Array(input);
  if(!b.length||b.length>OCR_LIMITS.bytes)throw new Error('Choose a document or image smaller than 10 MiB.');
  if(new TextDecoder().decode(b.subarray(0,5))==='%PDF-')return 'pdf';
  if(b[0]===137&&b[1]===80&&b[2]===78&&b[3]===71)return 'image/png';
  if(b[0]===255&&b[1]===216&&b[2]===255)return 'image/jpeg';
  if(new TextDecoder().decode(b.subarray(0,4))==='RIFF'&&new TextDecoder().decode(b.subarray(8,12))==='WEBP')return 'image/webp';
  if(b[0]===66&&b[1]===77)return 'image/bmp';
  throw new Error('For image text recognition, choose PNG, JPEG, WebP, BMP or a PDF.');
}
export function boundedOcrSize(width,height) {
  if(!Number.isFinite(width)||!Number.isFinite(height)||width<1||height<1||width*height>OCR_LIMITS.sourcePixels)throw new Error('This page image is too large. Use an image below 32 megapixels.');
  const scale=Math.min(1,Math.sqrt(OCR_LIMITS.renderPixels/(width*height)));
  return {width:Math.max(1,Math.floor(width*scale)),height:Math.max(1,Math.floor(height*scale)),scale};
}

// Reject oversized dimensions advertised by ordinary raster headers before a
// decoder allocates the surface. The decoder still validates the complete file.
export function checkDeclaredRasterSize(bytes,type) {
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let dimensions;
  if(type==='image/png'&&bytes.length>=24&&new TextDecoder().decode(bytes.subarray(12,16))==='IHDR')dimensions=[view.getUint32(16),view.getUint32(20)];
  if(type==='image/bmp'&&bytes.length>=26)dimensions=view.getUint32(14,true)===12?[view.getUint16(18,true),view.getUint16(20,true)]:[view.getInt32(18,true),Math.abs(view.getInt32(22,true))];
  if(type==='image/jpeg')for(let p=2;p+3<bytes.length;){
    if(bytes[p++]!==255)break;while(bytes[p]===255)p++;
    const marker=bytes[p++];if(marker===0xd9||marker===0xda)break;
    if(marker===0x01||(marker>=0xd0&&marker<=0xd8))continue;
    if(p+2>bytes.length)break;const length=view.getUint16(p);if(length<2||p+length>bytes.length)break;
    if([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)&&length>=7){dimensions=[view.getUint16(p+5),view.getUint16(p+3)];break;}p+=length;
  }
  if(type==='image/webp')for(let p=12;p+8<=bytes.length;){
    const kind=new TextDecoder().decode(bytes.subarray(p,p+4)),length=view.getUint32(p+4,true),data=p+8;
    if(data+length>bytes.length)break;
    if(kind==='VP8X'&&length>=10){const uint24=i=>bytes[i]+bytes[i+1]*256+bytes[i+2]*65536;dimensions=[uint24(data+4)+1,uint24(data+7)+1];break;}
    if(kind==='VP8L'&&length>=5&&bytes[data]===0x2f){const bits=view.getUint32(data+1,true);dimensions=[(bits&0x3fff)+1,((bits>>>14)&0x3fff)+1];break;}
    if(kind==='VP8 '&&length>=10&&bytes[data+3]===0x9d&&bytes[data+4]===1&&bytes[data+5]===0x2a){dimensions=[view.getUint16(data+6,true)&0x3fff,view.getUint16(data+8,true)&0x3fff];break;}
    p=data+length+(length&1);
  }
  if(dimensions)boundedOcrSize(...dimensions);
}

// Use the pinned v7 worker's own protocol so cancellation can terminate it even
// while the engine/language is loading. createWorker resolves after that loading.
function recogniser(signal,onProgress) {
  ensureActive(signal);
  const worker=new Worker(new URL('../public/vendor/ocr/worker.min.js',import.meta.url));
  const pending=new Map();let serial=0,closed=false;
  const close=(error=cancelled())=>{
    if(closed)return;closed=true;worker.terminate();
    signal?.removeEventListener('abort',abort);
    for(const {reject} of pending.values())reject(error);pending.clear();
  };
  const abort=()=>close();signal?.addEventListener('abort',abort,{once:true});
  worker.addEventListener('error',()=>close(new Error('The local text-recognition worker could not start. Reload and try again.')));
  worker.addEventListener('message',({data})=>{
    if(closed||!data||data.workerId!=='clearcv-ocr')return;
    if(data.status==='progress'){onProgress?.({status:typeof data.data?.status==='string'?data.data.status:'Reading text',progress:Math.max(0,Math.min(1,Number(data.data?.progress)||0))});return;}
    const key=`${data.action}:${data.jobId}`,job=pending.get(key);if(!job)return;
    pending.delete(key);
    if(data.status==='resolve')job.resolve(data.data);
    else job.reject(new Error('Text recognition could not read this page. Try a clearer image.'));
  });
  const send=(action,payload)=>new Promise((resolve,reject)=>{
    if(closed){reject(cancelled());return;}
    const jobId=String(++serial);pending.set(`${action}:${jobId}`,{resolve,reject});
    try{worker.postMessage({workerId:'clearcv-ocr',jobId,action,payload});}catch(error){pending.delete(`${action}:${jobId}`);reject(error);}
  });
  const ready=async()=>{
    await send('load',{options:{lstmOnly:true,corePath:new URL('../public/vendor/ocr/core/',import.meta.url).href,logging:false}});
    await send('loadLanguage',{langs:'eng',options:{langPath:new URL('../public/vendor/ocr/lang/',import.meta.url).href,cacheMethod:'none',gzip:true,lstmOnly:true}});
    await send('initialize',{langs:'eng',oem:1,config:{preserve_interword_spaces:'1'}});
  };
  return {ready,close,recognise:async bytes=>{
    const result=await send('recognize',{image:bytes,options:{},output:{text:true}});
    return {text:typeof result?.text==='string'?result.text:'',confidence:Number(result?.confidence)||0};
  }};
}

async function canvasBytes(canvas) {
  const blob=await new Promise((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(new Error('Unable to read this image.')),'image/png'));
  return new Uint8Array(await blob.arrayBuffer());
}
function makeCanvas(width,height) {
  const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
  const context=canvas.getContext('2d',{willReadFrequently:true});if(!context)throw new Error('Your browser cannot read images on a canvas.');
  context.fillStyle='#ffffff';context.fillRect(0,0,width,height);return {canvas,context};
}

export async function extractOcr(input,{signal,password,onProgress,forceOcr=false}={}) {
  ensureActive(signal);
  const bytes=input instanceof Uint8Array?input:new Uint8Array(input),type=detectOcrType(bytes);
  const controller=new AbortController();let timedOut=false,engine,pdfTask,renderTask;
  const abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});
  const timer=setTimeout(()=>{timedOut=true;controller.abort();},OCR_LIMITS.timeoutMs);
  const stop=()=>{renderTask?.cancel();void pdfTask?.destroy();};controller.signal.addEventListener('abort',stop,{once:true});
  const warnings=['Image recognition reads English. Check names, numbers and dates against your original.'];
  let imagePages=0;const texts=[];
  const recognise=async image=>{
    ensureActive(controller.signal);
    if(!engine){engine=recogniser(controller.signal,onProgress);await engine.ready();}
    const result=await engine.recognise(image);imagePages++;
    if(result.confidence<65)warnings.push(`Some text on page ${texts.length+1} may have been misread. Compare it with your original.`);
    return result.text;
  };
  try {
    if(type==='pdf'){
      const pdfjs=await import('../public/vendor/pdfjs/pdf.mjs');ensureActive(controller.signal);
      pdfjs.GlobalWorkerOptions.workerSrc=new URL('../public/vendor/pdfjs/pdf.worker.mjs',import.meta.url).href;
      pdfTask=pdfjs.getDocument({data:new Uint8Array(bytes),password,isEvalSupported:false,stopAtErrors:true,disableFontFace:true,useSystemFonts:false,useWorkerFetch:false,maxImageSize:OCR_LIMITS.sourcePixels,canvasMaxAreaInBytes:OCR_LIMITS.renderPixels*4,cMapUrl:new URL('../public/vendor/pdfjs/cmaps/',import.meta.url).href,cMapPacked:true,standardFontDataUrl:new URL('../public/vendor/pdfjs/standard_fonts/',import.meta.url).href,wasmUrl:new URL('../public/vendor/pdfjs/wasm/',import.meta.url).href});
      const pdf=await pdfTask.promise;
      if(pdf.numPages>OCR_LIMITS.pages)throw new Error('Read at most 20 PDF pages at once.');
      for(let number=1;number<=pdf.numPages;number++){
        ensureActive(controller.signal);onProgress?.({status:`Reading page ${number} of ${pdf.numPages}`,progress:(number-1)/pdf.numPages});
        const page=await pdf.getPage(number),content=await page.getTextContent();
        let text='',line='';for(const item of content.items){if(typeof item.str!=='string')continue;line+=(line&&!line.endsWith(' ')?' ':'')+item.str;if(item.hasEOL){text+=line+'\n';line='';}}text+=line;
        const operations=await page.getOperatorList(),hasImages=operations.fnArray.some(op=>[pdfjs.OPS.paintImageXObject,pdfjs.OPS.paintInlineImageXObject,pdfjs.OPS.paintImageXObjectRepeat,pdfjs.OPS.paintImageMaskXObject].includes(op));
        if(forceOcr||!text.trim()||(hasImages&&text.trim().length<200)){
          const base=page.getViewport({scale:2}),size=boundedOcrSize(base.width,base.height),viewport=page.getViewport({scale:2*size.scale});
          const {canvas,context}=makeCanvas(size.width,size.height);
          try{renderTask=page.render({canvasContext:context,canvas,viewport});await renderTask.promise;renderTask=undefined;text=await recognise(await canvasBytes(canvas));}
          finally{canvas.width=0;canvas.height=0;renderTask=undefined;}
        }
        texts.push(text);page.cleanup();
        if(texts.join('\n\n').length>OCR_LIMITS.text)throw new Error('The extracted text exceeds 50,000 characters. Read a shorter document.');
      }
    }else{
      checkDeclaredRasterSize(bytes,type);
      const bitmap=await createImageBitmap(new Blob([bytes],{type}));
      let canvas;
      try{ensureActive(controller.signal);const size=boundedOcrSize(bitmap.width,bitmap.height),made=makeCanvas(size.width,size.height);canvas=made.canvas;made.context.drawImage(bitmap,0,0,size.width,size.height);texts.push(await recognise(await canvasBytes(canvas)));}
      finally{bitmap.close();if(canvas){canvas.width=0;canvas.height=0;}}
    }
    ensureActive(controller.signal);const text=normalisePlainText(texts.join('\n\n'));
    if(!text.trim())throw new Error('No readable text was found. Try a sharper image or a document with selectable text.');
    if(text.length>OCR_LIMITS.text)throw new Error('The extracted text exceeds 50,000 characters. Read a shorter document.');
    if(!imagePages)warnings.length=0;
    onProgress?.({status:'Text ready to check',progress:1});return {text,warnings,imagePages};
  }catch(error){
    if(timedOut)throw new Error('Reading took longer than two minutes. Try a smaller or clearer document.');
    if(controller.signal.aborted)throw cancelled();
    if(error.name==='PasswordException')throw new Error('This PDF needs a correct password. Enter it and try again.');
    throw error;
  }finally{
    clearTimeout(timer);signal?.removeEventListener('abort',abort);controller.signal.removeEventListener('abort',stop);engine?.close();
    renderTask?.cancel();await pdfTask?.destroy().catch(()=>{});
  }
}
