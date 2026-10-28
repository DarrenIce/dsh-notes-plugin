import type { WorkspaceContext } from './workspace.js';
import type { NoteSnapshot, NoteDocument, NotesChange } from './notes.js';
import type { ValidationResult, ReviewStart } from './validation.js';

/** Mount the Gateway contribution and borrow its namespace from an injected scope. */
export async function mountDecisionNotesStream(ctx: {
  remote: { $mount(contribution: unknown): Promise<() => Promise<void>> };
  inject(deps: string[], callback: (scope: { remote: { decisionNotes: { changes(sessionId: string, signal?: AbortSignal): AsyncIterable<NotesChange> & { dispose(): Promise<void> } } } }) => (() => void)): PromiseLike<{ dispose(): Promise<void> }>;
}) {
  const descriptor = {
    id: 'write-notes-like-deepseek#decisionNotes/changes', service: 'decisionNotes', namespace: 'decisionNotes', method: 'changes', mode: 'stream',
    invocation: { kind: 'direct' },
    parameters: [{ name: 'sessionId', wire: 'sessionId', source: 'json', codec: { mode: 'strict', typeSymbol: 'decisionNotes#sessionId', create: () => ({ parse: (value: unknown) => {
      if (typeof value !== 'string' || !value) throw new TypeError('Invalid sessionId');
      return value;
    } }) } }],
    cancellation: { parameter: 'signal' }, result: { mode: 'src-json' },
  };
  const unmount = await ctx.remote.$mount({ package: 'write-notes-like-deepseek', descriptors: [descriptor] });
  let namespace: { changes(sessionId: string, signal?: AbortSignal): AsyncIterable<NotesChange> & { dispose(): Promise<void> } } | undefined;
  let fiber: { dispose(): Promise<void> };
  try {
    fiber = await ctx.inject(['remote', 'remote.decisionNotes'], scope => {
      namespace = scope.remote.decisionNotes;
      return () => { namespace = undefined; };
    });
  } catch (error) {
    await unmount();
    throw error;
  }
  return {
    open(sessionId: string, signal?: AbortSignal) {
      if (!namespace) throw new Error('Decision notes stream is not mounted');
      return namespace.changes(sessionId, signal);
    },
    async dispose() { await fiber.dispose(); await unmount(); },
  };
}
/** Minimal public Connection face; all calls pass through DSH Gateway. */
export interface NotesConnection {
  rpc: { call(channel: string, endpoint: string, payload: unknown, signal?: AbortSignal): Promise<{ ok: true; value: unknown } | { ok: false; error: { code: string; message: string } }> };
}

/** The server must declare the session resource on every endpoint. */
export function createDecisionNotesClient(connection: NotesConnection) {
  async function call<T>(method: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
    const result = await connection.rpc.call('/api', `decisionNotes/${method}`, { args }, signal);
    if (!result.ok) {
      const error = new Error(result.error.message);
      Object.assign(error, { code: result.error.code });
      throw error;
    }
    return result.value as T;
  }
  return {
    context: (sessionId: string, signal?: AbortSignal) => call<WorkspaceContext>('context', { sessionId }, signal),
    snapshot: (sessionId: string, signal?: AbortSignal) => call<NoteSnapshot>('snapshot', { sessionId }, signal),
    read: (sessionId: string, id: string, signal?: AbortSignal) => call<NoteDocument>('read', { sessionId, id }, signal),
    validation: (sessionId: string, reviewToken?: string, signal?: AbortSignal) => call<ValidationResult>('validation', { sessionId, ...(reviewToken === undefined ? {} : { reviewToken }) }, signal),
    beginReview: (sessionId: string, signal?: AbortSignal) => call<ReviewStart>('beginReview', { sessionId }, signal),
  };
}
