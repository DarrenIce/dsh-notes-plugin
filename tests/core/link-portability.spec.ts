import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {parseNote,validateNotes} from '../../skills/write-notes-like-deepseek/scripts/lib/index.ts';

const body = '# Agent Note: 链接\n\nStatus: implemented\n\n## Problem\n问题\n\n## Decision\n选择\n\n## Alternatives considered\n无\n\n## Consequences\n结果\n';
test('Windows relative links produce the same validation and board edges on every platform',async()=>{
  const root = await fs.mkdtemp(path.join(os.tmpdir(),'notes-link-portability-'));
  const from = 'implemented/process/2026-10-29-from.md';
  const to = 'implemented/architecture/2026-10-29-中文 空格.md';
  const link = '<..\\architecture\\2026-10-29-中文 空格.md#decision>';
  try {
    for (const id of [from,to]) await fs.mkdir(path.dirname(path.join(root,id)),{recursive:true});
    await fs.writeFile(path.join(root,from),`${body}\n[关联](${link})\n`);
    await fs.writeFile(path.join(root,to),body);
    assert.deepEqual(parseNote(`[关联](${link})`,from,new Set([from,to])).outLinks,[to]);
    assert.deepEqual(parseNote('[outside](C:\\private\\secret.md)',from,new Set([to])).outLinks,[]);
    assert.deepEqual(validateNotes(root).issues,[]);
    await fs.unlink(path.join(root,to));
    assert.ok(validateNotes(root).issues.some(issue=>issue.rule.startsWith('tree.') || issue.message.includes('target file does not exist')));
  } finally {
    assert.equal(path.dirname(root),os.tmpdir());
    assert.ok(path.basename(root).startsWith('notes-link-portability-'));
    await fs.rm(root,{recursive:true,force:true});
  }
});
