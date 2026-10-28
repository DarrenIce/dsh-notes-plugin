#!/usr/bin/env node
// Build the two DSH entrypoints; all package imports remain external so the
// browser shares the host's React and Cordis singletons.
import { build } from 'esbuild'
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))
const out = resolve(root, 'lib')
await mkdir(out, { recursive: true })
await build({
  absWorkingDir: root, entryPoints: ['src/index.ts'], outfile: 'lib/index.js',
  bundle: true, platform: 'node', format: 'esm', target: 'node22',
  packages: 'external', sourcemap: false,
})
const client = await build({
  absWorkingDir: root, entryPoints: ['src/client/index.tsx'], write: false,
  bundle: true, platform: 'browser', format: 'cjs', target: 'es2022',
  packages: 'external', loader: { '.css': 'text' },
})
if (client.outputFiles.length !== 1) throw new Error('expected exactly one client JavaScript bundle')
const wrapper = `window.__ModuleLoader__.load({\n  id: ${JSON.stringify(manifest.name)},\n  factory: (require) => {\n    var module = { exports: {} };\n    var exports = module.exports;\n${client.outputFiles[0].text}\n    return module.exports;\n  }\n});\n`
await writeFile(resolve(out, 'client.js'), wrapper)
const skillRoot = resolve(root, 'assets/write-notes-like-deepseek')
await mkdir(skillRoot, { recursive: true })
for (const name of ['scripts', 'references', 'templates', 'assets']) {
  await cp(resolve(root, 'skills/write-notes-like-deepseek', name), resolve(skillRoot, name), { recursive: true })
}
await cp(resolve(root, 'src/skills/dsh-write-notes/SKILL.md'), resolve(skillRoot, 'SKILL.md'))
console.log(`Built ${manifest.name} into lib/ and assets/`)
