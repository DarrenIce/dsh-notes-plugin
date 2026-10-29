import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { NotesConfiguration } from '../../src/server/config.ts';
import { WorkspaceResolver } from '../../src/server/workspace-context.ts';
import { NotesService } from '../../src/server/note-service.ts';
import { installNoteAgent } from '../../src/server/note-tools.ts';
import { linuxOnly } from './linux-only.ts';

test('notes tools bind real service to overridden root and fresh explicit review', linuxOnly, async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'notes-agent-tools-'));
  const id = 'implemented/architecture/2026-10-01-test.md';
  const note = '# Agent Note: 测试\n\nStatus: implemented\n\n## Problem\n问题\n\n## Decision\n选择\n\n## Alternatives considered\n无\n\n## Consequences\n后果\n';
  const root = path.join(base, 'docs', 'decisions');
  await fs.mkdir(path.join(root, 'implemented', 'architecture'), {recursive:true});
  await fs.writeFile(path.join(root, id), note);
  const configuration = new NotesConfiguration({ workspaceOverrides:{w:{notesPath:'docs/decisions'}} });
  const resolver = new WorkspaceResolver({header:async sid => sid === 's' ? {cwd:base} : undefined, workspaces:()=>[{id:'w',path:base,sessionIds:['s']}]}, configuration);
  const service = new NotesService(resolver);
  const definitions = new Map<string, any>();
  const ctx = { skills: {registerProvider:()=>()=>{},snapshot:async()=>({skills:[],complete:true})},
    systemPrompt: {section:()=>()=>{},assemble:async()=>({sections:[]})},
    tools:{register:(item:any)=>{definitions.set(item.name,item);return ()=>definitions.delete(item.name);},get:()=>undefined},
    workingDirectory:{ensure:async()=>base} };
  const dispose = installNoteAgent(ctx, service, resolver, {skillRoot:path.resolve('src/skills/dsh-write-notes')});
  const invoke = async (name:string, args:unknown) => JSON.parse(await definitions.get(name).execute(args,{agent:{id:'s'},signal:new AbortController().signal}));
  try {
    const first = await invoke('notes_context', {});
    assert.equal(first.context.notesRoot, root);
    const start = await invoke('notes_begin_review', {});
    const found = await invoke('notes_search', {query:'测试'});
    assert.equal(found.matches[0].id,id);
    assert.equal((await invoke('notes_read', {id})).raw,note);
    const initial = await invoke('notes_validate', {reviewToken:start.review.reviewToken});
    assert.equal(initial.validation.notesRoot,root);
    await fs.writeFile(path.join(root,id), note.replace('## Decision','## Changed'));
    const after = await invoke('notes_validate', {reviewToken:start.review.reviewToken});
    assert.notEqual(after.validation.sourceVersion,initial.validation.sourceVersion);
    assert.equal(after.validation.complete,true);
    assert.ok(after.validation.issues.some((issue:any) => issue.attribution === 'uncertain'));
    configuration.update({workspaceOverrides:{w:{notesPath:'elsewhere'}}});
    const changed = await invoke('notes_context', {});
    assert.equal(changed.context.notesRoot,path.join(base,'elsewhere'));
    assert.equal((await invoke('notes_search', {query:'测试'})).total,0);
  } finally {
    dispose(); service.dispose();
    assert.ok(base.startsWith(path.join(os.tmpdir(),'notes-agent-tools-')));
    await fs.rm(base,{recursive:true,force:true});
  }
});
