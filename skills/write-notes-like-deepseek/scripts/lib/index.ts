import { readNote, listFiles } from './fs.ts';
import { parseNote } from './parser.mjs';
import { validateTree } from './validate-tree.ts';
import { validateFormat } from './format.ts';
import { validateArchive, type ArchiveBaseline } from './validate-archive.ts';
export type { ArchiveBaseline } from './validate-archive.ts';
export { readNote, safePath } from './fs.ts';
export { parseNote, resolveNoteLink } from './parser.mjs';
export { archiveNote, withSealMutex } from './archive.ts';
export type { SealMutex } from './archive.ts';
export { validateTree, validateFormat, validateArchive };

export function scanNotes(root: string) {
  const ids = new Set(listFiles(root).filter(id => {
    const parts = id.split('/');
    return id.endsWith('.md') && parts.length >= 3 && ['implemented', 'proposed', 'rejected', 'archived'].includes(parts[0]);
  }));
  const notes = [...ids].map(id => parseNote(readNote(root, id), id, ids));
  return { notes };
}
export function validateNotes(root: string, options: { baseRef?: string; archiveBaseline?: ArchiveBaseline } = {}) {
  const errors: string[] = [];
  const warnings: string[] = [];
  let complete = true;
  for (const [name, check] of [
    ['tree', () => validateTree(root)],
    ['format', () => validateFormat(root)],
    ['archived', () => validateArchive(root, options)],
  ] as const) {
    try {
      const result = check();
      for (const error of result.errors) {
        const message = name === 'archived' ? `archived: ${error}` : error;
        if (!errors.includes(message)) errors.push(message);
      }
      if ('warnings' in result) warnings.push(...result.warnings);
    } catch (error) {
      complete = false;
      errors.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const issues = errors.map(message => {
    const group = message.split(':')[0];
    const detail = message.slice(group.length + 1).trim();
    const match = /^(.*?)\s+(?:—|->)/.exec(detail);
    const description = match ? detail.slice(match[0].length) : detail;
    const rules: Array<[RegExp, string]> = [
      [/centralized Agent Note indexes/, 'central-index'], [/unknown lifecycle/, 'unknown-lifecycle'],
      [/expected \{lifecycle\}/, 'depth'], [/unknown class/, 'unknown-class'], [/filename must/, 'filename'],
      [/target file does not exist/, 'missing-target'], [/line 1 must/, 'title'], [/line 2 must/, 'blank-line-2'],
      [/line 3 must/, 'status'], [/line 4 must/, 'line-4'], [/line 5 must/, 'line-5'],
      [/Status: line must/, 'status-count'], [/first section/, 'first-section'], [/missing one of/, 'required-section'],
      [/banned in implemented/, 'banned-section'], [/both ## Alternatives/, 'alternatives-conflict'],
      [/missing ## Alternatives/, 'alternatives-missing'], [/grandfather comment only/, 'grandfather-date'],
      [/missing seal/, 'seal-missing'], [/seal mismatch/, 'seal-mismatch'], [/sealed entry has no file/, 'sealed-file-missing'],
      [/append-only/, 'seal-baseline'], [/not valid JSON/, 'manifest-json'], [/manifest\.json missing/, 'manifest-missing'],
    ];
    const code = rules.find(([pattern]) => pattern.test(description))?.[1] || 'read-error';
    const path = match?.[1] || '';
    const anchor = code === 'required-section' ? (description.match(/"([^"]+)"/)?.[1] || code)
      : code === 'banned-section' ? description.slice(description.indexOf(':') + 1).trim()
      : code === 'missing-target' ? (description.match(/^"([^"]+)"/)?.[1] || code)
      : code;
    return { rule: `${group}.${code}`, path: group === 'archived' && path && !path.startsWith('archived/') ? `archived/${path}` : path, anchor, message };
  });
  return { issues, warnings, complete };
}
