import { cp, mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
const dependency=resolve('node_modules/pdfjs-dist'),target=resolve('public/vendor/pdfjs');
const metadata=JSON.parse(await readFile(resolve(dependency,'package.json'),'utf8'));
if(metadata.version!=='6.4.299') throw new Error('Install the pinned PDF.js dependency with npm ci.');
await mkdir(target,{recursive:true});
for(const [input,output] of [['build/pdf.min.mjs','pdf.mjs'],['build/pdf.worker.min.mjs','pdf.worker.mjs'],['cmaps','cmaps'],['standard_fonts','standard_fonts'],['wasm','wasm'],['LICENSE','LICENSE']]) await cp(resolve(dependency,input),resolve(target,output),{recursive:true});
await writeFile(resolve(target,'version.json'),JSON.stringify({package:'pdfjs-dist',version:metadata.version,licence:'Apache-2.0'})+'\n');
const ocrTarget=resolve('public/vendor/ocr'),spellTarget=resolve('public/vendor/spellcheck');
for(const [name,version] of [['tesseract.js','7.0.0'],['tesseract.js-core','7.0.0'],['@tesseract.js-data/eng','1.0.0'],['typo-js','1.3.2'],['dictionary-en-gb','3.0.0']]) {
  const installed=JSON.parse(await readFile(resolve('node_modules',name,'package.json'),'utf8'));
  if(installed.version!==version)throw new Error(`Install the pinned ${name} dependency with npm ci.`);
}
await mkdir(resolve(ocrTarget,'core'),{recursive:true});
await mkdir(resolve(ocrTarget,'lang'),{recursive:true});
for(const name of ['tesseract.esm.min.js','worker.min.js','worker.min.js.LICENSE.txt','tesseract.min.js.LICENSE.txt'])await cp(resolve('node_modules/tesseract.js/dist',name),resolve(ocrTarget,name));
await cp(resolve('node_modules/tesseract.js/LICENSE.md'),resolve(ocrTarget,'LICENSE.md'));
for(const name of await readdir(resolve('node_modules/tesseract.js-core')))if(/^tesseract-core.*\.wasm(?:\.js)?$/.test(name)||name==='LICENSE')await cp(resolve('node_modules/tesseract.js-core',name),resolve(ocrTarget,'core',name));
await cp(resolve('node_modules/@tesseract.js-data/eng/4.0.0/eng.traineddata.gz'),resolve(ocrTarget,'lang/eng.traineddata.gz'));
await cp(resolve('node_modules/@tesseract.js-data/eng/README.md'),resolve(ocrTarget,'lang/README.md'));
for(const [input,output] of [['tessdata-LICENSE.txt','LICENSE.txt'],['tessdata-NOTICE.txt','NOTICE.txt'],['tessdata-source.json','source.json']])await cp(resolve('scripts/vendor-notices',input),resolve(ocrTarget,'lang',output));
await writeFile(resolve(ocrTarget,'version.json'),JSON.stringify({engine:'tesseract.js',version:'7.0.0',core:'7.0.0',language:'eng',languagePackage:'@tesseract.js-data/eng',languagePackageVersion:'1.0.0',licence:'Apache-2.0',languageModelLicence:'Apache-2.0',languagePackageMetadataLicence:'MIT',source:'https://github.com/naptha/tesseract.js',languageModelSource:'https://github.com/naptha/tessdata/tree/806cd9adc8c6e8abc11c782db1818c990576bebc'})+'\n');
await mkdir(spellTarget,{recursive:true});
for(const [input,output] of [['node_modules/typo-js/typo.js','typo.js'],['scripts/vendor-notices/typo-js-LICENSE.txt','TYPO-LICENSE.txt'],['node_modules/dictionary-en-gb/index.aff','en_GB.aff'],['node_modules/dictionary-en-gb/index.dic','en_GB.dic'],['node_modules/dictionary-en-gb/license','DICTIONARY-LICENSE.txt']])await cp(resolve(input),resolve(spellTarget,output));
await writeFile(resolve(spellTarget,'version.json'),JSON.stringify({spellchecker:'typo-js',version:'1.3.2',licence:'BSD-3-Clause',dictionary:'dictionary-en-gb',dictionaryVersion:'3.0.0',dictionaryLicence:'MIT AND BSD',language:'en-GB'})+'\n');
console.log('Local PDF, OCR and British English spelling assets prepared.');
