import {existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {join,resolve} from 'node:path';

/** Developer tests require a real DSH installation; package runtime does not call this helper. */
export function dshTestRoot(){
 let root=process.env.DSH_ROOT;
 if(!root){
  try{root=join(execFileSync('npm',['root','-g'],{encoding:'utf8',timeout:10000,stdio:['ignore','pipe','pipe']}).trim(),'@deepseek-ai','dsh');}
  catch{throw new Error('Set DSH_ROOT to the installed DSH 0.2.1-rc.2 package directory before running host integration tests.');}
 }
 root=resolve(root);
 if(!existsSync(join(root,'package.json')))throw new Error(`DSH host is unavailable at ${root}; set DSH_ROOT to the installed DSH package directory.`);
 return root;
}
