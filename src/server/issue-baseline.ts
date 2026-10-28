import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { NoteSnapshot } from '../contracts/notes.js';
import type { ReviewStart, ValidationIssue, ValidationResult } from '../contracts/validation.js';

const DEFAULT_TTL = 30 * 60 * 1000;
type Baseline = { sessionId: string; snapshot: NoteSnapshot; expires: number };

/** The caller's verifier must independently validate both the operation and its
 * connection to the specific issue; matching fields alone are not evidence. */
export interface ReviewEvidence {
  sessionId: string; reviewToken: string; workspaceId: string; configRevision: string;
  rulesVersion: string; startSourceVersion: string; endSourceVersion: string;
  snapshotVersion: number; issueKey: string; baselineCount: number; currentCount: number; operationId: string;
}
export interface ClassificationOptions {
  /** Establish continuity, including no checkout or competing writes, when source identity is unavailable. */
  verifyContinuity?: (baseline: NoteSnapshot, current: NoteSnapshot) => boolean;
  evidence?: readonly ReviewEvidence[];
  verifyEvidence?: (evidence: ReviewEvidence, baseline: NoteSnapshot, current: NoteSnapshot) => boolean;
  concurrent?: boolean;
}

/** Messages and line numbers are deliberately excluded from the stable key. */
export function issueKey(rule: string, issuePath: string, anchor: string): string {
  const normalized = issuePath ? path.posix.normalize(issuePath.replace(/\\/g, '/')) : '';
  return JSON.stringify([rule, normalized === '.' ? '' : normalized, anchor]);
}
function consistent(snapshot: NoteSnapshot): boolean {
  const v = snapshot.validation;
  return snapshot.complete && snapshot.status !== 'error' && !!snapshot.sourceVersion &&
    v.complete && v.workspaceId === snapshot.workspaceId && v.notesRoot === snapshot.notesRoot &&
    v.configRevision === snapshot.configRevision && v.snapshotVersion === snapshot.snapshotVersion &&
    v.sourceVersion === snapshot.sourceVersion && !!v.rulesVersion;
}
function sameContext(a: NoteSnapshot, b: NoteSnapshot): boolean {
  return a.workspaceId === b.workspaceId && a.projectRoot === b.projectRoot && a.notesRoot === b.notesRoot &&
    a.configRevision === b.configRevision && a.validation.rulesVersion === b.validation.rulesVersion;
}
function unknown(snapshot: NoteSnapshot, reason: string): ValidationResult {
  return { ...snapshot.validation, complete: consistent(snapshot),
    issues: snapshot.validation.issues.map(issue => ({ ...issue, attribution: 'uncertain' })),
    reviewToken: undefined, reviewReason: reason };
}
function counts(issues: readonly ValidationIssue[]): Map<string, ValidationIssue[]> {
  const result = new Map<string, ValidationIssue[]>();
  for (const issue of issues) {
    const key = issueKey(issue.rule, issue.path, issue.anchor);
    const group = result.get(key) ?? [];
    group.push(issue); result.set(key, group);
  }
  return result;
}
function equivalentIssues(a: ValidationIssue[], b: ValidationIssue[]): boolean {
  const signature = (xs: ValidationIssue[]) => xs.map(x => JSON.stringify([x.severity, x.message])).sort();
  return JSON.stringify(signature(a)) === JSON.stringify(signature(b));
}
function unchangedNote(a: NoteSnapshot, b: NoteSnapshot, issuePath: string): boolean {
  const before = a.notes.filter(note => note.id === issuePath);
  const after = b.notes.filter(note => note.id === issuePath);
  return before.length === 1 && after.length === 1 && before[0].rawBody === after[0].rawBody;
}

/** Pure comparison; callers must independently verify any evidence they supply. */
export function classifyAgainstBaseline(sessionId: string, token: string, baseline: NoteSnapshot,
  current: NoteSnapshot, options: ClassificationOptions = {}): ValidationResult {
  if (!consistent(baseline) || !consistent(current)) return unknown(current, '基线或当前快照不完整或版本不一致。');
  if (!sameContext(baseline, current)) return unknown(current, '工作区、根目录、配置或规则已变化。');
  if (current.snapshotVersion < baseline.snapshotVersion ||
      (current.snapshotVersion === baseline.snapshotVersion && current.sourceVersion !== baseline.sourceVersion)) {
    return unknown(current, '快照版本过期或与来源不一致。');
  }
  if (options.concurrent) return unknown(current, '检查期间存在并发修改。');
  if (baseline.checkoutVersion === 'unknown' || current.checkoutVersion === 'unknown' ||
      (!!baseline.checkoutVersion !== !!current.checkoutVersion) ||
      (baseline.checkoutVersion && current.checkoutVersion && baseline.checkoutVersion !== current.checkoutVersion)) {
    return unknown(current, 'checkout 来源已变化或无法确定。');
  }
  const sameSource = baseline.sourceVersion === current.sourceVersion;
  const checkout = baseline.checkoutVersion;
  const knownCheckout = !!checkout && checkout !== 'unknown' && checkout !== 'no-git' && checkout === current.checkoutVersion;
  if (!sameSource && !knownCheckout && options.verifyContinuity?.(baseline, current) !== true) {
    return unknown(current, '来源已变化，无法排除 checkout 或并发修改。');
  }
  const previous = counts(baseline.validation.issues);
  const now = counts(current.validation.issues);
  const issues = current.validation.issues.map(issue => {
    const key = issueKey(issue.rule, issue.path, issue.anchor);
    const oldGroup = previous.get(key) ?? [];
    const newGroup = now.get(key)!;
    const stable = !!issue.rule && !!issue.path && !!issue.anchor && issue.key === key;
    let attribution: ValidationIssue['attribution'] = 'uncertain';
    if (stable && oldGroup.every(old => old.key === key) && oldGroup.length === newGroup.length && oldGroup.length > 0 &&
        equivalentIssues(oldGroup, newGroup) && (sameSource || unchangedNote(baseline, current, issue.path))) {
      attribution = 'historical';
    } else if (stable && (oldGroup.length === 0 ||
        (oldGroup.length === 1 && newGroup.length === 1 && !equivalentIssues(oldGroup, newGroup))) && options.verifyEvidence) {
      const proof = options.evidence?.find(e => e.sessionId === sessionId && e.reviewToken === token &&
        e.workspaceId === current.workspaceId && e.configRevision === current.configRevision &&
        e.rulesVersion === current.validation.rulesVersion && e.startSourceVersion === baseline.sourceVersion &&
        e.endSourceVersion === current.sourceVersion && e.snapshotVersion === current.snapshotVersion &&
        e.issueKey === key && e.baselineCount === oldGroup.length && e.currentCount === newGroup.length && !!e.operationId);
      if (proof && options.verifyEvidence(proof, baseline, current) === true) attribution = 'introduced';
    }
    return { ...issue, attribution };
  });
  return { ...current.validation, issues, reviewToken: token, reviewReason: undefined };
}

export class IssueBaseline {
  private readonly entries = new Map<string, Baseline>();
  constructor(private readonly ttlMs = DEFAULT_TTL, private readonly now: () => number = Date.now) {}
  beginReview(sessionId: string, snapshot: NoteSnapshot): ReviewStart {
    if (!sessionId || !consistent(snapshot)) throw new Error('无法从不完整或不一致的快照开始检查。');
    const time = this.now();
    this.prune(time);
    const reviewToken = randomUUID();
    const expires = time + this.ttlMs;
    this.entries.set(reviewToken, { sessionId, snapshot: structuredClone(snapshot), expires });
    return { reviewToken, contextRevision: snapshot.configRevision, snapshotVersion: snapshot.snapshotVersion,
      expiresAt: new Date(expires).toISOString() };
  }
  classify(sessionId: string, token: string | undefined, snapshot: NoteSnapshot, options?: ClassificationOptions): ValidationResult {
    const time = this.now();
    this.prune(time);
    const entry = token ? this.entries.get(token) : undefined;
    if (!entry || entry.sessionId !== sessionId) return unknown(snapshot, '检查区间不存在、已过期或不属于当前会话。');
    return classifyAgainstBaseline(sessionId, token!, entry.snapshot, snapshot, options);
  }
  dispose(): void { this.entries.clear(); }
  private prune(time: number): void {
    for (const [token, entry] of this.entries) if (entry.expires <= time) this.entries.delete(token);
  }
}
