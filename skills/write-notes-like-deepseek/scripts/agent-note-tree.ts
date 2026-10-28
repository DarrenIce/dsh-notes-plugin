/** CLI compatibility helpers. Core callers pass an explicit root. */
import { resolve } from 'node:path';
import { walkAgentNoteTree as walk } from './lib/tree.ts';
export { AGENT_NOTE_CLASSES } from './lib/tree.ts';
export const agentNoteRoot = resolve(process.env.AGENT_NOTE_ROOT || resolve(process.cwd(), '.agents/notes'));
export function walkAgentNoteTree(root = agentNoteRoot) { return walk(root); }
