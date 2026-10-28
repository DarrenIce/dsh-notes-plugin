import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {NotesService} from '../../src/server/note-service.js';
import {WorkspaceResolver} from '../../src/server/workspace-context.js';
test('empty and committed Git workspaces without notes remain complete regardless of locale',async()=>{
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
