import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {WorkspaceResolver} from '../../src/server/workspace-context.js';
import {NotesConfiguration} from '../../src/server/config.js';
import {NotesService} from '../../src/server/note-service.js';
test('child sessions inherit the uniquely matching registered root and its notes configuration',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'notes-child-root-'));
 const workspaces=[{id:'workspace',path:root,sessionIds:['parent']},{id:'missing',path:path.join(root,'gone'),sessionIds:[]}];
 const resolver=new WorkspaceResolver({header:async()=>({cwd:root}),workspaces:()=>workspaces},new NotesConfiguration({workspaceOverrides:{workspace:{notesPath:'docs/decisions'}}}));
 const service=new NotesService(resolver);
 try{
  const [parent,child]=await Promise.all([resolver.resolve('parent'),resolver.resolve('child')]);
  assert.equal(child.workspaceId,parent.workspaceId);assert.equal(child.notesRoot,path.join(root,'docs/decisions'));assert.equal(child.configRevision,parent.configRevision);
  const stopParent=await service.subscribe('parent',()=>{}),stopChild=await service.subscribe('child',()=>{});assert.equal(service.diagnostics.entries,1);stopParent();stopChild();
  workspaces.push({id:'duplicate',path:root,sessionIds:[]});await assert.rejects(resolver.resolve('child'),{code:'ambiguous-workspace'});
  assert.equal((await resolver.resolve('parent')).workspaceId,'workspace');
 }finally{service.dispose();assert.ok(root.startsWith(path.join(os.tmpdir(),'notes-child-root-')));await fs.rm(root,{recursive:true,force:true});}
});
