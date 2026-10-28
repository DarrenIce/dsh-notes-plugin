export interface WorkspaceContext {
  sessionId: string;
  workspaceId: string;
  projectRoot: string;
  notesRoot: string;
  notesPath: string;
  configRevision: string;
  status: 'ready' | 'missing';
  capabilities: { read: true; write: false };
}
export class NotesError extends Error {
  constructor(public readonly code: string, message: string) { super(message); this.name = 'NotesError'; }
}
