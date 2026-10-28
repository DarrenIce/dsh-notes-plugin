import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { mkdtemp, rm, cp, mkdir, symlink } from 'node:fs/promises';
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
    ctx.remoteAccess.registerPolicy('contract-reader', { bindings: () => [{ resource: { kind: 'session', id: 'test-session' }, role: { name: 'reader', resource: 'session', actions: ['decisionNotes/context'] } }] });
    const restricted = { ...peer, principal: { kind: 'contract-reader' } };
    assert.equal((await ctx.typertGateway.invoke({ ...request('context', { sessionId: 'test-session' }), peer: restricted })).workspaceId, 'test-workspace');
    await assert.rejects(ctx.typertGateway.invoke({ ...request('context', { sessionId: 'unknown' }), peer: restricted }), error => error.code === 'remote-access/denied');
    await assert.rejects(ctx.typertGateway.invoke(request('context', { sessionId: 'unknown' })));
    const skill = await ctx.skills.get('write-notes-like-deepseek');
    assert.equal(skill.provider, 'dsh-write-notes');
    assert.match(skill.resourceBase.path, /assets\/write-notes-like-deepseek\/?$/);
    assert.ok((await ctx.systemPrompt.assemble()).sections.some(section => section.name === 'dsh-write-notes:policy'));
    assert.ok(ctx.tools.schemas().some(tool => tool.name === 'notes_context'));
    const abort = new AbortController();
    const stream = await ctx.typertGateway.stream(request('changes', { sessionId: 'test-session' }, abort.signal));
    const iterator = stream[Symbol.asyncIterator]();
    assert.equal((await iterator.next()).value.type, 'snapshot');
    abort.abort();
    await iterator.return();
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
