#!/usr/bin/env node

import { execSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync, rmSync, rmdirSync } from 'node:fs';
import { join, resolve, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const args = process.argv.slice(2);
const dshNotesDir = args[0] ? resolve(args[0]) : resolve(process.cwd(), '../deepseek-harness/.agents/notes');
const targetNotesDir = args[1] ? resolve(args[1]) : resolve(__dirname, '../.agents/notes');

const LIFECYCLES = ['implemented', 'proposed', 'rejected', 'archived'];

if (!existsSync(dshNotesDir)) {
  console.error(`❌ Source dsh notes not found at: ${dshNotesDir}`);
  process.exit(1);
}

console.log(`📦 正在从 ${dshNotesDir} 提取并标准化中文 Note...`);

// 扫描所有文件并配对：优先取 .zh.md
const noteMap = new Map<string, string>(); // cleanRelPath -> sourceFilePath

function scan(currentDir: string) {
  const entries = readdirSync(currentDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const fullPath = join(currentDir, entry.name);

    if (entry.isDirectory()) {
      scan(fullPath);
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      const rel = relative(dshNotesDir, fullPath).replace(/\\/g, '/');
      const isZh = entry.name.endsWith('.zh.md');
      const cleanRel = isZh ? rel.replace(/\.zh\.md$/, '.md') : rel;
      const parts = cleanRel.split('/');

      if (parts.length >= 3 && LIFECYCLES.includes(parts[0])) {
        if (!noteMap.has(cleanRel) || isZh) {
          noteMap.set(cleanRel, fullPath);
        }
      }
    }
  }
}

scan(dshNotesDir);
console.log(`🔍 扫描完毕，发现 ${noteMap.size} 篇唯一 Note 待迁移。`);

let copied = 0;
for (const [cleanRel, sourcePath] of noteMap.entries()) {
  const destPath = join(targetNotesDir, cleanRel);
  mkdirSync(dirname(destPath), { recursive: true });

  let content = readFileSync(sourcePath, 'utf8');

  // 1. 去除多余的双语切换条目，例如 `[English](xxx.md) | 中文` 或 `English | [中文](xxx.zh.md)`
  content = content.replace(/^\[English\]\([^)]+\)\s*\|\s*中文\s*\n+/m, '');
  content = content.replace(/^English\s*\|\s*\[中文\]\([^)]+\)\s*\n+/m, '');
  content = content.replace(/^\[English\]\([^)]+\)\s*\n+/m, '');

  // 2. 将文内所有的 `.zh.md` 相对链接归一化为标准的 `.md`（包括带有 #anchor 的链接）
  content = content.replace(/\]\(([^)#]+)\.zh\.md([#)])/g, ']($1.md$2');

  writeFileSync(destPath, content, 'utf8');
  copied++;
}

// 拷贝 README.md 和 AGENTS.md 到 .agents/notes 根目录供相对跳转
for (const topDoc of ['README.zh.md', 'README.md', 'AGENTS.md']) {
  const p = join(dshNotesDir, topDoc);
  if (existsSync(p)) {
    let topContent = readFileSync(p, 'utf8').replace(/\]\(([^)#]+)\.zh\.md([#)])/g, ']($1.md$2');
    writeFileSync(join(targetNotesDir, topDoc === 'README.zh.md' ? 'README.md' : topDoc), topContent, 'utf8');
  }
}

// 清理已在源端被移除或移动的旧 Note
function cleanTarget(currentDir: string) {
  if (!existsSync(currentDir)) return;
  const entries = readdirSync(currentDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const fullPath = join(currentDir, entry.name);
    if (entry.isDirectory()) {
      cleanTarget(fullPath);
      try {
        if (readdirSync(fullPath).length === 0) {
          rmdirSync(fullPath);
        }
      } catch {}
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      const rel = relative(targetNotesDir, fullPath).replace(/\\/g, '/');
      if (rel === 'README.md' || rel === 'AGENTS.md' || rel === 'archived/AGENTS.md') continue;
      if (!noteMap.has(rel)) {
        rmSync(fullPath);
      }
    }
  }
}
cleanTarget(targetNotesDir);

// 拷贝 archived/AGENTS.md
const archivedAgents = join(dshNotesDir, 'archived', 'AGENTS.md');
if (existsSync(archivedAgents)) {
  mkdirSync(join(targetNotesDir, 'archived'), { recursive: true });
  writeFileSync(join(targetNotesDir, 'archived', 'AGENTS.md'), readFileSync(archivedAgents, 'utf8'), 'utf8');
}

// 重建归档 Note 密封清单：本地笔记经过标准化，与上游原文不同，seal 必须基于本地文件重算
const localManifest = join(targetNotesDir, 'archived', 'manifest.json');
if (existsSync(localManifest)) {
  try {
    rmSync(localManifest);
  } catch {}
}

try {
  execSync('npx tsx skills/write-notes-like-deepseek/scripts/verify-archived-agent-notes.ts --write', { stdio: 'ignore' });
} catch {}

console.log(`✅ 成功将 ${copied} 篇中文 Note 标准化写入到: ${targetNotesDir}`);
