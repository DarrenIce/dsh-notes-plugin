import { resolve } from 'node:path';
import { agentNoteRoot } from './agent-note-tree.ts';
import { validateArchive } from './lib/validate-archive.ts';
import { withSealMutex } from './lib/archive.ts';
const idx = process.argv.indexOf('--root');
if (idx >= 0 && !process.argv[idx + 1]) throw new Error('--root requires a path');
const root = idx < 0 ? agentNoteRoot : resolve(process.argv[idx + 1]);
const write = process.argv.includes('--write');
const run = () => validateArchive(root, { write, baseRef: process.env.AGENT_NOTE_ARCHIVE_BASE_REF });
function report(result: ReturnType<typeof run>) {
  if (result.errors.length) { for (const e of result.errors) console.error(`archived: ${e}`); process.exitCode = 1; }
  else { for (const w of result.warnings) console.warn(`warning: ${w}`); console.log(`ok: ${result.files.length} archived note(s) verified, ${result.seals} seal(s) in manifest`); }
}
if (write) withSealMutex(root, async () => run()).then(report, error => { console.error(`archived: ${error.message}`); process.exitCode = 1; });
else report(run());
