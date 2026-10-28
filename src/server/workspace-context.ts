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
  constructor(readonly host: WorkspaceHost, readonly configuration = new NotesConfiguration()) {}
  async resolve(sessionId: string): Promise<WorkspaceContext> {
    if (typeof sessionId !== 'string' || !sessionId || sessionId.length > 256) throw new NotesError('invalid-session', '无效会话。');
    const header = await this.host.header(sessionId);
    if (!header || !header.cwd || !path.isAbsolute(header.cwd)) throw new NotesError('unknown-session', '会话不存在或没有有效的工作区路径。');
    const projectRoot = await fs.realpath(header.cwd);
    if (!(await fs.stat(projectRoot)).isDirectory()) throw new NotesError('missing-workspace', '工作区目录不可用。');
    const memberships = this.host.workspaces().filter(workspace => workspace.sessionIds.includes(sessionId));
    if (memberships.length > 1) throw new NotesError('ambiguous-workspace', '会话同时属于多个工作区。');
    const workspace = memberships[0];
    if (workspace && await fs.realpath(workspace.path) !== projectRoot) throw new NotesError('workspace-mismatch', '会话与登记工作区的路径不一致。');
    const workspaceId = workspace?.id ?? `session-root:${projectRoot}`;
    const notesPath = this.configuration.pathFor(workspaceId);
    const notesRoot = path.resolve(projectRoot, notesPath);
    const status = await confinedPath(projectRoot, notesRoot);
    return { sessionId, workspaceId, projectRoot, notesRoot, notesPath, status,
      configRevision: this.configuration.revisionFor(workspaceId), capabilities: { read: true, write: false } };
  }
}
