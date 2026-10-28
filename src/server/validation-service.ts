import type { NoteSnapshot } from '../contracts/notes.js';
import type { ReviewStart, ValidationResult } from '../contracts/validation.js';
import type { WorkspaceContext } from '../contracts/workspace.js';
import { IssueBaseline, issueKey, type ClassificationOptions } from './issue-baseline.js';

/** Increment when the meaning or identity of structured validation rules changes. */
export const RULES_VERSION = '1';
export interface CoreValidationResult {
  issues: readonly { rule: string; path?: string; anchor?: string; message: string }[];
  warnings: readonly string[];
  complete: boolean;
}

export class ValidationService {
  private readonly baseline: IssueBaseline;
  constructor(ttlMs?: number, now?: () => number) { this.baseline = new IssueBaseline(ttlMs, now); }
  /** Only transforms the supplied result. It neither reads nor writes the project. */
  build(context: WorkspaceContext, version: number, sourceVersion: string, coreResult: CoreValidationResult): ValidationResult {
    return { workspaceId: context.workspaceId, notesRoot: context.notesRoot, configRevision: context.configRevision,
      rulesVersion: RULES_VERSION, snapshotVersion: version, sourceVersion, complete: coreResult.complete,
      issues: coreResult.issues.map(issue => {
        const issuePath = (issue.path ?? '').replace(/\\/g, '/');
        const anchor = issue.anchor ?? '';
        return { key: issueKey(issue.rule, issuePath, anchor), rule: issue.rule, path: issuePath,
          anchor, message: issue.message, severity: 'error', attribution: 'uncertain' };
      }), warnings: [...coreResult.warnings], checkedAt: new Date().toISOString() };
  }
  beginReview(sessionId: string, snapshot: NoteSnapshot): ReviewStart { return this.baseline.beginReview(sessionId, snapshot); }
  classify(sessionId: string, token: string | undefined, snapshot: NoteSnapshot, options?: ClassificationOptions): ValidationResult {
    return this.baseline.classify(sessionId, token, snapshot, options);
  }
  dispose(): void { this.baseline.dispose(); }
}
