export interface ParsedNote {
  id: string;
  slug: string;
  lifecycle: string;
  cls: string;
  date: string;
  title: string;
  status: string;
  problem: string;
  decision: string;
  alternatives: string;
  consequences: string;
  outLinks: string[];
  rawBody: string;
}
export function resolveNoteLink(id: string, href: string): string;
export function parseNote(raw: string, id: string, ids?: ReadonlySet<string>): ParsedNote;
