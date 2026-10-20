import { createHash } from 'node:crypto';
import { readdir,readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { packageRoot } from './common.js';

/** Sorted relative UTF-8 path + NUL + exact file bytes for every material tool input. */
export async function toolFingerprint():Promise<string> {
  const hash=createHash('sha256');
  const collect=async(directory:string):Promise<void>=>{
    const entries=(await readdir(join(packageRoot,directory),{withFileTypes:true})).sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0);
    for(const entry of entries){const path=`${directory}/${entry.name}`;if(entry.isDirectory())await collect(path);else{hash.update(`${path}\0`);hash.update(await readFile(join(packageRoot,path)));}}
  };
  for(const directory of ['src','sources','frames','test'])await collect(directory);
  for(const file of ['package.json','pnpm-lock.yaml','pnpm-workspace.yaml','tsconfig.json']){
    hash.update(`${file}\0`);hash.update(await readFile(join(packageRoot,file)));
  }
  return hash.digest('hex');
}
