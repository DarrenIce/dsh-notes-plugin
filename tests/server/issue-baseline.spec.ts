import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Note, NoteSnapshot } from '../../src/contracts/notes.js';
import type { WorkspaceContext } from '../../src/contracts/workspace.js';
import { ValidationService } from '../../src/server/validation-service.js';
import type { ReviewEvidence } from '../../src/server/issue-baseline.js';

const context: WorkspaceContext = { sessionId: 's1', workspaceId: 'w', projectRoot: '/p', notesRoot: '/p/notes',
  notesPath: 'notes', configRevision: 'c1', status: 'ready', capabilities: { read: true, write: false } };
const problem = { rule: 'format.title', path: 'proposed/a/n.md', anchor: 'title', message: 'missing title' };
const second = { rule: 'format.status', path: 'proposed/a/n.md', anchor: 'status', message: 'bad status' };
const note = (id = problem.path, rawBody = 'body'): Note => ({ id, slug: 'n', lifecycle: 'proposed', cls: 'a', date: '',
  title: '', status: '', problem: '', decision: '', alternatives: '', consequences: '', outLinks: [], rawBody });
function snapshot(service: ValidationService, issues = [problem], version = 1, source = 'a'): NoteSnapshot {
  return { workspaceId: context.workspaceId, projectRoot: context.projectRoot, notesRoot: context.notesRoot,
    configRevision: context.configRevision, snapshotVersion: version, sourceVersion: source, checkoutVersion: 'head:branch',
    complete: true, status: 'ready', notes: [note()], validation: service.build(context, version, source, { issues, warnings: [], complete: true }) };
}
const attributions = (s: ReturnType<ValidationService['classify']>) => s.issues.map(i => i.attribution);

test('build is read-only and identities ignore diagnostic text', () => {
  const service = new ValidationService();
  const a = snapshot(service);
  const b = snapshot(service, [{ ...problem, message: 'updated wording' }]);
  assert.equal(a.validation.issues[0].key, b.validation.issues[0].key);
  assert.equal(a.validation.issues[0].attribution, 'uncertain');
  assert.equal(a.validation.snapshotVersion, 1);
  assert.equal(a.validation.sourceVersion, 'a');
});

test('explicit token binds session, expires and is cleared on disposal', () => {
  let time = 1000;
  const service = new ValidationService(100, () => time);
  const start = snapshot(service);
  const token = service.beginReview('s1', start).reviewToken;
  assert.deepEqual(attributions(service.classify('s1', token, start)), ['historical']);
  assert.deepEqual(attributions(service.classify('s2', token, start)), ['uncertain']);
  assert.deepEqual(attributions(service.classify('s1', undefined, start)), ['uncertain']);
  time += 100;
  assert.deepEqual(attributions(service.classify('s1', token, start)), ['uncertain']);
  const next = service.beginReview('s1', start).reviewToken;
  service.dispose();
  assert.deepEqual(attributions(service.classify('s1', next, start)), ['uncertain']);
});

test('normal versions, source edits and counts are handled conservatively', () => {
  const service = new ValidationService();
  const baseline = snapshot(service);
  const token = service.beginReview('s1', baseline).reviewToken;
  const current = snapshot(service, [problem, second], 2, 'b');
  assert.deepEqual(attributions(service.classify('s1', token, current)), ['historical', 'uncertain']);
  current.notes[0].rawBody = 'changed';
  assert.deepEqual(attributions(service.classify('s1', token, current)), ['uncertain', 'uncertain']);
  const duplicates = snapshot(service, [problem, problem], 2, 'b');
  assert.deepEqual(attributions(service.classify('s1', token, duplicates)), ['uncertain', 'uncertain']);
  const renamed = snapshot(service, [{ ...problem, path: 'implemented/a/n.md' }], 2, 'b');
  renamed.notes = [note('implemented/a/n.md')];
  assert.deepEqual(attributions(service.classify('s1', token, renamed)), ['uncertain']);
  const missingIdentity = snapshot(service, [{ ...problem, anchor: '' }]);
  const otherToken = service.beginReview('s1', missingIdentity).reviewToken;
  assert.deepEqual(attributions(service.classify('s1', otherToken, missingIdentity)), ['uncertain']);
});

test('incomplete, stale, inconsistent, changed checkout and context lose attribution', () => {
  const service = new ValidationService();
  const initial = snapshot(service, [problem], 4, 'a');
  const token = service.beginReview('s1', initial).reviewToken;
  const mutate = (f: (x: NoteSnapshot) => void) => {
    const current = snapshot(service, [problem], 5, 'b'); f(current);
    assert.deepEqual(attributions(service.classify('s1', token, current)), ['uncertain']);
  };
  mutate(x => { x.complete = false; });
  mutate(x => { x.validation.complete = false; });
  mutate(x => { x.validation.sourceVersion = 'stale'; });
  mutate(x => { x.configRevision = 'different'; });
  mutate(x => { x.checkoutVersion = 'other'; });
  mutate(x => { x.checkoutVersion = 'unknown'; });
  mutate(x => { x.checkoutVersion = undefined; });
  mutate(x => { x.validation.rulesVersion = '2'; });
  mutate(x => { x.snapshotVersion = 3; x.validation.snapshotVersion = 3; });
  const partial = snapshot(service); partial.complete = false;
  assert.throws(() => service.beginReview('s1', partial));
  assert.equal(service.classify('s1', token, partial).complete, false);
  const stale = snapshot(service); stale.validation.sourceVersion = 'stale';
  assert.equal(service.classify('s1', token, stale).complete, false);
  assert.deepEqual(attributions(service.classify('s1', token, snapshot(service, [problem], 5, 'b'), { concurrent: true })), ['uncertain']);
});

test('introduced requires verifier and proof bound to exact interval, counts and issue', () => {
  const service = new ValidationService();
  const baseline = snapshot(service);
  const token = service.beginReview('s1', baseline).reviewToken;
  const current = snapshot(service, [problem, second], 2, 'b');
  const evidence: ReviewEvidence = { sessionId: 's1', reviewToken: token, workspaceId: 'w', configRevision: 'c1',
    rulesVersion: current.validation.rulesVersion, startSourceVersion: 'a', endSourceVersion: 'b', snapshotVersion: 2,
    issueKey: current.validation.issues[1].key, baselineCount: 0, currentCount: 1, operationId: 'verified-operation' };
  assert.deepEqual(attributions(service.classify('s1', token, current, { evidence: [evidence] })), ['historical', 'uncertain']);
  assert.deepEqual(attributions(service.classify('s1', token, current, { evidence: [evidence], verifyEvidence: () => false })), ['historical', 'uncertain']);
  assert.deepEqual(attributions(service.classify('s1', token, current, { evidence: [evidence], verifyEvidence: () => true })), ['historical', 'introduced']);
  assert.deepEqual(attributions(service.classify('s1', token, current, { evidence: [{ ...evidence, snapshotVersion: 1 }], verifyEvidence: () => true })), ['historical', 'uncertain']);
  const duplicate = snapshot(service, [problem, problem], 2, 'b');
  const duplicateEvidence = { ...evidence, issueKey: duplicate.validation.issues[0].key, baselineCount: 1, currentCount: 2 };
  assert.deepEqual(attributions(service.classify('s1', token, duplicate, { evidence: [duplicateEvidence], verifyEvidence: () => true })), ['uncertain', 'uncertain']);
  const worse = snapshot(service, [{ ...problem, message: 'more severe failure' }], 2, 'b');
  const worseEvidence = { ...evidence, issueKey: worse.validation.issues[0].key, baselineCount: 1, currentCount: 1 };
  assert.deepEqual(attributions(service.classify('s1', token, worse, { evidence: [worseEvidence], verifyEvidence: () => true })), ['introduced']);
});
