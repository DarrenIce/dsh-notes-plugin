import type { WorkspaceContext } from '../contracts/workspace';
import type { NoteSnapshot, NotesChange } from '../contracts/notes';

export interface BoardRemote {
  context(sessionId: string, signal?: AbortSignal): Promise<WorkspaceContext>;
  snapshot(sessionId: string, signal?: AbortSignal): Promise<NoteSnapshot>;
  changes(sessionId: string, signal: AbortSignal): AsyncIterable<NotesChange>;
}
export interface LiveBoardState {
  status: 'loading' | 'ready' | 'missing' | 'error' | 'offline';
  context?: WorkspaceContext;
  snapshot?: NoteSnapshot;
  message?: string;
}

/** Own one session's stream; stale requests cannot publish after teardown or invalidation. */
export function watchBoard(remote: BoardRemote, sessionId: string, publish: (state: LiveBoardState) => void): () => void {
  const abort = new AbortController();
  let generation = 0;
  let context: WorkspaceContext | undefined;
  let current: NoteSnapshot | undefined;
  const accept = (candidate: NoteSnapshot) => {
    if (!context || candidate.workspaceId !== context.workspaceId || candidate.configRevision !== context.configRevision) return false;
    if (current && candidate.snapshotVersion < current.snapshotVersion) return false;
    current = candidate;
    publish({ status: candidate.status, context, snapshot: candidate, message: candidate.message });
    return true;
  };
  const pause = () => new Promise<void>(resolve => {
    const timer = setTimeout(done, 1000);
    function done() { clearTimeout(timer); abort.signal.removeEventListener('abort', done); resolve(); }
    abort.signal.addEventListener('abort', done, { once: true });
    if (abort.signal.aborted) done();
  });
  async function run() {
    publish({ status: 'loading' });
    while (!abort.signal.aborted) {
      const runId = ++generation;
      try {
        context = await remote.context(sessionId, abort.signal);
        if (abort.signal.aborted || runId !== generation) return;
        current = undefined;
        const initial = await remote.snapshot(sessionId, abort.signal);
        if (abort.signal.aborted || runId !== generation) return;
        if (!accept(initial)) { await pause(); continue; }
        let invalidated = false;
        for await (const event of remote.changes(sessionId, abort.signal)) {
          if (abort.signal.aborted || runId !== generation) return;
          if (event.type === 'invalidated') { invalidated = true; break; }
          if (event.type === 'error') { publish({ status: 'error', context, snapshot: current, message: event.message }); continue; }
          if (event.snapshot.workspaceId !== context.workspaceId || event.snapshot.configRevision !== context.configRevision) { invalidated = true; break; }
          accept(event.snapshot);
        }
        if (abort.signal.aborted) return;
        if (invalidated) { publish({ status: 'loading' }); continue; }
        publish({ status: 'offline', message: '连接已断开，正在重新同步' });
      } catch (error) {
        if (abort.signal.aborted) return;
        publish({ status: 'error', message: error instanceof Error ? error.message : String(error) });
      }
      await pause();
    }
  }
  void run();
  return () => { generation++; abort.abort(); };
}
