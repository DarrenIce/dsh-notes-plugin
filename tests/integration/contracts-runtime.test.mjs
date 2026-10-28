import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { mkdtemp, rm, cp, mkdir, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';

const root = resolve(process.env.DSH_ROOT ?? '/home/darren/.nvm/versions/node/v24.18.0/lib/node_modules/@deepseek-ai/dsh');
const hostRequire = createRequire(join(root, 'package.json'));
const load = async name => import(pathToFileURL(hostRequire.resolve(name)).href);

test('built plugin runs in real Cordis Gateway with host registries', async () => {
  const [{ Context }, { default: Typert }, { default: Access }, { default: Gateway }, { default: Skills }, { default: Prompt }, { default: Tools }] = await Promise.all([
    load('@deepseek-ai/cordis'), load('@deepseek-ai/dsh-typert-registry'), load('@deepseek-ai/dsh-api-remote-access'), load('@deepseek-ai/dsh-api-gateway'), load('@deepseek-ai/dsh-skill'), load('@deepseek-ai/dsh-system-prompt'), load('@deepseek-ai/dsh-tools'),
  ]);
  const project = await mkdtemp(join(tmpdir(), 'dsh-notes-contract-'));
  const staging = join(project, 'package');
  await mkdir(staging);
  for (const item of ['lib', 'assets/write-notes-like-deepseek', 'package.json', 'cordis.patch.yml']) {
    await cp(resolve(item), join(staging, item), { recursive: true });
  }
  await symlink(join(root, 'node_modules'), join(staging, 'node_modules'), 'dir');
  const plugin = await import(pathToFileURL(join(staging, 'lib/index.js')).href);
  const ctx = new Context();
  const fibers = [];
  const add = async (entry, config) => { const fiber = await ctx.plugin(entry, config); fibers.push(fiber); return fiber; };
  const controller = new AbortController();
  const peer = { id: 'contract-test', ctx, principal: { kind: 'owner' }, signal: controller.signal, interactions: 'none', dispose: async () => {} };
  try {
    await add(Typert); await add(Access); await add(Gateway); await add(Skills); await add(Prompt); await add(Tools);
    await add({ name: 'test-host', apply(scope) {
      scope.provide('sessions', { get: id => id === 'test-session' ? { header: { cwd: project } } : undefined });
      scope.provide('workspaceRegistry', { list: () => [{ id: 'test-workspace', path: project, sessionIds: ['test-session'] }] });
      scope.provide('workingDirectory', { ensure: async () => project });
    } });
    const mounted = await add(plugin);
    assert.ok(ctx.decisionNotes, 'plugin service should mount');
    const request = (method, args, signal) => ({ namespace: 'decisionNotes', method, args, signal, peer });
    const context = await ctx.typertGateway.invoke(request('context', { sessionId: 'test-session' }));
    assert.equal(context.workspaceId, 'test-workspace');
    assert.equal(context.status, 'missing');
    let grant = true;
    ctx.remoteAccess.registerPolicy('contract-reader', { bindings: () => grant ? [{ resource: { kind: 'session', id: 'test-session' }, role: { name: 'reader', resource: 'session', actions: ['decisionNotes/context', 'decisionNotes/changes'] } }] : [] });
    const restricted = { ...peer, principal: { kind: 'contract-reader' } };
    assert.equal((await ctx.typertGateway.invoke({ ...request('context', { sessionId: 'test-session' }), peer: restricted })).workspaceId, 'test-workspace');
    await assert.rejects(ctx.typertGateway.invoke({ ...request('context', { sessionId: 'unknown' }), peer: restricted }), error => error.code === 'remote-access/denied');
    await assert.rejects(ctx.typertGateway.invoke(request('context', { sessionId: 'unknown' })));
    const skill = await ctx.skills.get('write-notes-like-deepseek');
    assert.equal(skill.provider, 'dsh-write-notes');
    assert.match(skill.resourceBase.path, /assets\/write-notes-like-deepseek\/?$/);
    assert.ok((await ctx.systemPrompt.assemble()).sections.some(section => section.name === 'dsh-write-notes:policy'));
    const override = await add({ name: 'contract-overrides', inject: ['skills', 'systemPrompt'], apply(scope) {
      scope.skills.registerProvider(() => ({ name: 'contract-project', async list() { return [{ name: 'write-notes-like-deepseek', description: 'override', invocation: { modelInvocable: true, userInvocable: true }, source: 'project-agents', provider: 'contract-project', rank: 1, locator: 'override' }]; }, async get(candidate) { const { rank, locator, ...summary } = candidate; return { ...summary, content: 'project override' }; } }));
      scope.systemPrompt.section({ name: 'contract-complete', order: 0, text: 'complete prompt', complete: true });
    } });
    assert.equal((await ctx.skills.get('write-notes-like-deepseek')).provider, 'contract-project');
    assert.deepEqual((await ctx.systemPrompt.assemble()).sections.map(section => section.name), ['contract-complete']);
    await override.dispose();
    assert.equal((await ctx.skills.get('write-notes-like-deepseek')).provider, 'dsh-write-notes');
    assert.ok((await ctx.systemPrompt.assemble()).sections.some(section => section.name === 'dsh-write-notes:policy'));
    assert.ok(ctx.tools.schemas().some(tool => tool.name === 'notes_context'));
    const abort = new AbortController();
    const stream = await ctx.typertGateway.stream(request('changes', { sessionId: 'test-session' }, abort.signal));
    const iterator = stream[Symbol.asyncIterator]();
    assert.equal((await iterator.next()).value.type, 'snapshot');
    abort.abort();
    await iterator.return();
    await add({ name: 'test-connection', apply(scope) {
      scope.provide('connection', { interactions: 'none', isLoopback: true, generation: { getSnapshot: () => undefined, subscribe: () => () => {} }, rpc: {
        async call(_channel, endpoint, payload, signal) {
          const [namespace, method] = endpoint.split('/');
          try { return { ok: true, value: await ctx.typertGateway.invoke({ namespace, method, args: payload.args, peer, signal }) }; }
          catch (error) { return { ok: false, error: { code: error.code ?? 'internal', message: error.message } }; }
        },
        async *open(_channel, endpoint, payload, signal) {
          const [namespace, method] = endpoint.split('/');
          yield* await ctx.typertGateway.stream({ namespace, method, args: payload.args, peer, signal });
        },
      } });
    } });
    await add(await load('@deepseek-ai/dsh-api-gateway/client'));
    const { createDecisionNotesClient, mountDecisionNotesStream } = await import('../../src/contracts/plugin.ts');
    const client = createDecisionNotesClient(ctx.connection);
    assert.equal((await client.context('test-session')).workspaceId, 'test-workspace');
    const mountedStream = await mountDecisionNotesStream(ctx.remote);
    const clientStream = mountedStream.open('test-session');
    const clientIterator = clientStream[Symbol.asyncIterator]();
    assert.equal((await clientIterator.next()).value.type, 'snapshot');
    const notesDirectory = join(project, '.agents/notes/implemented/architecture');
    await mkdir(notesDirectory, { recursive: true });
    await writeFile(join(notesDirectory, '2026-01-01-contract.md'), '# Contract test\n\n## 决策\n\n测试变更。\n');
    const observed = await Promise.race([
      (async () => { for (;;) { const item = await clientIterator.next(); if (item.done) throw new Error('stream ended'); if (item.value.type === 'snapshot' && item.value.snapshot.notes.length) return item.value; } })(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('watch timeout')), 8000).unref()),
    ]);
    assert.equal(observed.snapshot.notes[0].id, 'implemented/architecture/2026-01-01-contract.md');
    await clientStream.dispose();
    const reopened = mountedStream.open('test-session');
    assert.equal((await reopened[Symbol.asyncIterator]().next()).value.snapshot.notes.length, 1);
    await reopened.dispose();
    const restrictedAbort = new AbortController();
    const restrictedStream = await ctx.typertGateway.stream({ ...request('changes', { sessionId: 'test-session' }, restrictedAbort.signal), peer: restricted });
    const restrictedIterator = restrictedStream[Symbol.asyncIterator]();
    assert.equal((await restrictedIterator.next()).value.type, 'snapshot');
    grant = false;
    await writeFile(join(notesDirectory, '2026-01-01-contract.md'), '# Changed after revocation\n');
    await assert.rejects(Promise.race([
      restrictedIterator.next(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('watch timeout')), 8000).unref()),
    ]), /Session access revoked/);
    restrictedAbort.abort();
    await restrictedIterator.return();
    await mountedStream.dispose();
    await mounted.dispose();
    assert.equal(ctx.decisionNotes, undefined);
    assert.equal(await ctx.skills.get('write-notes-like-deepseek'), undefined);
    assert.ok(!ctx.tools.schemas().some(tool => tool.name === 'notes_context'));
    assert.ok(!(await ctx.systemPrompt.assemble()).sections.some(section => section.name === 'dsh-write-notes:policy'));
  } finally {
    controller.abort();
    for (const fiber of fibers.reverse()) await fiber.dispose();
    assert.ok(project.startsWith(join(tmpdir(), 'dsh-notes-contract-')) && !project.slice(tmpdir().length + 1).includes(sep));
    await rm(project, { recursive: true, force: true });
  }
});
