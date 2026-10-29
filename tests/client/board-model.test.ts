import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { makeBoardNotes, noteTarget, externalTarget, incomingCounts, pitfallEntries, plainText, excerpt } from '../../src/client/board-model.ts';
import { getBrowseState, saveBrowseState } from '../../src/client/board-store.ts';

test('associations resolve exact root-relative identities, never a matching slug', () => {
  const a = 'implemented/architecture/a.md';
  const b = 'implemented/architecture/same.md';
  const c = 'proposed/feature/same.md';
  const notes = makeBoardNotes([
    { id: a, raw: '# Agent Note: A\n\n## Decision\n[local](same.md) [other](../../proposed/feature/same.md) [escape](../../../same.md)' },
    { id: b, raw: '# Agent Note: B' }, { id: c, raw: '# Agent Note: C' },
  ]);
  assert.deepEqual(notes.find(n => n.id === a)?.outLinks, [b, c]);
  assert.equal(incomingCounts(notes).get(c), 1);
  assert.equal(noteTarget(a, '../../../same.md', new Set([b, c])), undefined);
  assert.equal(noteTarget(a, 'same.md', new Set([c])), undefined);
});

test('external links use a strict protocol allowlist', () => {
  assert.equal(externalTarget('javascript:alert(1)'), undefined);
  assert.equal(externalTarget('data:text/html,hi'), undefined);
  assert.equal(externalTarget('//example.com'), undefined);
  assert.equal(externalTarget('https://example.com'), 'https://example.com');
});

test('view state is isolated by session', () => {
  const first = getBrowseState('one'); first.query = 'secret'; first.selected = 'a'; saveBrowseState('one', first);
  assert.equal(getBrowseState('two').query, '');
  assert.equal(getBrowseState('one').selected, 'a');
  const copy = getBrowseState('one'); copy.query = 'changed';
  assert.equal(getBrowseState('one').query, 'secret');
});

test('pitfall dossiers keep rejected reasons and clean discarded alternatives', () => {
  const notes = makeBoardNotes([
    { id: 'rejected/feature/2026-01-02-old.md', raw: '# Agent Note: Old\n\nStatus: rejected — 成本过高\n\n## Problem\n旧方案很慢' },
    { id: 'implemented/feature/2026-01-03-new.md', raw: '# Agent Note: New\n\n## Alternatives considered\n### 单进程：更简单\n否决，不能跨重启。\n- 双写：迁移安全\n否决，双写期太长。' },
  ]);
  const entries = pitfallEntries(notes);
  const rejected = entries.find(item => item.discarded.includes('Old'));
  assert.equal(rejected?.crux, '成本过高');
  const single = entries.find(item => item.discarded === '单进程');
  assert.equal(single?.crux, '更简单 否决，不能跨重启。');
  const dual = entries.find(item => item.discarded === '双写');
  assert.equal(dual?.crux, '迁移安全 否决，双写期太长。');
  assert.equal(single?.winner, '采纳决策: New');
});

test('excerpts use plain prose and only append an ellipsis when clipped', () => {
  assert.equal(plainText('## Decision\n**加粗**、`代码`、[链接](../a.md) 与 <b>HTML</b>'), 'Decision 加粗、代码、链接 与 HTML');
  assert.equal(excerpt('短句', 10), '短句');
  assert.equal(excerpt('这是一段需要被截断的说明文字', 6), '这是一段需要…');
});
