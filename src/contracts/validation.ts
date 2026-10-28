export type IssueAttribution = 'introduced' | 'historical' | 'uncertain';
export interface ValidationIssue {
  key: string; rule: string; path: string; anchor: string; message: string;
  severity: 'error' | 'warning'; attribution: IssueAttribution;
}
export interface ValidationResult {
  workspaceId: string; notesRoot: string; configRevision: string;
  rulesVersion: string; snapshotVersion: number; sourceVersion: string;
  complete: boolean; issues: ValidationIssue[]; warnings: string[]; checkedAt: string;
  reviewToken?: string; reviewReason?: string;
}
export interface ReviewStart { reviewToken: string; contextRevision: string; snapshotVersion: number; expiresAt: string }
