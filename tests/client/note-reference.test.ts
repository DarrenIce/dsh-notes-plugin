import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { insertNoteReference } from '../../src/client/note-reference.ts';
const identity = { sessionId: 's', configRevision: 'r', operation: 1 };
const note = { title: '决定', notesPath: '.agents/notes', id: 'implemented/feature/a.md' };

test('inserts at selected end without replacing draft, chips or attachments', () => {
  let draft = 'hello @file tail'; const attachments = ['image']; const chips = ['file'];
  let applied: unknown;
  const actions = { captureInsertion: () => ({ start: 1, end: 5, draftRev: 3 }), insertText: (text: string, span: any) => { applied = span; draft = draft.slice(0, span.start) + text + draft.slice(span.end); return true; } };
  assert.equal(insertNoteReference(actions, identity, () => identity, note), true);
  assert.deepEqual(applied, { start: 5, end: 5, draftRev: 3 });
  assert.match(draft, /^hello\n笔记：决定\n路径：\.agents\/notes\/implemented\/feature\/a\.md\n @file tail$/);
  assert.deepEqual(attachments, ['image']); assert.deepEqual(chips, ['file']);
});

test('host revision and submission guards refuse without overwriting the draft', () => {
  let revision = 4; let busy = false; let draft = 'original';
  const actions = { captureInsertion: () => ({ start: 0, end: 4, draftRev: revision }), insertText: (text: string, span: any) => { if (busy || revision !== span.draftRev) return false; draft += text; return true; } };
  assert.equal(insertNoteReference(actions, identity, () => { revision++; return identity; }, note), false);
  busy = true;
  assert.equal(insertNoteReference(actions, identity, () => identity, note), false);
  assert.equal(draft, 'original');
});

test('switching session, configuration, operation or disposal prevents insertion', () => {
  for (const current of [undefined, { ...identity, sessionId: 'other' }, { ...identity, configRevision: 'new' }, { ...identity, operation: 2 }]) {
    let inserted = false; let calls = 0;
    const actions = { captureInsertion: () => ({ start: 1, end: 2, draftRev: 1 }), insertText: () => { inserted = true; return true; } };
    assert.equal(insertNoteReference(actions, identity, () => ++calls === 1 ? identity : current, note), false);
    assert.equal(inserted, false);
  }
});

test('invalid paths and errors fail closed', () => {
  const actions = { captureInsertion: () => { throw new Error('disposed'); }, insertText: () => true };
  assert.equal(insertNoteReference(actions, identity, () => identity, note), false);
  assert.equal(insertNoteReference(actions, identity, () => identity, { ...note, id: '../escape.md' }), false);
});
