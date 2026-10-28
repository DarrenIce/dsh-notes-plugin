import path from 'node:path';
import { installSkillProvider } from './skill-provider.js';
import { installPromptPolicy } from './prompt-policy.js';
import { agentCompatibility } from './agent-feedback.js';

export interface NoteAgentService {
  snapshot(sid: string): Promise<any>;
  read(sid: string, id: string): Promise<any>;
  beginReview(sid: string): Promise<any>;
  validation(sid: string, token?: string): Promise<any>;
}
export interface NoteAgentResources { skillRoot: string }

type Args = Record<string, unknown>;
type Exec = { agent?: { id: string }; signal: AbortSignal };
const stringProperty = { type: 'string' };
const output = { schema: { type: 'string' }, render: (_args: unknown, value: string) => [{ type: 'text', text: value }] };
function requireString(args: Args, key: string, max = 4096): string {
  const value = args[key];
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`invalid ${key}`);
  return value;
}
function checkArgs(args: unknown, allowed: string[]): asserts args is Args {
  if (!args || typeof args !== 'object' || Array.isArray(args) || Object.keys(args).some(key => !allowed.includes(key))) throw new Error('invalid tool arguments');
}
function noteId(value: string): string {
  if (!/^(?:proposed|implemented|rejected|archived)\/(?:feature|bug-fix|simplification|architecture|process|testing)\/[^/\\]+\.md$/.test(value) || value.includes('\0') || value.split('/').some(part => part === '..')) throw new Error('invalid note id');
  return value;
}
function assertContext(context: any, value: any) {
  if (value.notesRoot !== context.notesRoot || value.configRevision !== context.configRevision || value.workspaceId !== context.workspaceId) {
    throw new Error('笔记工作区配置已变更，请重试。');
  }
}
function session(exec: Exec) {
  exec.signal.throwIfAborted();
  if (!exec.agent || typeof exec.agent.id !== 'string' || !exec.agent.id) throw new Error('notes tools require a calling agent session');
  return exec.agent.id;
}

/** Register globally from the host plugin's unscoped apply, with resources from the packaged skill directory. */
export function installNoteAgent(ctx: any, service: NoteAgentService, resolver: { resolve(sid: string): Promise<any> }, resources: NoteAgentResources): () => void {
  if (!resources || !path.isAbsolute(resources.skillRoot)) throw new Error('an absolute packaged skillRoot is required');
  const disposers: Array<() => void> = [];
  function register(name: string, description: string, props: Record<string, unknown>, required: string[], run: (args: Args, exec: Exec, sid: string) => Promise<unknown>) {
    const definition = {
      name, description, parameters: { type: 'object', properties: props, required, additionalProperties: false }, output,
      async execute(args: unknown, exec: Exec) {
        const sid = session(exec);
        checkArgs(args, Object.keys(props));
        const value = await run(args, exec, sid);
        exec.signal.throwIfAborted();
        return JSON.stringify(value);
      },
    };
    disposers.push(ctx.tools.register(definition));
  }
  try {
    disposers.push(installSkillProvider(ctx, resources.skillRoot));
    disposers.push(installPromptPolicy(ctx));
    register('notes_context', '返回当前会话已授权工作区、实际笔记根、技能资源及兼容性诊断；不创建目录。', {}, [], async (_args, exec, sid) => ({
      context: await resolver.resolve(sid), resourceBase: resources.skillRoot,
      compatibility: await agentCompatibility(ctx, exec.agent, exec.signal),
    }));
    register('notes_begin_review', '建立显式笔记检查区间并返回 session 绑定的 reviewToken；这不是宿主任务边界。', {}, [], async (_args, _exec, sid) => {
      const context = await resolver.resolve(sid);
      const review = await service.beginReview(sid);
      assertContext(context, await resolver.resolve(sid));
      if (review.contextRevision !== context.configRevision) throw new Error('笔记工作区配置已变更，请重试。');
      return { context, review, guidance: '后续检查使用同一 reviewToken；无法证明操作者的问题保持来源不确定。' };
    });
    register('notes_search', '在当前笔记根检索关键字，返回摘要而非全部正文。', { query: stringProperty }, ['query'], async (args, _exec, sid) => {
      const query = requireString(args, 'query', 256).toLocaleLowerCase();
      const context = await resolver.resolve(sid);
      const snapshot = await service.snapshot(sid);
      assertContext(context, snapshot);
      assertContext(context, await resolver.resolve(sid));
      const matches = snapshot.notes.filter((note: any) => note.lifecycle !== 'archived' && `${note.id}\n${note.title}\n${note.rawBody}`.toLocaleLowerCase().includes(query));
      return { context, snapshotVersion: snapshot.snapshotVersion, sourceVersion: snapshot.sourceVersion, complete: snapshot.complete,
        total: matches.length, matches: matches.slice(0, 50).map(({ id, title, lifecycle, cls, date }: any) => ({ id, title, lifecycle, cls, date })) };
    });
    register('notes_read', '按完整根内相对 id 读取一篇笔记。', { id: stringProperty }, ['id'], async (args, _exec, sid) => {
      await resolver.resolve(sid);
      return service.read(sid, noteId(requireString(args, 'id')));
    });
    register('notes_validate', '获取当前最新校验结果；传入 begin_review 返回的 reviewToken 以比较检查区间。', { reviewToken: stringProperty }, [], async (args, _exec, sid) => {
      const token = args.reviewToken === undefined ? undefined : requireString(args, 'reviewToken');
      const context = await resolver.resolve(sid);
      const validation = await service.validation(sid, token);
      assertContext(context, validation);
      assertContext(context, await resolver.resolve(sid));
      return { context, validation, guidance: '收尾前确保结果完整且覆盖最后一次笔记修改；仅修复与任务相关且有证据的本次问题，报告历史或来源不确定问题。' };
    });
    register('notes_archive_entry', '取得归档 CLI 入口；本工具不执行写入，须通过 agent 自身授权的命令工具执行。', { id: stringProperty, successor: stringProperty }, ['id'], async (args, _exec, sid) => {
      const id = noteId(requireString(args, 'id'));
      if (!id.startsWith('implemented/')) throw new Error('only implemented notes can be archived');
      const successor = args.successor === undefined ? undefined : noteId(requireString(args, 'successor'));
      if (successor?.startsWith('archived/')) throw new Error('successor must be active');
      const context = await resolver.resolve(sid);
      const argv = [path.join(resources.skillRoot, 'scripts', 'archive-agent-note.ts'), path.join(context.notesRoot, id), '--root', context.notesRoot];
      if (successor) argv.push('--superseded-by', path.join(context.notesRoot, successor));
      return { context, executable: process.execPath, argv, guidance: '只在当前 agent 的权限允许时，通过原有命令工具执行；随后检查入站链接并重新校验。' };
    });
  } catch (error) {
    for (const dispose of disposers.reverse()) dispose();
    throw error;
  }
  let disposed = false;
  return () => { if (!disposed) { disposed = true; for (const dispose of disposers.reverse()) dispose(); } };
}
