import test from 'node:test';
import assert from 'node:assert/strict';
import {OCR_LIMITS,detectOcrType,boundedOcrSize,checkDeclaredRasterSize,extractOcr} from '../src/ocr-import.js';

test('OCR identifies actual signatures and rejects labelled arbitrary files',()=>{
  assert.equal(detectOcrType(new TextEncoder().encode('%PDF-1.7 document')),'pdf');
  assert.equal(detectOcrType(Uint8Array.from([137,80,78,71,13,10,26,10])),'image/png');
  assert.equal(detectOcrType(Uint8Array.from([255,216,255,224])),'image/jpeg');
  assert.equal(detectOcrType(new TextEncoder().encode('RIFF0000WEBP')),'image/webp');
  assert.throws(()=>detectOcrType(new TextEncoder().encode('<script>bad.pdf</script>')),/choose PNG/);
  assert.throws(()=>detectOcrType(new Uint8Array(OCR_LIMITS.bytes+1)),/10 MiB/);
});
test('wide and tall source pages keep their aspect ratio and bounded decoded surface',()=>{
  for(const [w,h] of [[16000,2000],[2000,16000],[2000,1000]]){
    const size=boundedOcrSize(w,h);assert(size.width*size.height<=OCR_LIMITS.renderPixels);assert(Math.abs(size.width/size.height-w/h)<.05);
  }
  for(const dimensions of [[1e9,1e9],[0,20],[Infinity,50],[-1,20]])assert.throws(()=>boundedOcrSize(...dimensions));
});
test('cancelled OCR cannot start an engine or interpret uploaded data',async()=>{
  const controller=new AbortController();controller.abort();
  await assert.rejects(extractOcr(new TextEncoder().encode('%PDF-1.7'),{signal:controller.signal}),{name:'AbortError'});
});
test('advertised PNG and JPEG decompression bombs fail before the decoder',()=>{
  const png=new Uint8Array(24),p=new DataView(png.buffer);png.set(new TextEncoder().encode('IHDR'),12);p.setUint32(16,200_000);p.setUint32(20,200_000);
  assert.throws(()=>checkDeclaredRasterSize(png,'image/png'),/32 megapixels/);
  const jpg=Uint8Array.from([255,216,255,192,0,8,8,255,255,255,255,3]);
  assert.throws(()=>checkDeclaredRasterSize(jpg,'image/jpeg'),/32 megapixels/);
  p.setUint32(16,1200);p.setUint32(20,1800);assert.doesNotThrow(()=>checkDeclaredRasterSize(png,'image/png'));
});
