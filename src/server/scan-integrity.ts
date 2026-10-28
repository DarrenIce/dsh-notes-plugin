import { createHash } from 'node:crypto';
import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { NotesError } from '../contracts/workspace.js';

/** Bound host RPC work before invoking the unrestricted standalone CLI core. */
export function scanFingerprint(root: string): string {
  const digest = createHash('sha256'); let files = 0; let bytes = 0;
  const walk = (directory: string, depth: number) => {
    if (depth > 32) throw new NotesError('scan-limit','笔记目录超过最大深度。');
    let entries;
    try { entries = readdirSync(directory,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name)); }
    catch(error) { if((error as NodeJS.ErrnoException).code==='ENOENT'){digest.update('missing');return;} throw error; }
    for (const entry of entries) {
      if (++files > 10000) throw new NotesError('scan-limit','笔记目录条目超过上限。');
      const full = path.join(directory,entry.name); const id = path.relative(root,full);
      const stat = lstatSync(full); digest.update(id); digest.update(String(stat.mode));
      if(stat.isSymbolicLink()) throw new NotesError('symlink','笔记目录包含符号链接，请使用普通文件和目录。');
      if(stat.isDirectory()){walk(full,depth+1);continue;}
      if(!stat.isFile())throw new NotesError('unsupported-file','笔记目录包含不支持的文件类型。');
      bytes += stat.size;
      if(stat.size>4*1024*1024 || bytes>32*1024*1024)throw new NotesError('scan-limit','笔记文件或目录总量超过读取上限。');
      const fd=openSync(full,constants.O_RDONLY|constants.O_NOFOLLOW);
      try {
        const opened=fstatSync(fd);
        if(!opened.isFile() || opened.ino!==stat.ino || opened.size!==stat.size)throw new NotesError('unstable-scan','扫描期间文件发生变化。');
        digest.update(readFileSync(fd));
      } finally {closeSync(fd);}
    }
  };
  walk(root,0); return digest.digest('hex');
}
