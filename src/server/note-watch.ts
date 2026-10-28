import { watch, type FSWatcher } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

/** Direct-child watchers are rebuilt after each scan; polling repairs dropped events and root recreation. */
export class NoteWatch {
  private watchers = new Map<string, FSWatcher>();
  private poll: ReturnType<typeof setInterval>;
  private debounce?: ReturnType<typeof setTimeout>;
  private stopped = false;
  private rebuilding?: Promise<void>;
  constructor(private root: string, private changed: () => void, intervalMs = 1500) {
    this.poll = setInterval(() => { this.schedule(); void this.rebuild(); }, intervalMs);
    this.poll.unref();
    void this.rebuild();
  }
  private schedule() {
    if (this.stopped || this.debounce) return;
    this.debounce = setTimeout(() => { this.debounce = undefined; if (!this.stopped) this.changed(); }, 60);
    this.debounce.unref();
  }
  rebuild(): Promise<void> {
    if (this.rebuilding) return this.rebuilding;
    this.rebuilding = this.build().finally(() => { this.rebuilding = undefined; });
    return this.rebuilding;
  }
  private async build() {
    const directories = new Set<string>();
    let ancestor = this.root;
    for (;;) {
      try { if ((await fs.lstat(ancestor)).isDirectory()) { directories.add(ancestor); break; } }
      catch { /* ancestor may not exist yet */ }
      const parent = path.dirname(ancestor); if (parent === ancestor) break; ancestor = parent;
    }
    const walk = async (directory: string, depth = 0): Promise<void> => {
      if (directories.size > 4096 || depth > 32 || this.stopped) return;
      try {
        const stat = await fs.lstat(directory);
        if (!stat.isDirectory() || stat.isSymbolicLink()) return;
        directories.add(directory);
        for (const entry of await fs.readdir(directory, {withFileTypes:true})) {
          if (entry.isDirectory() && !entry.isSymbolicLink()) await walk(path.join(directory,entry.name),depth+1);
        }
      } catch { /* failed reads are reported by the versioned scanner */ }
    };
    await walk(this.root);
    if (this.stopped) return;
    for (const [directory, watcher] of this.watchers) {
      if (!directories.has(directory)) { watcher.close(); this.watchers.delete(directory); }
    }
    for (const directory of directories) {
      if (this.watchers.has(directory)) continue;
      try {
        const watcher = watch(directory, () => { this.schedule(); void this.rebuild(); });
        watcher.on('error', () => { watcher.close(); this.watchers.delete(directory); this.schedule(); });
        watcher.unref(); this.watchers.set(directory,watcher);
      } catch { /* polling remains active */ }
    }
  }
  get count() { return this.watchers.size; }
  close() {
    if (this.stopped) return;
    this.stopped = true; clearInterval(this.poll); if (this.debounce) clearTimeout(this.debounce);
    for (const watcher of this.watchers.values()) watcher.close(); this.watchers.clear();
  }
}
