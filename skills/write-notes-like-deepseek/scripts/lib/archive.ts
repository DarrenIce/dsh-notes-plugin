import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync, statSync } from 'node:fs';
import { basename, dirname, relative } from 'node:path';
import { safePath } from './fs.ts';
import { AGENT_NOTE_CLASSES, walkAgentNoteTree } from './tree.ts';

export type SealMutex = <T>(root: string, operation: () => Promise<T>) => Promise<T>;
const locks = new Map<string, Promise<void>>();
const defaultMutex: SealMutex = async (root, operation) => {
  const previous = locks.get(root) || Promise.resolve();
  let release!: () => void;
  const next = new Promise<void>(resolve => { release = resolve; });
  locks.set(root, next);
  await previous;
  let lockPath = '';
  let acquired = false;
  const token = `${process.pid}:${Date.now()}:${Math.random()}`;
  try {
    if (!existsSync(root)) throw new Error(`notes root not found: ${root}`);
    mkdirSync(safePath(root, 'archived'), { recursive: true });
    lockPath = safePath(root, 'archived/.seal.lock');
    const recoveryPath = safePath(root, 'archived/.seal-recovery.lock');
    const deadline = Date.now() + 30000;
    while (!acquired) {
      try { writeFileSync(lockPath, token, { flag: 'wx' }); acquired = true; }
      catch (error: any) {
        if (error.code !== 'EEXIST') throw error;
        // Only one process may reclaim a dead owner's lock. A crashed recovery
        // marker fails closed instead of risking deletion of a new owner's lock.
        try {
          writeFileSync(recoveryPath, token, { flag: 'wx' });
          try {
            let owner = '';
            let age = 0;
            try { owner = readFileSync(lockPath, 'utf8'); age = Date.now() - statSync(lockPath).mtimeMs; }
            catch (readError: any) { if (readError.code !== 'ENOENT') throw readError; }
            const pid = Number(owner.split(':')[0]);
            let dead = false;
            if (Number.isSafeInteger(pid) && pid > 0) {
              try { process.kill(pid, 0); } catch (probe: any) { dead = probe.code === 'ESRCH'; }
            } else dead = age > 30000;
            if (dead) { try { unlinkSync(lockPath); } catch (removeError: any) { if (removeError.code !== 'ENOENT') throw removeError; } }
          } finally { unlinkSync(recoveryPath); }
        } catch (recoveryError: any) { if (recoveryError.code !== 'EEXIST') throw recoveryError; }
        if (Date.now() >= deadline) throw new Error(`timed out waiting for archive seal lock: ${lockPath}`);
        await new Promise(resolve => setTimeout(resolve, 25));
      }
    }
    return await operation();
  } finally {
    try {
      if (acquired) {
        try { if (readFileSync(lockPath, 'utf8') === token) unlinkSync(lockPath); }
        catch (error: any) { if (error.code !== 'ENOENT') throw error; }
      }
    } finally {
      release();
      if (locks.get(root) === next) locks.delete(root);
    }
  }
};

export const withSealMutex = defaultMutex;

/** Caller must authorize writes. Mutex serializes the entire archive and seal update. */
export async function archiveNote(root: string, target: string, options: { successor?: string; mutex?: SealMutex; date?: Date } = {}) {
  return (options.mutex || defaultMutex)(root, async () => {
    const logs: string[] = [];
    const warnings: string[] = [];
    try {
      const targetPath = safePath(root, target);
      const rel = relative(root, targetPath).replace(/\\/g, '/');
      const parts = rel.split('/');
      if (parts.length !== 3 || parts[0] !== 'implemented') throw new Error(`only notes in .agents/notes/implemented/<class>/ can be archived (got: ${rel})`);
      const [, cls, filename] = parts;
      if (!(AGENT_NOTE_CLASSES as readonly string[]).includes(cls)) throw new Error(`unknown class "${cls}"`);
      if (!existsSync(targetPath)) throw new Error(`target note not found at ${targetPath}`);
      let successorPath: string | undefined;
      let successorRel: string | undefined;
      if (options.successor) {
        successorPath = safePath(root, options.successor);
        if (!existsSync(successorPath)) throw new Error(`--superseded-by target not found at ${successorPath}`);
        successorRel = relative(root, successorPath).replace(/\\/g, '/');
        const successorParts = successorRel.split('/');
        if (successorParts.length !== 3 || !['proposed', 'implemented', 'rejected'].includes(successorParts[0])) throw new Error(`--superseded-by target must be an active note in {lifecycle}/{class}/ (got: ${successorRel})`);
        if (sameFile(successorPath, targetPath)) throw new Error('--superseded-by target must differ from the archived note');
      }
      const text = readFileSync(targetPath, 'utf8');
      const eol = text.includes('\r\n') ? '\r\n' : '\n';
      const lines = text.split(/\r?\n/);
      const status = lines.indexOf('Status: implemented');
      if (status < 0) throw new Error('note must contain `Status: implemented` to be archived');
      const now = options.date || new Date();
      const pad = (n: number) => String(n).padStart(2, '0');
      const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
      const archivedText = lines.some(line => line.startsWith('Archived:')) ? text : text.replace(/(^|\n)Status: implemented(\r?\n|$)/, (_match, prefix, ending) => `${prefix}Status: implemented${ending || eol}Archived: ${stamp}${ending}`);
      const title = (lines[0] || '').replace(/^# Agent Note[:：] ?/, '').trim() || basename(filename, '.md');
      const archivedId = `archived/${cls}/${filename}`;
      const dest = safePath(root, archivedId);
      const manifestPath = safePath(root, 'archived/manifest.json');
      if (existsSync(dest)) throw new Error(`target archived note already exists at ${dest}\nRefusing to overwrite existing archived note. Please inspect and resolve name collision manually.`);
      let manifest: { version: 1; files: Record<string, string> } = { version: 1, files: {} };
      if (existsSync(manifestPath)) {
        try { manifest = JSON.parse(readFileSync(manifestPath, 'utf8')); }
        catch { warnings.push('existing manifest.json was invalid, creating fresh'); }
      }
      const inbound: string[] = [];
      for (const note of walkAgentNoteTree(root).notes) {
        if (note.rel === rel) continue;
        const file = safePath(root, note.rel);
        const text = readFileSync(file, 'utf8');
        for (const match of text.matchAll(/\[([^\]]+)\]\(([^)]+)\)/g)) {
          const href = match[2]?.trim();
          if (!href || /^(?:https?:|#|mailto:)/.test(href)) continue;
          const ref = href.split('#')[0];
          if (ref && safeCompare(dirname(file), ref, targetPath)) { inbound.push(note.rel); break; }
        }
      }
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(targetPath, archivedText, 'utf8');
      renameSync(targetPath, dest);
      logs.push(`Moved: ${rel} -> ${archivedId}`);
      const hash = `sha256:${createHash('sha256').update(readFileSync(dest)).digest('hex')}`;
      manifest.files[archivedId] = hash;
      writeFileSync(manifestPath, JSON.stringify({ version: 1, files: Object.fromEntries(Object.entries(manifest.files).sort(([a], [b]) => a.localeCompare(b))) }, null, 2) + '\n');
      logs.push(`Sealed in archived/manifest.json with hash ${hash.slice(0, 16)}...`);
      if (successorPath && successorRel) {
        const link = relative(dirname(successorPath), dest).replace(/\\/g, '/');
        const text = readFileSync(successorPath, 'utf8');
        if (!text.includes(archivedId) && !text.includes(link)) {
          writeFileSync(successorPath, `${text.replace(/\s*$/, '')}\n\n[历史快照：${title}](${link})\n`);
          logs.push(`Linked from ${successorRel}: [历史快照：${title}](${link})`);
        }
      }
      return { ok: true as const, archivedId, hash, inbound, logs, warnings, errors: [] as string[] };
    } catch (error) {
      return { ok: false as const, inbound: [] as string[], logs, warnings, errors: [error instanceof Error ? error.message : String(error)] };
    }
  }).catch(error => ({ ok: false as const, inbound: [] as string[], logs: [] as string[], warnings: [] as string[], errors: [error instanceof Error ? error.message : String(error)] }));
}
import { resolve } from 'node:path';
function sameFile(first: string, second: string) {
  const a = statSync(first, { bigint: true });
  const b = statSync(second, { bigint: true });
  return a.dev === b.dev && a.ino === b.ino;
}
function safeCompare(dir: string, target: string, expected: string) {
  const full = resolve(dir, target);
  if (full === expected) return true;
  try { return sameFile(full, expected); }
  catch { return false; }
}
