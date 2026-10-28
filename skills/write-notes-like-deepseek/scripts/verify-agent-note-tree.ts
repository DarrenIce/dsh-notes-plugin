import { agentNoteRoot } from './agent-note-tree.ts';
import { validateTree } from './lib/validate-tree.ts';
const rootIndex = process.argv.indexOf('--root');
const root = rootIndex < 0 ? agentNoteRoot : requireRoot();
function requireRoot() { if (!process.argv[rootIndex + 1]) throw new Error('--root requires a path'); return requireResolve(process.argv[rootIndex + 1]); }
import { resolve as requireResolve } from 'node:path';
const { notes, errors } = validateTree(root);
if (errors.length) { for (const e of errors) console.error(e); process.exitCode = 1; }
else console.log(`ok: ${notes.length} note(s) tree and relative links verified`);
