import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * Resolve npm's JS entry (`npm-cli.js` / `npx-cli.js`) so callers can run
 * `node <entry> ...` instead of spawning `npm` / `npx` directly.
 *
 * Windows only ships `npm.cmd` / `npx.cmd` shims, which Node refuses to spawn
 * without a shell since the CVE-2024-27980 fix, and the non-Windows shims are
 * shell wrappers for the same JS entries. Running the entry with the current
 * Node binary is the only deterministic way on every platform.
 */
export function npmCliPath(name = 'npm') {
  const file = `${name}-cli.js`;
  const candidates = [
    process.env.npm_execpath && join(dirname(process.env.npm_execpath), file),
    join(dirname(process.execPath), 'node_modules', 'npm', 'bin', file),
    join(dirname(process.execPath), '..', 'lib', 'node_modules', 'npm', 'bin', file),
  ];
  const found = candidates.find(candidate => typeof candidate === 'string' && existsSync(candidate));
  if (!found) throw new Error(`Cannot locate npm's ${file}; run this command through npm so npm_execpath is set.`);
  return found;
}
