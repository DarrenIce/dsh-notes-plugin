import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {NotesService} from '../../src/server/note-service.js';
import {WorkspaceResolver} from '../../src/server/workspace-context.js';
import {linuxOnly} from './linux-only.ts';
test('empty and committed Git workspaces without notes remain complete regardless of locale',linuxOnly,async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'notes-git-context-'));
  const service=new NotesService(new WorkspaceResolver({header:async()=>({cwd:root}),workspaces:()=>[]}));
  const git=(args:string[])=>execFileSync('git',['-C',root,...args],{stdio:'pipe',env:{...process.env,LC_ALL:'zh_CN.UTF-8'}});
  try{
    git(['init']);
    const unborn=await service.snapshot('s');assert.equal(unborn.complete,true);assert.equal(unborn.status,'missing');assert.match(unborn.checkoutVersion!,/^unborn:/);
    const review=await service.beginReview('s');assert.ok(review.reviewToken);
    git(['-c','user.name=Notes Test','-c','user.email=notes@example.invalid','commit','--allow-empty','-m','initial']);
    const committed=await service.snapshot('s');assert.equal(committed.complete,true);assert.equal(committed.status,'missing');
    await assert.rejects(fs.stat(path.join(root,'.agents/notes')),{code:'ENOENT'});
  }finally{service.dispose();assert.ok(root.startsWith(path.join(os.tmpdir(),'notes-git-context-')));await fs.rm(root,{recursive:true,force:true});}
});
test('nested workspaces use their own Git manifest instead of the repository root manifest',linuxOnly,async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'notes-git-nested-'));
  const project=path.join(root,'subproject');
  const service=new NotesService(new WorkspaceResolver({header:async()=>({cwd:project}),workspaces:()=>[]}));
  const git=(args:string[])=>execFileSync('git',['-C',root,...args],{stdio:'pipe'});
  try{
    await fs.mkdir(path.join(root,'.agents/notes/archived'),{recursive:true});
    await fs.mkdir(path.join(project,'.agents/notes/archived'),{recursive:true});
    await fs.writeFile(path.join(root,'.agents/notes/archived/manifest.json'),JSON.stringify({version:1,files:{'archived/unrelated.md':'sha256:root-only'}}));
    await fs.writeFile(path.join(project,'.agents/notes/archived/manifest.json'),JSON.stringify({version:1,files:{}}));
    git(['init']);git(['add','--','.agents','subproject']);git(['-c','user.name=Notes Test','-c','user.email=notes@example.invalid','commit','-m','separate baselines']);
    const snapshot=await service.snapshot('s');assert.equal(snapshot.complete,true);assert.equal(snapshot.status,'ready');assert.deepEqual(snapshot.validation.issues,[]);
    assert.equal(snapshot.notesRoot,path.join(project,'.agents/notes'));
  }finally{service.dispose();assert.ok(root.startsWith(path.join(os.tmpdir(),'notes-git-nested-')));await fs.rm(root,{recursive:true,force:true});}
});
