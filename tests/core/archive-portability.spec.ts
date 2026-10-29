import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { archiveNote } from '../../skills/write-notes-like-deepseek/scripts/lib/archive.ts';
import { validateArchive } from '../../skills/write-notes-like-deepseek/scripts/lib/validate-archive.ts';
import { validateNotes } from '../../skills/write-notes-like-deepseek/scripts/lib/index.ts';
import { installNoteAgent } from '../../src/server/note-tools.ts';

const note = '# Agent Note: Windows 归档\n\nStatus: implemented\n\n## Problem\n问题\n\n## Decision\n选择\n\n## Alternatives considered\n无\n\n## Consequences\n结果\n';
const id = 'implemented/process/2026-10-01-windows.md';
const successor = 'implemented/process/2026-10-02-successor.md';

function fixture(t: { after(fn: () => void): void }) {
  const base = mkdtempSync(path.join(tmpdir(), 'notes-archive-portability-'));
  t.after(() => {
    assert.ok(base.startsWith(path.join(tmpdir(), 'notes-archive-portability-')));
    rmSync(base, { recursive: true, force: true });
  });
  return base;
}

for (const [name, eol] of [['LF', '\n'], ['CRLF', '\r\n'], ['mixed', '\r\n']] as const) {
  test(`archive accepts ${name} and seals the preserved note bytes`, async t => {
    const root = path.join(fixture(t), '中文 notes');
    mkdirSync(path.join(root, 'implemented/process'), { recursive: true });
    const source = name === 'mixed' ? note.replace('Status: implemented\n','Status: implemented\r\n').replace('## Decision\n','## Decision\r\n') : note.replace(/\n/g, eol);
    writeFileSync(path.join(root, id), source);

    const result = await archiveNote(root, id, { date: new Date(2026, 9, 29) });
    assert.equal(result.ok, true, result.errors.join('\n'));
    assert.equal(existsSync(path.join(root, id)), false);
    const archivedId = id.replace(/^implemented\//, 'archived/');
    const archived = readFileSync(path.join(root, archivedId));
    assert.equal(archived.toString('utf8'), source.replace(`Status: implemented${eol}`, `Status: implemented${eol}Archived: 2026-10-29${eol}`));
    const manifest = JSON.parse(readFileSync(path.join(root, 'archived/manifest.json'), 'utf8'));
    assert.equal(manifest.files[archivedId], `sha256:${createHash('sha256').update(archived).digest('hex')}`);
    assert.deepEqual(validateArchive(root, { archiveBaseline: { raw: null, ref: 'fixture' } }).errors, []);
  });
}

for (const alias of ['hard link', 'Windows case alias'] as const) {
  test(`archive rejects a successor that is the source via ${alias} before changing notes`, { skip: alias === 'Windows case alias' && process.platform !== 'win32' }, async t => {
    const root = path.join(fixture(t), '中文 notes');
    mkdirSync(path.join(root, 'implemented/process'), { recursive: true });
    const source = note.replace(/\n/g, '\r\n');
    writeFileSync(path.join(root, id), source);
    const aliasId = alias === 'hard link' ? successor : id.replace('windows.md', 'WINDOWS.md');
    if (alias === 'hard link') linkSync(path.join(root, id), path.join(root, aliasId));
    assert.equal(existsSync(path.join(root, aliasId)), true, 'fixture must point to a real file');

    const result = await archiveNote(root, id, { successor: aliasId });
    assert.equal(result.ok, false);
    assert.match(result.errors.join('\n'), /--superseded-by target must differ from the archived note/);
    assert.equal(readFileSync(path.join(root, id), 'utf8'), source);
    assert.equal(readFileSync(path.join(root, aliasId), 'utf8'), source);
    assert.equal(existsSync(path.join(root, id.replace(/^implemented\//, 'archived/'))), false);
    assert.equal(existsSync(path.join(root, 'archived/manifest.json')), false);
  });
}

for (const alias of ['hard link', 'Windows case alias'] as const) {
  test(`archive reports inbound links to the source via ${alias}`, { skip: alias === 'Windows case alias' && process.platform !== 'win32' }, async t => {
    const root = path.join(fixture(t), '中文 notes');
    mkdirSync(path.join(root, 'implemented/process'), { recursive: true });
    writeFileSync(path.join(root, id), note);
    const aliasId = alias === 'hard link' ? 'implemented/process/2026-10-01-alias.md' : id.replace('windows.md', 'WINDOWS.md');
    if (alias === 'hard link') linkSync(path.join(root, id), path.join(root, aliasId));
    assert.equal(existsSync(path.join(root, aliasId)), true);
    const referrer = 'implemented/process/2026-10-03-referrer.md';
    writeFileSync(path.join(root, referrer), `${note}\n[归档前引用](${path.basename(aliasId)}#decision)\n`);

    const result = await archiveNote(root, id);
    assert.equal(result.ok, true, result.errors.join('\n'));
    assert.deepEqual(result.inbound, [referrer]);
  });
}

for (const wrapped of [false, true]) {
  test(`archive reports Windows relative inbound links${wrapped ? ' in angle brackets' : ''}`, async t => {
    const root = path.join(fixture(t), '中文 notes');
    const target = 'implemented/architecture/2026-10-29-中文 空格.md';
    const referrer = 'implemented/process/2026-10-29-referrer.md';
    const relative = '..\\architecture\\2026-10-29-中文 空格.md#decision';
    const href = wrapped ? `<${relative}>` : relative;
    mkdirSync(path.dirname(path.join(root, target)), { recursive: true });
    mkdirSync(path.dirname(path.join(root, referrer)), { recursive: true });
    writeFileSync(path.join(root, target), note);
    writeFileSync(path.join(root, referrer), `${note}\n[归档前引用](${href})\n`);
    assert.deepEqual(validateNotes(root).issues, []);

    const result = await archiveNote(root, target);
    assert.equal(result.ok, true, result.errors.join('\n'));
    assert.deepEqual(result.inbound, [referrer]);
  });
}

test('archive tool returns a runnable bundled entry inside an installed node_modules package', async t => {
  const base = fixture(t);
  const packageRoot = path.join(base, '安装 package', 'node_modules', 'write-notes-like-deepseek');
  const skillRoot = path.join(packageRoot, 'assets/write-notes-like-deepseek');
  const cli = path.join(packageRoot, 'lib/archive-cli.mjs');
  mkdirSync(skillRoot, { recursive: true });
  cpSync(fileURLToPath(new URL('../../src/skills/dsh-write-notes/SKILL.md', import.meta.url)), path.join(skillRoot, 'SKILL.md'));
  await build({
    entryPoints: [fileURLToPath(new URL('../../skills/write-notes-like-deepseek/scripts/archive-agent-note.ts', import.meta.url))],
    outfile: cli, bundle: true, platform: 'node', format: 'esm', target: 'node22', packages: 'external',
  });
  const root = path.join(base, '中文 notes root');
  mkdirSync(path.join(root, 'implemented/process'), { recursive: true });
  writeFileSync(path.join(root, id), note.replace(/\n/g, '\r\n'));
  writeFileSync(path.join(root, successor), note.replace('Windows 归档', '后继'));
  const definitions = new Map<string, any>();
  const context = { notesRoot: root };
  const dispose = installNoteAgent({
    skills: { registerProvider: () => () => {} },
    systemPrompt: { section: () => () => {} },
    tools: { register: (definition: any) => { definitions.set(definition.name, definition); return () => definitions.delete(definition.name); } },
  }, {} as any, { resolve: async () => context }, { skillRoot });
  try {
    const entry = JSON.parse(await definitions.get('notes_archive_entry').execute({ id, successor }, { agent: { id: 'archive-session' }, signal: new AbortController().signal }));
    assert.equal(entry.executable, process.execPath);
    assert.equal(entry.argv[0], cli);
    assert.deepEqual(entry.argv.slice(1), [path.join(root, id), '--root', root, '--superseded-by', path.join(root, successor)]);
    const run = spawnSync(entry.executable, entry.argv, { cwd: base, encoding: 'utf8', timeout: 10000 });
    assert.ifError(run.error);
    assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
    assert.equal(existsSync(path.join(root, id)), false);
    assert.match(readFileSync(path.join(root, successor), 'utf8'), /\[历史快照：Windows 归档\]\(\.\.\/\.\.\/archived\/process\/2026-10-01-windows\.md\)/);
    assert.deepEqual(validateArchive(root, { archiveBaseline: { raw: null, ref: 'fixture' } }).errors, []);
  } finally { dispose(); }
});
