import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { closeSync, constants, fstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { NotesError, type WorkspaceContext } from '../contracts/workspace.js';

export interface CapturedNotes { root: string; fingerprint: string; status: 'ready'|'missing'; dispose(): void }
function temporaryCapture(materialize: boolean) {
  const temporary = materialize ? mkdtempSync(path.join(os.tmpdir(),'dsh-notes-capture-')) : '';
  const dispose = () => {
    if (!temporary) return;
    if (path.dirname(temporary) !== os.tmpdir() || !path.basename(temporary).startsWith('dsh-notes-capture-')) throw new Error('invalid capture directory');
    rmSync(temporary,{recursive:true,force:true});
  };
  return {temporary,dispose};
}
const exec = promisify(execFile);
async function captureWindows(context: WorkspaceContext, materialize: boolean): Promise<CapturedNotes> {
  const {temporary,dispose} = temporaryCapture(materialize);
  try {
    const executable = path.join(process.env.SystemRoot ?? 'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
    let output: string;
    try {
      const child = exec(executable,['-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',fileURLToPath(new URL('./windows-capture.ps1',import.meta.url))],{
        encoding:'utf8',timeout:30000,maxBuffer:48*1024*1024,windowsHide:true,
      });
      child.child.stdin!.on('error',()=>{}); // A startup failure is reported by the process promise.
      child.child.stdin!.end(JSON.stringify({projectRoot:context.projectRoot,notesPath:context.notesPath}));
      output = (await child).stdout;
    } catch (error) {
      const detail = String((error as {stderr?:unknown}).stderr ?? (error as Error).message).trim();
      throw new NotesError('windows-capture-failed',`Windows 安全捕获失败（需要系统 PowerShell 与 Add-Type）：${detail}`);
    }
    const result = JSON.parse(output) as {status:'ready'|'missing';entries:{id:string;content:string|null}[]};
    if (!['ready','missing'].includes(result.status) || !Array.isArray(result.entries) || result.entries.length > 10000) throw new NotesError('invalid-capture','Windows 捕获返回无效结果。');
    const digest = createHash('sha256');
    if (result.status === 'missing') digest.update('missing');
    for (const entry of result.entries.sort((a,b)=>a.id.localeCompare(b.id))) {
      if (!entry.id || entry.id.split('/').some(part=>!part || part==='.' || part==='..' || /[\\\\:\u0000]/.test(part))) throw new NotesError('invalid-capture','Windows 捕获返回无效路径。');
      if (entry.content === null) {
        digest.update(`directory:${entry.id}\0`);
        if (temporary) mkdirSync(path.join(temporary,entry.id),{recursive:true});
      } else {
        const content = Buffer.from(entry.content,'base64');
        digest.update(`file:${entry.id}\0`); digest.update(content);
        if (temporary) writeFileSync(path.join(temporary,entry.id),content,{flag:'wx'});
      }
    }
    return {root:temporary,fingerprint:digest.digest('hex'),status:result.status,dispose};
  } catch (error) { dispose(); throw error; }
}
/** Use platform-specific pinned handles; never downgrade to check-then-open path reads. */
export async function captureNotes(context: WorkspaceContext, materialize = true): Promise<CapturedNotes> {
  if (process.platform === 'win32') return captureWindows(context,materialize);
  if (process.platform !== 'linux') throw new NotesError('unsupported-platform','安全快照当前支持 Linux 与 Windows。');
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
