import { parseNote, resolveNoteLink } from '../../skills/write-notes-like-deepseek/scripts/lib/parser.mjs';

export interface NoteSource { id: string; raw: string }
export interface BoardNote {
  id: string; slug: string; lifecycle: string; cls: string; date: string; title: string;
  problem: string; decision: string; alternatives: string; consequences: string;
  outLinks: string[]; rawBody: string;
}

/** Use full, root-relative identities for every association. */
export function makeBoardNotes(sources: readonly NoteSource[]): BoardNote[] {
  const ids = new Set(sources.map(note => note.id));
  return sources.map(note => parseNote(note.raw, note.id, ids) as BoardNote)
    .sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
}

export function noteTarget(id: string, href: string, ids: ReadonlySet<string>): string | undefined {
  const target = resolveNoteLink(id, href);
  return target && ids.has(target) ? target : undefined;
}

export function externalTarget(href: string): string | undefined {
  const value = href.trim();
  if (/[\u0000-\u0020\u007f]/.test(value)) return;
  try {
    const url = new URL(value);
    return ['http:', 'https:', 'mailto:'].includes(url.protocol) ? value : undefined;
  } catch { return; }
}

export function incomingCounts(notes: readonly BoardNote[]): Map<string, number> {
  const result = new Map<string, number>();
  for (const note of notes) for (const target of note.outLinks) result.set(target, (result.get(target) || 0) + 1);
  return result;
}
