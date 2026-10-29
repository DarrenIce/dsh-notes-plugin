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
  return sources.map(note => parseNote(note.raw, note.id, ids) as BoardNote).sort(byDateDesc);
}

/** Total order so equal dates stay stable across snapshot reloads. */
export function byDateDesc(a: BoardNote, b: BoardNote): number {
  return (b.date || '').localeCompare(a.date || '') || a.id.localeCompare(b.id);
}
export function byDateAsc(a: BoardNote, b: BoardNote): number {
  return (a.date || '').localeCompare(b.date || '') || a.id.localeCompare(b.id);
}

/** Prose projection for compact board cards; never interpreted as markup. */
export function plainText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]*>/g, '')
    .replace(/\*\*|__|[*`>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
export function excerpt(markdown: string, limit: number): string {
  const text = plainText(markdown);
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

export interface PitfallEntry {
  noteId: string; slug: string; title: string; cls: string;
  discarded: string; crux: string; winner: string;
}

/** One dossier per rejected proposal and per discarded alternative. */
export function pitfallEntries(notes: readonly BoardNote[]): PitfallEntry[] {
  const entries: PitfallEntry[] = [];
  for (const note of notes) {
    const base = { noteId: note.id, slug: note.slug, title: note.title, cls: note.cls };
    if (note.lifecycle === 'rejected') {
      const status = note.rawBody.replace(/\r\n?/g, '\n').split('\n').find(line => /^Status:\s*rejected/i.test(line)) || '';
      const crux = status.replace(/^Status:\s*rejected\s*[—–-]\s*/i, '').trim() || plainText(note.problem) || '审慎否决，防止重犯。';
      entries.push({ ...base, discarded: `[已否决提案] ${note.title}`, crux, winner: '提案直接否决' });
    }
    if (!note.alternatives) continue;
    for (const part of note.alternatives.split(/\n(?=###? |- )/)) {
      const clean = plainText(part).replace(/^[-–—* ]+/, '').trim();
      if (clean.length <= 5) continue;
      const colon = clean.search(/[：:]/);
      const separable = colon > 0 && colon < 35;
      entries.push({
        ...base,
        discarded: separable ? clean.slice(0, colon) : clean.slice(0, 45),
        crux: separable ? clean.slice(colon + 1).trim() || clean : clean,
        winner: `采纳决策: ${note.title}`,
      });
    }
  }
  return entries;
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
