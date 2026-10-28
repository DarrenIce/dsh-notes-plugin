import fs from 'node:fs/promises';
import path from 'node:path';
import { NotesError, type WorkspaceContext } from '../contracts/workspace.js';
import { NotesConfiguration } from './config.js';

export interface WorkspaceHost {
  header(sessionId: string): Promise<{ cwd?: string } | undefined>;
  workspaces(): readonly { id: string; path: string; sessionIds: readonly string[] }[];
}
export function isWithin(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}
export async function confinedPath(projectRoot: string, target: string): Promise<'ready' | 'missing'> {
  if (!isWithin(projectRoot, target)) throw new NotesError('path-escape', '笔记目录越出工作区。');
  let cursor = projectRoot;
  for (const part of path.relative(projectRoot, target).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, part);
    try {
      const real = await fs.realpath(cursor);
      if (!isWithin(projectRoot, real)) throw new NotesError('path-escape', '符号链接指向工作区之外。');
      if (!(await fs.stat(cursor)).isDirectory()) throw new NotesError('not-directory', '笔记路径中的一项不是目录。');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        try { if ((await fs.lstat(cursor)).isSymbolicLink()) throw new NotesError('path-escape', '笔记路径包含失效符号链接。'); }
        catch (inner) { if ((inner as NodeJS.ErrnoException).code !== 'ENOENT') throw inner; }
        return 'missing';
      }
      if ((error as NodeJS.ErrnoException).code === 'EACCES') throw new NotesError('permission-denied', '无法读取笔记目录。');
      throw error;
    }
  }
  return 'ready';
}
export class WorkspaceResolver {
  private readonly roots = new Map<string,{cwd:string;projectRoot:string}>();
  constructor(readonly host: WorkspaceHost, readonly configuration = new NotesConfiguration()) {}
  async resolve(sessionId: string): Promise<WorkspaceContext> {
    if (typeof sessionId !== 'string' || !sessionId || sessionId.length > 256) throw new NotesError('invalid-session', '无效会话。');
    const header = await this.host.header(sessionId);
    if (!header || !header.cwd || !path.isAbsolute(header.cwd)) throw new NotesError('unknown-session', '会话不存在或没有有效的工作区路径。');
    const originalRoot = path.resolve(header.cwd);
    const projectRoot = await fs.realpath(header.cwd);
    const pinned = this.roots.get(sessionId);
    if (pinned && (pinned.cwd !== header.cwd || pinned.projectRoot !== projectRoot)) throw new NotesError('workspace-mismatch','会话项目根已被替换或重定向。');
    if (!(await fs.stat(projectRoot)).isDirectory()) throw new NotesError('missing-workspace', '工作区目录不可用。');
    const workspaces = this.host.workspaces();
    const memberships = workspaces.filter(workspace => workspace.sessionIds.includes(sessionId));
    if (memberships.length > 1) throw new NotesError('ambiguous-workspace', '会话同时属于多个工作区。');
    let workspace = memberships[0];
    // Workspace.path is the registry's durable canonical identity, not a path to re-realpath.
    if (workspace && workspace.path !== projectRoot) throw new NotesError('workspace-mismatch', '会话与登记工作区的路径不一致。');
    if (!workspace) {
      const byOriginal = workspaces.filter(candidate => candidate.path === originalRoot);
      if (byOriginal.some(candidate => candidate.path !== projectRoot)) throw new NotesError('workspace-mismatch','登记的项目根已被符号链接重定向。');
      const byRoot = workspaces.filter(candidate => candidate.path === projectRoot);
      if (byRoot.length > 1) throw new NotesError('ambiguous-workspace', '同一项目根对应多个工作区，无法确定笔记配置。');
      workspace = byRoot[0];
      if (!workspace && originalRoot !== projectRoot) throw new NotesError('workspace-mismatch','未登记会话不能以符号链接作为项目根。');
    }
    const workspaceId = workspace?.id ?? `session-root:${projectRoot}`;
    const notesPath = this.configuration.pathFor(workspaceId);
    const configRevision = this.configuration.revisionFor(workspaceId);
    const notesRoot = path.resolve(projectRoot, notesPath);
    const status = await confinedPath(projectRoot, notesRoot);
    if (this.configuration.revisionFor(workspaceId) !== configRevision) throw new NotesError('stale-config', '解析期间笔记目录配置发生变化，请重试。');
    const previous = this.roots.get(sessionId);
    if (previous && (previous.cwd !== header.cwd || previous.projectRoot !== projectRoot)) throw new NotesError('workspace-mismatch','并发解析发现会话项目根不一致。');
    this.roots.set(sessionId,{cwd:header.cwd,projectRoot});
    return { sessionId, workspaceId, projectRoot, notesRoot, notesPath, status,
      configRevision, capabilities: { read: true, write: false } };
  }
}
