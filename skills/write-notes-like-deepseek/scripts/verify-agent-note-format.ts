import { resolve } from 'node:path';
import { agentNoteRoot } from './agent-note-tree.ts';
import { validateFormat } from './lib/format.ts';
const idx = process.argv.indexOf('--root');
if (idx >= 0 && !process.argv[idx + 1]) throw new Error('--root requires a path');
const { notes, errors } = validateFormat(idx < 0 ? agentNoteRoot : resolve(process.argv[idx + 1]));
if (errors.length) { for (const e of errors) console.error(e); process.exitCode = 1; }
else console.log(`ok: ${notes.length} note(s) verified`);
