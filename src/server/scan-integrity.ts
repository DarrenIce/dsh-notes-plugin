import { createHash } from 'node:crypto';
import { closeSync, constants, fstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { NotesError, type WorkspaceContext } from '../contracts/workspace.js';

export interface CapturedNotes { root: string; fingerprint: string; status: 'ready'|'missing'; dispose(): void }
/** Linux directory descriptors anchor every component, including ancestors of the project root. */
export function captureNotes(context: WorkspaceContext, materialize = true): CapturedNotes {
  if (process.platform !== 'linux') throw new NotesError('unsupported-platform','当前安全快照实现需要 Linux 的目录句柄接口。');
  const temporary = materialize ? mkdtempSync(path.join(os.tmpdir(),'dsh-notes-capture-')) : '';
  const digest = createHash('sha256'); const handles = new Set<number>();
  let count=0,bytes=0,status:CapturedNotes['status']='ready';
  const openDirectory = (target:string) => { const fd=openSync(target,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);handles.add(fd);return fd; };
  const close = (fd:number) => { if(handles.delete(fd))closeSync(fd); };
  const dispose = () => { for(const fd of [...handles])close(fd); if(temporary){if(path.dirname(temporary)!==os.tmpdir()||!path.basename(temporary).startsWith('dsh-notes-capture-'))throw new Error('invalid capture directory');rmSync(temporary,{recursive:true,force:true});} };
  try {
    let directory=openDirectory('/');
    for (const part of context.projectRoot.split('/').filter(Boolean)) {
      const next=openDirectory(`/proc/self/fd/${directory}/${part}`);close(directory);directory=next;
    }
    for (const part of context.notesPath.split('/').filter(Boolean)) {
      try { const next=openDirectory(`/proc/self/fd/${directory}/${part}`);close(directory);directory=next; }
      catch(error) { if((error as NodeJS.ErrnoException).code==='ENOENT'){status='missing';break;}throw error; }
    }
    const walk = (fd:number,relative:string,depth:number) => {
      if(depth>32)throw new NotesError('scan-limit','笔记目录超过最大深度。');
      for(const entry of readdirSync(`/proc/self/fd/${fd}`,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){
        if(++count>10000)throw new NotesError('scan-limit','笔记目录条目超过上限。');
        const id=relative?`${relative}/${entry.name}`:entry.name;
        if(entry.isSymbolicLink())throw new NotesError('symlink','笔记目录包含符号链接，请使用普通文件和目录。');
        if(entry.isDirectory()){
          const child=openDirectory(`/proc/self/fd/${fd}/${entry.name}`);
          try{digest.update(`directory:${id}\0`);if(temporary)mkdirSync(path.join(temporary,id));walk(child,id,depth+1);}finally{close(child);}
        }else{
          const file=openSync(`/proc/self/fd/${fd}/${entry.name}`,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);handles.add(file);
          try{
            const before=fstatSync(file);if(!before.isFile())throw new NotesError('unsupported-file','笔记目录包含不支持的文件类型。');
            bytes+=before.size;if(before.size>4*1024*1024||bytes>32*1024*1024)throw new NotesError('scan-limit','笔记文件或目录总量超过读取上限。');
            const content=readFileSync(file);const after=fstatSync(file);
            if(after.size!==before.size||after.mtimeMs!==before.mtimeMs||after.ctimeMs!==before.ctimeMs||content.length!==before.size)throw new NotesError('unstable-scan','捕获期间文件发生变化。');
            digest.update(`file:${id}\0`);digest.update(content);
            if(temporary)writeFileSync(path.join(temporary,id),content,{flag:'wx'});
          }finally{close(file);}
        }
      }
    };
    if(status==='ready')walk(directory,'',0);else digest.update('missing');
    for(const fd of [...handles])close(fd);
    return {root:temporary,fingerprint:digest.digest('hex'),status,dispose};
  }catch(error){dispose();throw error;}
}
