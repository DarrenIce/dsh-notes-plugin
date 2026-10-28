import React, { useEffect, useState } from 'react';
import { createDecisionNotesClient, mountDecisionNotesStream } from '../contracts/plugin';
import { DecisionBoard, type BoardSnapshot } from './decision-board';
import { watchBoard, type BoardRemote, type LiveBoardState } from './board-remote';
import css from './board.css';

export const inject = ['slots', 'connection', 'remote'];

function ConnectedBoard(props: { sessionId: string; remote: BoardRemote }) {
  return <ConnectedSession key={props.sessionId} {...props} />;
}
function ConnectedSession({ sessionId, remote }: { sessionId: string; remote: BoardRemote }) {
  const [live, setLive] = useState<LiveBoardState>({ status: 'loading' });
  useEffect(() => watchBoard(remote, sessionId, setLive), [remote, sessionId]);
  const snapshot: BoardSnapshot = {
    status: live.status,
    configRevision: live.context?.configRevision || '',
    notes: live.snapshot?.notes.map(note => ({ id: note.id, raw: note.rawBody })) || [],
    message: live.message,
    complete: live.snapshot?.complete,
    validation: live.snapshot ? (!live.snapshot.validation.complete ? '未完成' : `${live.snapshot.validation.issues.length} 项问题`) : undefined,
  };
  return <DecisionBoard sessionId={sessionId} snapshot={snapshot} />;
}

export function apply(ctx: any) {
  const client = createDecisionNotesClient(ctx.connection);
  const mounted = mountDecisionNotesStream(ctx.remote);
  const remote: BoardRemote = {
    ...client,
    async *changes(sessionId, signal) {
      const stream = (await mounted).open(sessionId, signal);
      try { for await (const change of stream) yield change; }
      finally { await stream.dispose(); }
    },
  };
  ctx.effect(() => () => { void mounted.then(stream => stream.dispose()).catch(() => {}); }, 'decision-notes: stream');
  ctx.effect(() => {
    const style = document.createElement('style');
    style.dataset.plugin = 'write-notes-like-deepseek';
    style.textContent = css;
    document.head.appendChild(style);
    return () => style.remove();
  }, 'decision-notes: styles');
  ctx.slots.inject('conversation.view', () => ctx.slots.register({
    name: 'conversation.view', id: 'decision-notes', order: 20, label: '决策看板',
    inject: (sessionId: string) => ({ sessionId, remote }),
  }, ConnectedBoard));
}
