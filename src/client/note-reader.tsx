import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { BoardNote } from './board-model';
import { ClassBadge, StatusBadge } from './board-ui';
import { NoteRenderer } from './note-renderer';

export interface NoteReaderProps {
  note: BoardNote;
  notes: readonly BoardNote[];
  byId: ReadonlyMap<string, BoardNote>;
  ids: ReadonlySet<string>;
  counts: ReadonlyMap<string, number>;
  notesPath?: string;
  scroll: number;
  onScroll: (value: number) => void;
  onOpen: (id: string) => void;
  onClose: () => void;
  onReference?: (note: BoardNote) => void;
  referenceMessage?: string;
}

const emptyHints = {
  problem: '（未独立分节说明问题）',
  decision: '（未记录具体裁定事实）',
  alternatives: '（无曾考虑的备选对比）',
  consequences: '（未详述工程后果）',
};

export function NoteReader(props: NoteReaderProps) {
  const { note, notes, byId, ids, counts, notesPath, onOpen, onClose, onReference, referenceMessage } = props;
  const bodyRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [copyState, setCopyState] = useState<'idle' | 'ok' | 'fail'>('idle');
  const path = (notesPath || '.agents/notes').replace(/\/+$/, '');
  const anchor = `// Note: 见 ${path}/${note.id}`;
  const cites = counts.get(note.id) || 0;
  const outgoing = note.outLinks.map(id => byId.get(id)).filter((item): item is BoardNote => !!item);
  const incoming = notes.filter(item => item.outLinks.includes(note.id));
  const copyLabel = copyState === 'ok' ? '已复制' : copyState === 'fail' ? '复制失败' : '复制反向代码注释';

  // Restore once per mounted note; later scroll events are owned by the reader.
  useLayoutEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = props.scroll;
  }, []);
  useEffect(() => { closeRef.current?.focus({ preventScroll: true }); }, []);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const copy = async () => {
    if (timer.current) clearTimeout(timer.current);
    try {
      await writeClipboard(anchor);
      setCopyState('ok');
    } catch { setCopyState('fail'); }
    timer.current = setTimeout(() => setCopyState('idle'), 1500);
  };

  const quad = (icon: string, title: string, content: string, hint: string) => <section className="dnb-quad">
    <h3 className="dnb-quad-title"><span aria-hidden="true">{icon}</span>{title}</h3>
    <div className="dnb-quad-content">
      {content.trim() ? <NoteRenderer body={content} id={note.id} ids={ids} onOpen={onOpen} /> : <span className="dnb-empty-inline">{hint}</span>}
    </div>
  </section>;

  return <div className="dnb-overlay">
    <button type="button" className="dnb-curtain" aria-label="关闭正文" onClick={onClose} />
    <aside className="dnb-reader" role="dialog" aria-modal="true" aria-label={`笔记：${note.title}`}>
      <header className="dnb-reader-head">
        <StatusBadge value={note.lifecycle} />
        <ClassBadge value={note.cls} />
        <span className="dnb-spacer" />
        <button type="button" ref={closeRef} className="dnb-icon-btn" onClick={onClose} title="退出 (Esc)" aria-label="关闭正文">✕</button>
      </header>
      <div className="dnb-reader-body" ref={bodyRef} onScroll={event => props.onScroll(event.currentTarget.scrollTop)}>
        <div className="dnb-anchor">
          <code className="dnb-anchor-code" title={anchor}>{anchor}</code>
          <div className="dnb-anchor-actions">
            {onReference && <button type="button" className="dnb-btn-primary" onClick={() => onReference(note)}>加入当前会话</button>}
            <button type="button" className="dnb-btn-ghost" onClick={() => void copy()} aria-live="polite">{copyLabel}</button>
          </div>
        </div>
        {referenceMessage && <p className="dnb-reference-msg" role="status">{referenceMessage}</p>}
        <h2 className="dnb-reader-title">{note.title}</h2>
        <div className="dnb-reader-meta">
          <span>{note.date || '无日期'}</span>
          <span aria-hidden="true">·</span>
          <span>{note.slug}</span>
          {cites > 0 && <><span aria-hidden="true">·</span><span className="dnb-reader-cites">被引用 {cites} 次</span></>}
        </div>
        {quad('🎯', '01. 背景与痛点', note.problem, emptyHints.problem)}
        {quad('⚡', '02. 落地裁定事实', note.decision, emptyHints.decision)}
        {quad('🚫', '03. 审慎考虑并放弃的备选', note.alternatives, emptyHints.alternatives)}
        {quad('⚖️', '04. 收益与工程代价', note.consequences, emptyHints.consequences)}
        <section className="dnb-quad">
          <h3 className="dnb-quad-title"><span aria-hidden="true">🔗</span>05. 因果与血缘依赖链路</h3>
          <div className="dnb-lineage">
            {outgoing.length > 0 && <div>
              <div className="dnb-lineage-title">前置先决依据：</div>
              <div className="dnb-chips">
                {outgoing.map(item => <button type="button" key={item.id} className="dnb-chip" onClick={() => onOpen(item.id)}>↖ {item.title}</button>)}
              </div>
            </div>}
            {incoming.length > 0 && <div>
              <div className="dnb-lineage-title">派生制约影响：</div>
              <div className="dnb-chips">
                {incoming.map(item => <button type="button" key={item.id} className="dnb-chip" onClick={() => onOpen(item.id)}>↘ {item.title}</button>)}
              </div>
            </div>}
            {!outgoing.length && !incoming.length && <span className="dnb-lineage-empty">独立节点，暂无交叉引用</span>}
          </div>
        </section>
        <details className="dnb-fulltext">
          <summary>查看完整笔记正文</summary>
          <NoteRenderer body={note.rawBody} id={note.id} ids={ids} onOpen={onOpen} />
        </details>
      </div>
    </aside>
  </div>;
}

/** HTTP-on-LAN hosts have no async clipboard; keep the anchor copy usable. */
async function writeClipboard(text: string): Promise<void> {
  try {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return; }
  } catch { /* fall through to the legacy copy path */ }
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.top = '-9999px';
  area.style.opacity = '0';
  document.body.append(area);
  try {
    area.select();
    if (typeof document.execCommand !== 'function' || !document.execCommand('copy')) throw new Error('copy failed');
  } finally { area.remove(); }
}
