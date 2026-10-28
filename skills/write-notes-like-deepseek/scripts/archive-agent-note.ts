import { resolve } from 'node:path';
import { agentNoteRoot } from './agent-note-tree.ts';
import { archiveNote } from './lib/archive.ts';
const args = process.argv.slice(2);
const rootIdx = args.indexOf('--root');
if (rootIdx >= 0 && !args[rootIdx + 1]) { console.error('Error: --root requires a path'); process.exit(1); }
const root = rootIdx < 0 ? agentNoteRoot : resolve(args[rootIdx + 1]);
if (rootIdx >= 0) args.splice(rootIdx, 2);
const target = args[0];
const successorIdx = args.indexOf('--superseded-by');
const successor = successorIdx < 0 ? undefined : args[successorIdx + 1];
if (successorIdx >= 0 && !successor) { console.error('Error: --superseded-by requires a note path'); process.exit(1); }
if (!target) { console.error('Usage: npx tsx <skill-dir>/scripts/archive-agent-note.ts <path-to-note> [--superseded-by <new-note-path>]'); process.exit(1); }
archiveNote(root, resolve(target), { successor: successor ? resolve(successor) : undefined }).then(result => {
  for (const warning of result.warnings) console.warn(`Warning: ${warning}`);
  for (const log of result.logs) console.log(log);
  if (!result.ok) { for (const error of result.errors) console.error(`Error: ${error}`); process.exitCode = 1; return; }
  if (result.inbound.length) {
    console.log('\n[Notice] The following active notes link to the archived note:');
    for (const id of result.inbound) console.log(`  - ${id}`);
    console.log('Please review and update their relative markdown links if necessary.');
  } else console.log('\nNo active notes link to this archived note.');
});
