import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {NotesConfiguration} from '../../src/server/config.js';
import {WorkspaceResolver} from '../../src/server/workspace-context.js';
import {NotesService} from '../../src/server/note-service.js';
import type {NotesChange} from '../../src/contracts/notes.js';
import {linuxOnly} from './linux-only.ts';
const body = (title:string) => `# Agent Note: ${title}\n\nStatus: implemented\n\n## Problem\n需要记录项目决策。\n\n## Decision\n使用已授权工作区作为边界。\n\n## Alternatives considered\n无\n\n## Consequences\n读取不创建目录。\n`;
async function until(check:()=>boolean,timeout=5000){const start=Date.now();while(!check()){if(Date.now()-start>timeout)throw new Error('snapshot wait timed out');await new Promise(resolve=>setTimeout(resolve,25));}}
test('shared stream observes creation, recursive edits, moves, removal and recreation', linuxOnly, async()=>{
  const root = await fs.mkdtemp(path.join(os.tmpdir(),'notes-live-'));
  const config = new NotesConfiguration({pollIntervalMs:250});
  const resolver = new WorkspaceResolver({header:async()=>({cwd:root}),workspaces:()=>[{id:'w',path:root,sessionIds:['a','b']}]},config);
  const service = new NotesService(resolver); const events:NotesChange[]=[];
  try {
    const stopA=await service.subscribe('a',event=>events.push(event));
    const stopB=await service.subscribe('b',()=>{});
    assert.equal(service.diagnostics.entries,1);assert.equal(service.diagnostics.consumers,2);
    const missing=await service.snapshot('a'); assert.equal(missing.status,'missing');assert.equal(missing.complete,true);
    await assert.rejects(fs.stat(missing.notesRoot),{code:'ENOENT'});
    const id='implemented/architecture/2026-10-28-example.md';
    await fs.mkdir(path.dirname(path.join(missing.notesRoot,id)),{recursive:true});await fs.writeFile(path.join(missing.notesRoot,id),body('最初决策'));
    const latest=()=>events.filter((e):e is Extract<NotesChange,{type:'snapshot'}>=>e.type==='snapshot').at(-1)?.snapshot;
    await until(()=>latest()?.notes[0]?.title==='最初决策');
    const version=latest()!.snapshotVersion;
    await fs.writeFile(path.join(missing.notesRoot,id),body('外部编辑'));
    await until(()=>latest()?.notes[0]?.title==='外部编辑');assert.ok(latest()!.snapshotVersion>version);
    const moved='implemented/architecture/2026-10-28-renamed.md';await fs.rename(path.join(missing.notesRoot,id),path.join(missing.notesRoot,moved));
    await until(()=>latest()?.notes[0]?.id===moved);
    await assert.rejects(service.read('a',id),{code:'note-unavailable'});assert.match((await service.read('b',moved)).raw,/外部编辑/);
    assert.equal(path.resolve(missing.notesRoot),path.join(root,'.agents/notes'));await fs.rm(missing.notesRoot,{recursive:true});
    await until(()=>latest()?.status==='missing'&&latest()?.notes.length===0);
    await fs.mkdir(path.dirname(path.join(missing.notesRoot,id)),{recursive:true});await fs.writeFile(path.join(missing.notesRoot,id),body('重建'));
    await until(()=>latest()?.notes[0]?.title==='重建');
    config.update({workspaceOverrides:{w:{notesPath:'docs/decisions'}},pollIntervalMs:250});
    await until(()=>events.some(e=>e.type==='invalidated'));
    assert.equal((await service.snapshot('a')).notes.length,0);
    stopA();stopB();
    assert.equal(service.diagnostics.watchers,0);
  }finally{service.dispose();assert.deepEqual(service.diagnostics,{entries:0,watchers:0,consumers:0});assert.ok(root.startsWith(path.join(os.tmpdir(),'notes-live-')));await fs.rm(root,{recursive:true,force:true});}
});
test('fresh queries are isolated and reject untrusted paths and revoked memberships', linuxOnly, async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'notes-isolated-'));
  const a=path.join(root,'a'),b=path.join(root,'b');await fs.mkdir(a);await fs.mkdir(b);
  let valid=true;
  const resolver=new WorkspaceResolver({header:async sid=>valid?{cwd:sid==='sa'?a:b}:undefined,workspaces:()=>[]});
  const service=new NotesService(resolver);
  try{
    const ca=await resolver.resolve('sa'),cb=await resolver.resolve('sb');
    const id='implemented/feature/2026-10-28-example.md';
    await fs.mkdir(path.dirname(path.join(ca.notesRoot,id)),{recursive:true});await fs.writeFile(path.join(ca.notesRoot,id),body('A'));
    assert.equal((await service.snapshot('sa')).notes[0].title,'A');assert.equal((await service.snapshot('sb')).notes.length,0);
    assert.notEqual(ca.notesRoot,cb.notesRoot);await assert.rejects(service.read('sa','../../outside'),{code:'invalid-path'});
    valid=false;await assert.rejects(service.snapshot('sa'),{code:'unknown-session'});
  }finally{service.dispose();assert.ok(root.startsWith(path.join(os.tmpdir(),'notes-isolated-')));await fs.rm(root,{recursive:true,force:true});}
});
