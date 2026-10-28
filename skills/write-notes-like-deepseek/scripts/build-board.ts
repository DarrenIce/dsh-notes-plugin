#!/usr/bin/env node

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanNotes } from './lib/index.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const templatePath = resolve(__dirname, '../assets/agent-notes-board.html');
const args = process.argv.slice(2);

if (!existsSync(templatePath)) {
  console.error(`❌ Template not found at: ${templatePath}`);
  process.exit(1);
}

function loadTemplate() {
  const template = readFileSync(templatePath, 'utf8');
  const parser = readFileSync(resolve(__dirname, 'lib/parser.mjs'), 'utf8').replace(/export function /g, 'function ');
  return template.replace(/(\/\/ BEGIN SHARED PARSER[^\n]*\n)[\s\S]*?(\/\/ END SHARED PARSER)/, (_, start, end) => start + parser + end);
}

// 检查参数
const isInitMode = args.includes('--init');
const isForce = args.includes('--force') || args.includes('-f');
const isMetadataOnly = args.includes('--metadata-only');
const cleanArgs = args.filter((a: string) => !a.startsWith('--') && !a.startsWith('-'));

function checkTargetSafety(targetPath: string) {
  if (existsSync(targetPath) && !isForce) {
    try {
      const existing = readFileSync(targetPath, 'utf8');
      const isBoard = existing.includes('generator" content="agent-notes-board"') || existing.includes('id="brand-project-title"');
      if (!isBoard) {
        console.error(`❌ 错误：目标文件已存在 (${targetPath}) 且并非看板生成文件！`);
        console.error(`💡 为防止意外覆盖已有项目页面（如 Vite/React/Vue 项目的 index.html），请指定其他输出路径或传入 --force 确认覆盖。`);
        process.exit(1);
      }
    } catch {}
  }
}

if (isInitMode) {
  const targetPath = cleanArgs[0] ? resolve(cleanArgs[0]) : resolve(process.cwd(), 'board.html');
  const projectName = cleanArgs[1] || '工程决策看板';

  checkTargetSafety(targetPath);

  let template = loadTemplate();
  template = template.replace('id="brand-project-title">工程决策看板<', () => `id="brand-project-title">${projectName}<`);

  writeFileSync(targetPath, template, 'utf8');
  console.log(`✅ [日常开发模式] 轻量看板已生成 (仅 ~69KB): ${targetPath}`);
  console.log(`💡 用浏览器打开后，点击右上角「连接本地目录」选择 .agents/notes，后续新建/修改笔记切回浏览器即可自动热刷新！`);
  process.exit(0);
}

// 打包模式（生成内联完整数据的单文件，如 demo.html）
const notesDir = cleanArgs[0] ? resolve(cleanArgs[0]) : resolve(process.cwd(), '.agents/notes');
const outputPath = cleanArgs[1] ? resolve(cleanArgs[1]) : resolve(process.cwd(), 'demo.html');
const projectName = cleanArgs[2] || '工程决策看板';

checkTargetSafety(outputPath);

if (!existsSync(notesDir)) {
  console.error(`❌ Notes directory not found at: ${notesDir}`);
  process.exit(1);
}

console.log(`🔍 [打包模式] 正在扫描笔记目录: ${notesDir}`);
const notes = scanNotes(notesDir).notes;
console.log(`✅ 解析完成，共发现 ${notes.length} 篇有效 Agent Notes。`);

if (isMetadataOnly) {
  console.log('🔒 [安全脱敏] 启用 --metadata-only 模式，已剥离所有笔记的具体正文和详细论证，仅保留决策元数据与关联拓扑。');
  for (const n of notes) {
    n.problem = '[正文已脱敏]';
    n.decision = '[正文已脱敏]';
    n.alternatives = '';
    n.consequences = '';
    n.rawBody = `# Agent Note: ${n.title}\n\nStatus: ${n.status}\n\n<!-- content redacted for public demo -->`;
  }
} else {
  console.log('⚠️ [安全提示] 正在生成包含完整正文的数据包。如需对外公开发布且避免泄露内部决策细节，请添加 --metadata-only 参数。');
}

let template = loadTemplate();

// 注入项目名
template = template.replace('id="brand-project-title">工程决策看板<', () => `id="brand-project-title">${projectName}<`);

// 注入数据
const jsonSafe = JSON.stringify(notes).replace(/</g, '\\u003c');
template = template.replace(
  'window.__INLINE_DATA__ = null;',
  () => `window.__INLINE_DATA__ = ${jsonSafe};`
);

writeFileSync(outputPath, template, 'utf8');
console.log(`🎉 [打包完成] 看板已生成: ${outputPath}`);
console.log(`💡 该文件内置了 ${notes.length} 篇笔记数据，可脱机分发、离线演示或部署至 GitHub Pages。`);
