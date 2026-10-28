import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';

/** Resolve a path under root without following any symlink within that root. */
export function safePath(root: string, id: string): string {
  if (!isAbsolute(root)) throw new Error('notes root must be absolute');
  const base = resolve(root);
  const full = resolve(base, id);
  const rel = relative(base, full);
  if (rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)) throw new Error(`path escapes notes root: ${id}`);
  let current = base;
  for (const part of rel.split(sep).filter(Boolean)) {
    current = resolve(current, part);
    try {
      if (lstatSync(current).isSymbolicLink()) throw new Error(`symlink in notes path: ${id}`);
    } catch (error: any) {
      if (error.code === 'ENOENT') break;
      throw error;
    }
  }
  return full;
}

export function readNote(root: string, id: string): string {
  return readFileSync(safePath(root, id), 'utf8');
}

export function listFiles(root: string, prefix = ''): string[] {
  const dir = safePath(root, prefix);
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); }
  catch (error: any) { if (error.code === 'ENOENT') return []; throw error; }
  const out: string[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const id = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...listFiles(root, id));
    else if (entry.isFile()) out.push(id);
  }
  return out.sort();
}
