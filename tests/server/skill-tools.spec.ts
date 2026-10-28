import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { installNoteAgent } from '../../src/server/note-tools.ts';
import { agentCompatibility } from '../../src/server/agent-feedback.ts';
import { NOTE_SECTION } from '../../src/server/prompt-policy.ts';

const root = process.env.DSH_ROOT ?? '/home/darren/.nvm/versions/node/v24.18.0/lib/node_modules/@deepseek-ai/dsh';
const requireHost = createRequire(path.join(root, 'package.json'));
const load = (name: string) => import(pathToFileURL(requireHost.resolve(name)).href);

test('installed DSH registries enforce scoped skill/prompt and dispatch notes tools', async () => {
  const { Context } = await load('@deepseek-ai/cordis');
  const { default: Skills } = await load('@deepseek-ai/dsh-skill');
  const { default: Prompt } = await load('@deepseek-ai/dsh-system-prompt');
  const { default: Tools } = await load('@deepseek-ai/dsh-tools');
  const { createScope } = await load('@deepseek-ai/dsh-scope');
  const ctx = new Context();
  const prompt = await ctx.plugin(Prompt, {});
  const tools = await ctx.plugin(Tools, {});
  const skills = await ctx.plugin(Skills);
  const agent = { id: 'session-a' }, other = { id: 'session-b' };
  const roots: Record<string, string> = { 'session-a': '/tmp/project-a/decisions', 'session-b': '/tmp/project-b/custom' };
  const resolver = { async resolve(id: string) { if (!roots[id]) throw Error('unknown'); return { sessionId: id, workspaceId:id, notesRoot: roots[id], projectRoot: path.dirname(roots[id]), configRevision: id }; } };
  const notes = [{ id:'implemented/architecture/2026-10-01-choice.md', title:'Choice', lifecycle:'implemented', cls:'architecture', date:'2026-10-01', rawBody:'isolated needle' }];
  const service = {
    async snapshot(id: string) { return { workspaceId:id, notesRoot:roots[id], configRevision:id, notes: id === 'session-a' ? notes : [], snapshotVersion: 1, sourceVersion:'v1', complete:true }; },
    async read(id: string, noteId: string) { return { id: noteId, raw: id, context: await resolver.resolve(id), snapshotVersion:1, sourceVersion:'v1' }; },
    async beginReview(id: string) { return { reviewToken:`token-${id}`, contextRevision:id, snapshotVersion:1, expiresAt:'later' }; },
    async validation(id: string, token?: string) { return { workspaceId:id, configRevision:id, notesRoot:roots[id], reviewToken:token ?? null, complete:true, issues:[] }; },
  };
  let dispose = () => {};
  let pluginContext: any;
  const plugin = await ctx.plugin({ name:'notes-test', inject:['skills','tools','systemPrompt'], apply(scope: any) {
    pluginContext = scope;
    dispose = installNoteAgent({ skills:scope.skills, tools:scope.tools, systemPrompt:scope.systemPrompt,
      workingDirectory: { ensure: async (a: any) => `/actual/${a.id}` } }, service, resolver, { skillRoot:path.resolve('src/skills/dsh-write-notes') });
  } });
  const call = async (name: string, args: unknown, who: any = agent) => {
    const result = await ctx.tools.execute({ callId: 'call', name, arguments: args, agent: who, signal: new AbortController().signal });
    if (result.isError) throw Error(result.error.message);
    return JSON.parse(result.value);
  };
  try {
    const listed = await ctx.skills.get('write-notes-like-deepseek', {cwd:'/actual/session-a',scope:agent});
    assert.equal(listed.provider, 'dsh-write-notes');
    assert.match(listed.content, /无需为每篇笔记另请确认/);
    assert.match(listed.content, /references\/note-format.md/);
    const context = await call('notes_context', {});
    assert.equal(context.context.notesRoot, roots['session-a']);
    assert.equal(context.compatibility.skill.cwd, '/actual/session-a');
    assert.equal(context.compatibility.skillTool, 'not-visible');
    assert.equal(context.compatibility.prompt, 'present');
    assert.equal((await call('notes_search', {query:'needle'})).total, 1);
    assert.equal((await call('notes_search', {query:'needle'}, other)).total, 0);
    const review = await call('notes_begin_review', {});
    assert.equal((await call('notes_validate', {reviewToken:review.review.reviewToken})).validation.reviewToken, 'token-session-a');
    const archive = await call('notes_archive_entry', {id:notes[0].id});
    assert.equal(archive.argv[1], path.join(roots['session-a'], notes[0].id));
    assert.equal(archive.argv[3], roots['session-a']);
    await assert.rejects(call('notes_read', {id:'../../etc/passwd'}));
    await assert.rejects(call('notes_context', {sessionId:'session-b'}));
    const child = {id:'child'};
    const inherited = createScope(pluginContext, child, {parent:agent});
    try {
      const childSkill = await ctx.skills.get('write-notes-like-deepseek', {scope:child});
      assert.equal(childSkill.provider, 'dsh-write-notes');
      assert.ok((await ctx.systemPrompt.assemble({scope:child})).sections.some((section:any)=>section.name===NOTE_SECTION));
      assert.ok(ctx.tools.get('notes_context',child));
    } finally { await inherited.dispose(); }
    const scoped = createScope(pluginContext, agent);
    try {
      scoped.ctx.systemPrompt.section({name:'custom-complete',order:0,text:'complete',complete:true});
      scoped.ctx.skills.register({name:'write-notes-like-deepseek',description:'preset override',source:'preset',content:'other'});
      const diagnostics = await agentCompatibility({ skills:ctx.skills, tools:ctx.tools, systemPrompt:ctx.systemPrompt, workingDirectory:{ensure:async()=>'/actual/session-a'} },agent,new AbortController().signal);
      assert.equal((diagnostics.skill as any).winner.provider, 'runtime');
      assert.equal((diagnostics.skill as any).providerMatches, false);
      assert.equal(diagnostics.prompt, 'absent');
      assert.equal((await ctx.systemPrompt.assemble({scope:agent})).sections.some((section:any)=>section.name===NOTE_SECTION),false);
    } finally { await scoped.dispose(); }
    dispose();
    assert.equal(ctx.tools.get('notes_context', agent), undefined);
    assert.equal(await ctx.skills.get('write-notes-like-deepseek', {scope:agent}), undefined);
  } finally { dispose(); await plugin.dispose(); await skills.dispose(); await tools.dispose(); await prompt.dispose(); }
});
