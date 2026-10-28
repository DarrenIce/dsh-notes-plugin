import React, { useEffect, useRef, useState } from 'react';
import { createDecisionNotesClient, mountDecisionNotesStream } from '../contracts/plugin';
import { DecisionBoard, type BoardSnapshot } from './decision-board';
import { watchBoard, type BoardRemote, type LiveBoardState } from './board-remote';
import { insertNoteReference, type DraftActions } from './note-reference';
import css from './board.css';

export const inject = ['slots', 'connection', 'remote'];

function ConnectedBoard(props: { sessionId: string; remote: BoardRemote; inputActions: DraftActions }) {
  return <ConnectedSession key={props.sessionId} {...props} />;
}
function ConnectedSession({ sessionId, remote, inputActions }: { sessionId: string; remote: BoardRemote; inputActions: DraftActions }) {
  const [live, setLive] = useState<LiveBoardState>({ status: 'loading' });
  const [referenceMessage, setReferenceMessage] = useState('');
  const operation = useRef(0);
  const alive = useRef(false);
  const current = useRef(live);
  useEffect(() => { alive.current = true; return () => { alive.current = false; operation.current++; }; }, []);
  useEffect(() => watchBoard(remote, sessionId, next => { current.current = next; setLive(next); }), [remote, sessionId]);
  const snapshot: BoardSnapshot = {
    status: live.status,
    configRevision: live.context?.configRevision || '',
    configIdentity: live.context ? JSON.stringify([live.context.workspaceId, live.context.projectRoot, live.context.notesRoot, live.context.configRevision]) : undefined,
    notes: live.snapshot?.notes.map(note => ({ id: note.id, raw: note.rawBody })) || [],
    message: live.message,
    complete: live.snapshot?.complete,
    validation: live.snapshot?.validation,
  };
  return <DecisionBoard sessionId={sessionId} snapshot={snapshot} referenceMessage={referenceMessage} onReference={note => {
    const state = current.current;
    const context = state.context;
    if (!alive.current || state.status !== 'ready' || !context || !state.snapshot?.complete || !state.snapshot.notes.some(item => item.id === note.id)) {
      setReferenceMessage('笔记状态已变化，请重新打开后重试。'); return;
    }
    const identity = { sessionId, configRevision: context.configRevision, operation: ++operation.current };
    const ok = insertNoteReference(inputActions, identity, () => {
      const now = current.current;
      return alive.current && now.status === 'ready' && now.context && now.snapshot?.complete
        ? { sessionId, configRevision: now.context.configRevision, operation: operation.current } : undefined;
    }, { title: note.title, notesPath: context.notesPath, id: note.id });
    setReferenceMessage(ok ? '已加入草稿，请在对话中补充并发送。' : '未能加入草稿；草稿可能已变化或正在提交，请重试。');
  }} />;
}

export function apply(ctx: any) {
  const client = createDecisionNotesClient(ctx.connection);
  const mounted = mountDecisionNotesStream(ctx);
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
