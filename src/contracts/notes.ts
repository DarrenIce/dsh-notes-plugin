import type { WorkspaceContext } from './workspace.js';
import type { ValidationResult } from './validation.js';
export interface Note {
  id: string; slug: string; lifecycle: string; cls: string; date: string; title: string;
  status: string; problem: string; decision: string; alternatives: string; consequences: string;
  outLinks: string[]; rawBody: string;
}
export interface NoteSnapshot {
  workspaceId: string; projectRoot: string; notesRoot: string; configRevision: string;
  snapshotVersion: number; sourceVersion: string; checkoutVersion?: string; complete: boolean;
  status: 'ready' | 'missing' | 'error'; message?: string; notes: Note[];
  validation: ValidationResult;
}
export interface NoteDocument { id: string; raw: string; context: WorkspaceContext; snapshotVersion: number; sourceVersion: string }
export type NotesChange = { type: 'snapshot'; snapshot: NoteSnapshot } | { type: 'invalidated'; message: string } | { type: 'error'; message: string };
