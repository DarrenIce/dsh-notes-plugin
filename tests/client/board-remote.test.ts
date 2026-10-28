import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { watchBoard } from '../../src/client/board-remote.ts';

const tick = () => new Promise(resolve => setImmediate(resolve));
const context = { sessionId: 's', workspaceId: 'w', projectRoot: '/p', notesRoot: '/p/n', notesPath: 'n', configRevision: '1', status: 'ready', capabilities: { read: true, write: false } } as const;
const snapshot = (v: number) => ({ workspaceId: 'w', projectRoot: '/p', notesRoot: '/p/n', configRevision: '1', snapshotVersion: v, sourceVersion: String(v), complete: true, status: 'ready', notes: [], validation: { workspaceId: 'w', notesRoot: '/p/n', configRevision: '1', rulesVersion: '1', snapshotVersion: v, sourceVersion: String(v), complete: true, issues: [], warnings: [], checkedAt: '' } } as const);

test('late snapshots do not replace newer versions and dispose blocks pending results', async () => {
  let release!: (value: any) => void;
  const pending = new Promise<any>(resolve => { release = resolve; });
  const seen: number[] = [];
  const remote = { context: async () => context, snapshot: async () => snapshot(2), async *changes(_id: string, _signal: AbortSignal) { yield { type: 'snapshot' as const, snapshot: snapshot(1) }; yield await pending; } };
  const dispose = watchBoard(remote, 's', state => { if (state.snapshot) seen.push(state.snapshot.snapshotVersion); });
  await tick();
  assert.deepEqual(seen, [2]);
  dispose(); release({ type: 'snapshot', snapshot: snapshot(3) }); await tick();
  assert.deepEqual(seen, [2]);
});

test('invalidation reloads the context before publishing the new configuration', async () => {
  let calls = 0;
  const seen: number[] = [];
  const remote = { context: async () => { calls++; return context; }, snapshot: async () => snapshot(calls), async *changes(_id: string, signal: AbortSignal) { if (calls === 1) yield { type: 'invalidated' as const, message: 'changed' }; else await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true })); } };
  const dispose = watchBoard(remote, 's', state => { if (state.snapshot) seen.push(state.snapshot.snapshotVersion); });
  await tick();
  assert.deepEqual(seen, [1, 2]);
  dispose();
});
