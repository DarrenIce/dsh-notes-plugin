import { fileURLToPath } from 'node:url';
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import { NotesConfiguration, type NotesConfig } from './server/config.js';
import { WorkspaceResolver } from './server/workspace-context.js';
import { NotesService } from './server/note-service.js';
import { installNoteAgent } from './server/note-tools.js';
import type { NotesChange } from './contracts/notes.js';

export const name = 'decision-notes';
export const inject = ['sessions', 'workspaceRegistry', 'typert', 'remoteAccess', 'skills', 'systemPrompt', 'tools', 'workingDirectory'];
const resources = { session: (sessionId: string) => sessionId };

class DecisionNotesRemote extends TypertRemoteService {
  constructor(ctx: any, readonly service: NotesService, readonly resolver: WorkspaceResolver, readonly lifetime: AbortSignal) { super(ctx, 'decisionNotes'); }
  @Remote({ resources })
  async context(sessionId: string, signal: AbortSignal) { signal.throwIfAborted(); return this.resolver.resolve(sessionId); }
  @Remote({ resources })
  async snapshot(sessionId: string, signal: AbortSignal) { signal.throwIfAborted(); return this.service.snapshot(sessionId); }
  @Remote({ resources })
  async read(sessionId: string, id: string, signal: AbortSignal) { signal.throwIfAborted(); return this.service.read(sessionId, id); }
  @Remote({ resources })
  async validation(sessionId: string, reviewToken: string | undefined, signal: AbortSignal) { signal.throwIfAborted(); return this.service.validation(sessionId, reviewToken); }
  @Remote({ resources })
  async beginReview(sessionId: string, signal: AbortSignal) { signal.throwIfAborted(); return this.service.beginReview(sessionId); }
  @Remote({ mode: 'stream', resources })
  async *changes(sessionId: string, signal: AbortSignal): AsyncGenerator<NotesChange> {
    signal = AbortSignal.any([signal, this.lifetime]);
    signal.throwIfAborted();
    let wake: (() => void) | undefined;
    let queued: NotesChange | undefined;
    const notify = () => { wake?.(); wake = undefined; };
    const onAbort = () => notify();
    signal.addEventListener('abort', onAbort, { once: true });
    let unsubscribe: (() => void) | undefined;
    try {
      unsubscribe = await this.service.subscribe(sessionId, event => {
        if (queued?.type !== 'invalidated' && (event.type !== 'snapshot' || queued?.type !== 'error')) queued = event;
        notify();
      });
      while (!signal.aborted) {
        if (queued) {
          const event = queued; queued = undefined;
          const access = (this.ctx as typeof this.ctx & { remoteAccess: { allows(resource: { kind: 'session'; id: string }): boolean } }).remoteAccess;
          if (!access.allows({ kind: 'session', id: sessionId })) throw new Error('Session access revoked');
          yield event; continue;
        }
        await new Promise<void>(resolve => { wake = resolve; if (signal.aborted || queued) notify(); });
      }
    } finally {
      signal.removeEventListener('abort', onAbort);
      unsubscribe?.();
    }
  }
}

export function apply(ctx: any, config: NotesConfig = {}) {
  const configuration = new NotesConfiguration(config);
  const resolver = new WorkspaceResolver({
    async header(sessionId) {
      const live = ctx.sessions.get(sessionId)?.header;
      if (live) return live;
      return (await ctx.get('sessionPersistence')?.stat(sessionId))?.header;
    },
    workspaces: () => ctx.workspaceRegistry.list(),
  }, configuration);
  const service = new NotesService(resolver);
  const lifetime = new AbortController();
  ctx.effect(() => () => { lifetime.abort(); service.dispose(); }, 'decision-notes.service');
  new DecisionNotesRemote(ctx, service, resolver, lifetime.signal);
  installNoteAgent(ctx, service, resolver, { skillRoot: fileURLToPath(new URL('../assets/write-notes-like-deepseek/', import.meta.url)) });
}
