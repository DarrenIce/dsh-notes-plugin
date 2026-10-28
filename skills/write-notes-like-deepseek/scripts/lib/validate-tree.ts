/**
 * Verify tree: lifecycle/class/filename/INDEX and internal relative markdown links.
 * Run: npx tsx <skill-dir>/scripts/verify-agent-note-tree.ts
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { walkAgentNoteTree } from "./tree.ts";
import { readNote, safePath } from "./fs.ts";

export function validateTree(agentNoteRoot: string) {
const { notes, errors } = walkAgentNoteTree(agentNoteRoot);

// Check relative markdown links inside active notes
const LINK_REGEX = /\[([^\]]+)\]\(([^)]+)\)/g;

for (const note of notes) {
  const noteFullPath = resolve(agentNoteRoot, note.rel);
  const content = readNote(agentNoteRoot, note.rel);
  let match: RegExpExecArray | null;

  while ((match = LINK_REGEX.exec(content)) !== null) {
    let rawTarget = match[2]?.trim();
    if (!rawTarget) continue;

    // Support CommonMark angle bracket destinations: [text](<path>)
    if (rawTarget.startsWith("<") && rawTarget.endsWith(">")) {
      rawTarget = rawTarget.slice(1, -1).trim();
    }

    // Ignore web links, intra-page anchors and ellipsis placeholders
    if (rawTarget.startsWith("http://") || rawTarget.startsWith("https://") || rawTarget.startsWith("#") || rawTarget.startsWith("mailto:") || rawTarget.includes("…")) {
      continue;
    }

    // Strip anchor fragment if present
    const fileTarget = rawTarget.split("#")[0];
    if (!fileTarget) continue;

    const resolvedTarget = resolve(dirname(noteFullPath), fileTarget);

    // Only verify internal links within agentNoteRoot (boundary-aware: a
    // sibling like .agents/notes-backup/ must not prefix-match)
    if (!resolvedTarget.startsWith(agentNoteRoot + sep)) {
      continue;
    }

    if (!existsSync(safePath(agentNoteRoot, resolvedTarget))) {
      errors.push(`link: ${note.rel} -> "${rawTarget}" target file does not exist`);
    }
  }
}

return { notes, errors };
}
