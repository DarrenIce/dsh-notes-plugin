import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { NotesService } from '../../src/server/note-service.js';
import { WorkspaceResolver } from '../../src/server/workspace-context.js';

const noteId = 'implemented/feature/2026-10-28-race.md';
const body = (title: string) => `# Agent Note: ${title}\n\nStatus: implemented\n\n## Problem\nx\n\n## Decision\nx\n\n## Alternatives considered\nx\n\n## Consequences\nx\n`;
async function fixture() {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'notes-security-races-'));
  const root = await fs.realpath(temp);
  return {
    root,
    async cleanup() {
      assert.equal(path.dirname(root), await fs.realpath(os.tmpdir()));
      assert.ok(path.basename(root).startsWith('notes-security-races-'));
      await fs.rm(root, { recursive: true, force: true });
    },
  };
}
async function createNote(notesRoot: string, title: string) {
  const target = path.join(notesRoot, noteId);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, body(title));
}

test('read refuses to combine a session context with another workspace snapshot', async () => {
  const temp = await fixture();
  const a = path.join(temp.root, 'a');
  const b = path.join(temp.root, 'b');
  await createNote(path.join(a, '.agents/notes'), 'workspace-a');
  await createNote(path.join(b, '.agents/notes'), 'workspace-b');
  let headerCalls = 0;
  const resolver = new WorkspaceResolver({
    header: async () => ({ cwd: ++headerCalls === 1 ? a : b }),
    workspaces: () => [],
  });
  const service = new NotesService(resolver);
  try {
    // A switch during a read must cancel the in-flight request, rather than
    // return B's body paired with A's context (or silently change workspaces).
    await assert.rejects(service.read('s', noteId));
    assert.ok(headerCalls >= 2, 'the test must exercise the session switch');
  } finally {
    service.dispose();
    await temp.cleanup();
  }
});

test('dispose during session resolution prevents late entry or watcher creation', async () => {
  const temp = await fixture();
  let release!: () => void;
  let entered!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const reachedHeader = new Promise<void>(resolve => { entered = resolve; });
  const resolver = new WorkspaceResolver({
    header: async () => { entered(); await gate; return { cwd: temp.root }; },
    workspaces: () => [],
  });
  const service = new NotesService(resolver);
  try {
    const request = service.snapshot('s');
    await reachedHeader;
    service.dispose();
    release();
    await assert.rejects(request);
    assert.deepEqual(service.diagnostics, { entries: 0, watchers: 0, consumers: 0 });
  } finally {
    release();
    service.dispose();
    await temp.cleanup();
  }
});

test('a fresh validation updates checkedAt even when the source is unchanged', async () => {
  const temp = await fixture();
  await createNote(path.join(temp.root, '.agents/notes'), 'inside');
  const resolver = new WorkspaceResolver({
    header: async () => ({ cwd: temp.root }),
    workspaces: () => [{ id: 'w', path: temp.root, sessionIds: ['s'] }],
  });
  const service = new NotesService(resolver);
  try {
    const first = await service.snapshot('s');
    await new Promise(resolve => setTimeout(resolve, 20));
    const result = await service.validation('s');
    assert.equal(result.snapshotVersion, first.snapshotVersion);
    assert.equal(result.sourceVersion, first.sourceVersion);
    assert.ok(Date.parse(result.checkedAt) > Date.parse(first.validation.checkedAt), 'fresh scan must have a fresh validation timestamp');
  } finally {
    service.dispose();
    await temp.cleanup();
  }
});

test('a root replaced after validation cannot expose outside workspace data', async () => {
  const temp = await fixture();
  const project = path.join(temp.root, 'project');
  const root = path.join(project, '.agents/notes');
  const outside = path.join(temp.root, 'outside');
  await createNote(root, 'inside');
  await createNote(outside, 'outside-secret');
  const resolver = new WorkspaceResolver({
    header: async () => ({ cwd: project }),
    workspaces: () => [{ id: 'w', path: project, sessionIds: ['s'] }],
  });
  const service = new NotesService(resolver);
  const originalStat = fs.stat;
  let rootStats = 0;
  let swapped = false;
  try {
    // Deterministic equivalent of another process replacing the root just
    // after the scan's last async stat, before the scanner opens any files.
    fs.stat = (async (target: Parameters<typeof fs.stat>[0], ...args: unknown[]) => {
      const result = await (originalStat as (...args: unknown[]) => Promise<unknown>)(target, ...args);
      if (String(target) === root && ++rootStats === 2) {
        await fs.rename(root, `${root}-old`);
        await fs.symlink(outside, root);
        swapped = true;
      }
      return result;
    }) as typeof fs.stat;
    let result: Awaited<ReturnType<NotesService['snapshot']>> | undefined;
    let rejected = false;
    try { result = await service.snapshot('s'); } catch { rejected = true; }
    assert.ok(swapped, 'the replacement must occur at the scan boundary; update this hook if scanning is refactored');
    if (!rejected) {
      assert.ok(result);
      assert.ok(!JSON.stringify(result).includes('outside-secret'), 'outside content escaped the workspace');
      // A complete snapshot is acceptable only when it came from the captured
      // original directory, not from the replacement symlink.
      if (result.complete) assert.equal(result.notes[0]?.title, 'inside');
    }
  } finally {
    fs.stat = originalStat;
    service.dispose();
    await temp.cleanup();
  }
});
