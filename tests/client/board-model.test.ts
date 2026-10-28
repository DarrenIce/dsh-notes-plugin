import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { makeBoardNotes, noteTarget, externalTarget, incomingCounts } from '../../src/client/board-model.ts';
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
