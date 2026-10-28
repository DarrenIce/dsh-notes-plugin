import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { NotesConfiguration } from '../../src/server/config.js';
import { WorkspaceResolver } from '../../src/server/workspace-context.js';

test('workspace roots stay bound to immutable session headers and config revisions', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'notes-workspaces-'));
  try {
    const a = path.join(root, 'a'); const b = path.join(root, 'b');
    await fs.mkdir(a); await fs.mkdir(b);
    const headers: Record<string, {cwd:string}> = { sa: {cwd:a}, sb: {cwd:b} };
    const config = new NotesConfiguration({ workspaceOverrides: { wb: {notesPath:'docs/decisions'} } });
    const resolver = new WorkspaceResolver({ header: async sid => headers[sid], workspaces: () => [
      {id:'wa',path:a,sessionIds:['sa']}, {id:'wb',path:b,sessionIds:['sb']},
    ] }, config);
    const [ca, cb] = await Promise.all([resolver.resolve('sa'), resolver.resolve('sb')]);
    assert.equal(ca.notesRoot, path.join(a,'.agents/notes'));
    assert.equal(cb.notesRoot, path.join(b,'docs/decisions'));
    assert.equal(ca.status,'missing'); await assert.rejects(fs.stat(ca.notesRoot), {code:'ENOENT'});
    assert.equal(ca.capabilities.write,false);
    await assert.rejects(resolver.resolve('unknown'), {code:'unknown-session'});
    config.update({workspaceOverrides:{wa:{notesPath:'decisions'}}});
    const changed = await resolver.resolve('sa');
    assert.notEqual(changed.configRevision,ca.configRevision);
    headers.sa = {cwd:b};
    await assert.rejects(resolver.resolve('sa'), {code:'workspace-mismatch'});
  } finally { assert.ok(root.startsWith(path.join(os.tmpdir(),'notes-workspaces-'))); await fs.rm(root,{recursive:true,force:true}); }
});
test('notes path rejects traversal, non-directories and escaping symbolic links', async () => {
  for (const notesPath of ['../outside','/tmp/outside','a/../../b','.','a\\b']) {
    assert.throws(() => new NotesConfiguration({workspaceOverrides:{w:{notesPath}}}), {code:'invalid-config'});
  }
  const root = await fs.mkdtemp(path.join(os.tmpdir(),'notes-boundary-'));
  try {
    const project = path.join(root,'project'); await fs.mkdir(project);
    const host = {header:async()=>({cwd:project}),workspaces:()=>[{id:'w',path:project,sessionIds:['s']}]};
    await fs.symlink(root,path.join(project,'escape'));
    const resolver = new WorkspaceResolver(host,new NotesConfiguration({workspaceOverrides:{w:{notesPath:'escape/notes'}}}));
    await assert.rejects(resolver.resolve('s'),{code:'path-escape'});
    await fs.writeFile(path.join(project,'file'),'x');
    resolver.configuration.update({workspaceOverrides:{w:{notesPath:'file/notes'}}});
    await assert.rejects(resolver.resolve('s'),{code:'not-directory'});
    await fs.symlink(path.join(root,'absent'),path.join(project,'dangling'));
    resolver.configuration.update({workspaceOverrides:{w:{notesPath:'dangling/notes'}}});
    await assert.rejects(resolver.resolve('s'),{code:'path-escape'});
  } finally { assert.ok(root.startsWith(path.join(os.tmpdir(),'notes-boundary-'))); await fs.rm(root,{recursive:true,force:true}); }
});
