import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {WorkspaceResolver} from '../../src/server/workspace-context.js';
import {NotesService} from '../../src/server/note-service.js';
const note=(title:string)=>`# Agent Note: ${title}\n\nStatus: implemented\n\n## Problem\n项目边界。\n\n## Decision\n固定项目身份。\n\n## Alternatives considered\n无\n\n## Consequences\n拒绝目录重定向。\n`;
async function project(root:string,title:string){const directory=path.join(root,'.agents/notes/implemented/architecture');await fs.mkdir(directory,{recursive:true});await fs.writeFile(path.join(directory,'2026-10-28-project.md'),note(title));}
test('registered parent and child sessions cannot rebind after their project root becomes an outside symlink',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'notes-project-id-'));
 const inside=path.join(root,'project'),outside=path.join(root,'outside');await project(inside,'inside');await project(outside,'outside-secret');
 const host={header:async()=>({cwd:inside}),workspaces:()=>[{id:'w',path:inside,sessionIds:['parent']}]};
 const service=new NotesService(new WorkspaceResolver(host));
 try{
  assert.equal((await service.snapshot('parent')).notes[0].title,'inside');assert.equal((await service.snapshot('child')).workspaceId,'w');
  await fs.rename(inside,path.join(root,'project-old'));await fs.symlink(outside,inside);
  for(const sid of ['parent','child','first-observed-child'])await assert.rejects(service.snapshot(sid),{code:'workspace-mismatch'});
 }finally{service.dispose();assert.ok(root.startsWith(path.join(os.tmpdir(),'notes-project-id-')));await fs.rm(root,{recursive:true,force:true});}
});
test('unregistered fallback and registered aliases retain their first authorized canonical root',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'notes-alias-id-'));
 const inside=path.join(root,'inside'),outside=path.join(root,'outside');await project(inside,'inside');await project(outside,'outside');
 const fallback=new WorkspaceResolver({header:async()=>({cwd:inside}),workspaces:()=>[]});
 const alias=path.join(root,'alias');await fs.symlink(inside,alias);
 const registered=new WorkspaceResolver({header:async()=>({cwd:alias}),workspaces:()=>[{id:'a',path:inside,sessionIds:[]},{id:'b',path:outside,sessionIds:[]}]});
 try{
  assert.equal((await fallback.resolve('free')).projectRoot,inside);assert.equal((await registered.resolve('aliased')).workspaceId,'a');
  assert.equal(path.resolve(alias),path.join(root,'alias'));await fs.unlink(alias);await fs.symlink(outside,alias);
  await assert.rejects(registered.resolve('aliased'),{code:'workspace-mismatch'});
  await fs.rename(inside,path.join(root,'inside-old'));await fs.symlink(outside,inside);
  await assert.rejects(fallback.resolve('free'),{code:'workspace-mismatch'});
  const first=new WorkspaceResolver({header:async()=>({cwd:inside}),workspaces:()=>[]});await assert.rejects(first.resolve('never-seen'),{code:'workspace-mismatch'});
 }finally{assert.ok(root.startsWith(path.join(os.tmpdir(),'notes-alias-id-')));await fs.rm(root,{recursive:true,force:true});}
});
