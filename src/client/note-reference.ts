export interface InsertionSpan { readonly start: number; readonly end: number; readonly draftRev: number }
export interface DraftActions {
  captureInsertion(): InsertionSpan;
  insertText(text: string, span: InsertionSpan): boolean;
}
export interface ReferenceIdentity { sessionId: string; configRevision: string; operation: number }
export interface NoteReference { title: string; notesPath: string; id: string }

function relativePath(value: string): boolean {
  return !!value && !value.startsWith('/') && !/[\\\u0000-\u001f\u007f]/.test(value)
    && value.split('/').every(part => part !== '..' && part !== '' && part !== '.');
}

/** Inserts only into the captured session and revision; never replaces the selection. */
export function insertNoteReference(actions: DraftActions, identity: ReferenceIdentity, current: () => ReferenceIdentity | undefined, note: NoteReference): boolean {
  const matches = () => {
    const now = current();
    return !!now && now.sessionId === identity.sessionId && now.configRevision === identity.configRevision && now.operation === identity.operation;
  };
  if (!matches() || !relativePath(note.notesPath) || !relativePath(note.id)) return false;
  try {
    const span = actions.captureInsertion();
    const end = Math.max(span.start, span.end);
    if (!matches()) return false;
    const title = note.title.replace(/[\r\n\u0000-\u001f\u007f]+/g, ' ').trim();
    return actions.insertText(`\n笔记：${title}\n路径：${note.notesPath}/${note.id}\n`, { start: end, end, draftRev: span.draftRev });
  } catch { return false; }
}
