import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const dependency=resolve('node_modules/pdfjs-dist'),target=resolve('public/vendor/pdfjs');
const metadata=JSON.parse(await readFile(resolve(dependency,'package.json'),'utf8'));
if(metadata.version!=='6.4.299') throw new Error('Install the pinned PDF.js dependency with npm ci.');
await mkdir(target,{recursive:true});
for(const [input,output] of [['build/pdf.min.mjs','pdf.mjs'],['build/pdf.worker.min.mjs','pdf.worker.mjs'],['cmaps','cmaps'],['standard_fonts','standard_fonts'],['wasm','wasm'],['LICENSE','LICENSE']]) await cp(resolve(dependency,input),resolve(target,output),{recursive:true});
await writeFile(resolve(target,'version.json'),JSON.stringify({package:'pdfjs-dist',version:metadata.version,licence:'Apache-2.0'})+'\n');
console.log('Local PDF text importer assets prepared.');
