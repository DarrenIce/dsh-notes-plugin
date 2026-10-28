import { createHash } from 'node:crypto';
import path from 'node:path';
import { NotesError } from '../contracts/workspace.js';

export interface NotesConfig {
  workspaceOverrides?: Record<string, { notesPath: string }>;
  pollIntervalMs?: number;
}
export function validateNotesPath(value: string): string {
  if (typeof value !== 'string' || !value.trim() || value.includes('\0') || value.includes('\\') || path.isAbsolute(value)
    || value.split('/').some(part => part === '..') || path.posix.normalize(value) === '.') {
    throw new NotesError('invalid-config', '笔记目录必须是工作区内的相对目录，不能包含上级路径。');
  }
  return path.posix.normalize(value).replace(/\/$/, '');
}
export class NotesConfiguration {
  private config: NotesConfig;
  private listeners = new Set<() => void>();
  constructor(config: NotesConfig = {}) { this.config = this.check(config); }
  private check(config: NotesConfig): NotesConfig {
    const workspaceOverrides: NonNullable<NotesConfig['workspaceOverrides']> = Object.create(null);
    for (const [id, override] of Object.entries(config.workspaceOverrides ?? {})) {
      workspaceOverrides[id] = { notesPath: validateNotesPath(override.notesPath) };
    }
    return { workspaceOverrides, pollIntervalMs: Math.max(250, Math.min(30000, config.pollIntervalMs ?? 1500)) };
  }
  get pollIntervalMs() { return this.config.pollIntervalMs!; }
  pathFor(workspaceId: string) { return this.config.workspaceOverrides?.[workspaceId]?.notesPath ?? '.agents/notes'; }
  revisionFor(workspaceId: string) {
    return createHash('sha256').update(JSON.stringify([workspaceId, this.pathFor(workspaceId)])).digest('hex').slice(0, 16);
  }
  update(config: NotesConfig) { this.config = this.check(config); for (const listener of this.listeners) listener(); }
  subscribe(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
}
