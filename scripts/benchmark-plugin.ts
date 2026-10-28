import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {performance} from 'node:perf_hooks';
import {WorkspaceResolver} from '../src/server/workspace-context.js';
import {NotesService} from '../src/server/note-service.js';

const count=Number(process.argv[2]??1000);
if(!Number.isInteger(count)||count<1||count>5000)throw new Error('usage: tsx scripts/benchmark-plugin.ts [1..5000]');
const root=await fs.mkdtemp(path.join(os.tmpdir(),'dsh-notes-benchmark-'));
const service=new NotesService(new WorkspaceResolver({header:async()=>({cwd:root}),workspaces:()=>[{id:'benchmark',path:root,sessionIds:['bench','peer']}] }));
const directory=path.join(root,'.agents/notes/implemented/architecture');
const content=(index:number)=>`# Agent Note: 基准决策 ${index}\n\nStatus: implemented\n\n## Problem\n衡量完整安全快照和校验的实际开销。\n\n## Decision\n以显式工作区和本地文件作为事实来源。\n\n## Alternatives considered\n无\n\n## Consequences\n测试结果只是本机观测，不代表其他设备。\n`;
try{
 await fs.mkdir(directory,{recursive:true});
 for(let i=0;i<count;i++)await fs.writeFile(path.join(directory,`2026-10-28-benchmark-${String(i).padStart(4,'0')}.md`),content(i));
 const memoryBefore=process.memoryUsage().rss;
 let start=performance.now();const cold=await service.snapshot('bench');const coldMs=performance.now()-start;assert.equal(cold.complete,true);assert.equal(cold.notes.length,count);
 start=performance.now();await service.snapshot('peer');const refreshMs=performance.now()-start;
 let resolveUpdate:(()=>void)|undefined;
 const updated=new Promise<void>(resolve=>{resolveUpdate=resolve});
 const stop=await service.subscribe('bench',event=>{if(event.type==='snapshot'&&event.snapshot.notes.some(note=>note.title==='基准决策 999999'))resolveUpdate?.()});
 start=performance.now();await fs.writeFile(path.join(directory,'2026-10-28-benchmark-0000.md'),content(999999));
 let timer:ReturnType<typeof setTimeout>|undefined;
 try{await Promise.race([updated,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('watch timeout')),10000)})]);}finally{clearTimeout(timer);}
 const updateMs=performance.now()-start;stop();
 console.log(JSON.stringify({count,bytes:Buffer.byteLength(content(1))*count,coldMs:Math.round(coldMs),refreshMs:Math.round(refreshMs),updateMs:Math.round(updateMs),rssDeltaMiB:Math.round((process.memoryUsage().rss-memoryBefore)/1048576),diagnostics:service.diagnostics},null,2));
}finally{
 service.dispose();assert.ok(root.startsWith(path.join(os.tmpdir(),'dsh-notes-benchmark-')));await fs.rm(root,{recursive:true,force:true});
}
