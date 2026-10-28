import React, { useEffect, useMemo, useRef, useState } from 'react';
import { BoardNote, incomingCounts, makeBoardNotes, NoteSource } from './board-model';
import { BoardView, getBrowseState, saveBrowseState } from './board-store';
import { NoteRenderer } from './note-renderer';
import type { ValidationResult } from '../contracts/validation';

export interface BoardSnapshot {
  notes: readonly NoteSource[];
  configRevision: string | number;
  status: 'loading' | 'ready' | 'missing' | 'error' | 'offline';
  message?: string;
  validation?: ValidationResult;
  complete?: boolean;
}
export interface DecisionBoardProps {
  sessionId: string;
  snapshot: BoardSnapshot;
  onReference?: (note: BoardNote) => void;
  referenceMessage?: string;
}
const statusNames: Record<string, string> = { implemented: '已落地', proposed: '待评审', rejected: '已否决', archived: '已归档' };
const categoryNames: Record<string, string> = { architecture: '架构设计', feature: '功能特性', 'bug-fix': '缺陷修复', simplification: '化简裁撤', process: '流程规范', testing: '测试基建' };
const tabs: [BoardView, string][] = [['overview', '总览'], ['timeline', '时间线'], ['pitfalls', '避坑清单'], ['directory', '文档目录']];
const name = (map: Record<string, string>, key: string) => map[key] || key;

export function DecisionBoard(props: DecisionBoardProps) {
  return <BoardSession key={props.sessionId} {...props} />;
}
function BoardSession({ sessionId, snapshot, onReference, referenceMessage }: DecisionBoardProps) {
  const [state, setState] = useState(() => getBrowseState(sessionId));
  const scrollRef = useRef<HTMLDivElement>(null);
  const readerRef = useRef<HTMLElement>(null);
  const revision = useRef(snapshot.configRevision);
  useEffect(() => {
    if (revision.current !== snapshot.configRevision) {
      revision.current = snapshot.configRevision;
      setState(old => { const next = { ...old, selected: null, readerScroll: 0 }; saveBrowseState(sessionId, next); return next; });
    }
  }, [sessionId, snapshot.configRevision]);
  const notes = useMemo(() => makeBoardNotes(snapshot.notes), [snapshot.notes]);
  const byId = useMemo(() => new Map(notes.map(n => [n.id, n])), [notes]);
  const ids = useMemo(() => new Set(byId.keys()), [byId]);
  const counts = useMemo(() => incomingCounts(notes), [notes]);
  const selected = snapshot.status === 'ready' && snapshot.complete !== false && revision.current === snapshot.configRevision && state.selected && byId.get(state.selected);
  const update = (change: Partial<typeof state>) => setState(old => {
    const next = { ...old, ...change }; saveBrowseState(sessionId, next); return next;
  });
  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = state.scroll; }, []);
  useEffect(() => { if (readerRef.current) readerRef.current.scrollTop = state.readerScroll; }, [state.selected]);
  useEffect(() => {
    if (snapshot.status === 'ready' && snapshot.complete !== false && state.selected && !byId.has(state.selected)) update({ selected: null, readerScroll: 0 });
  }, [snapshot.status, snapshot.complete, byId, state.selected]);
  const open = (id: string) => update({ selected: id, readerScroll: 0 });
  const filter = (value: string, category = false) => update({ view: 'directory', query: '', status: category ? '' : value, category: category ? value : '' });
  const query = state.query.trim().toLocaleLowerCase();
  const visible = notes.filter(n => (!state.status || n.lifecycle === state.status) && (!state.category || n.cls === state.category) && (!query || `${n.title} ${n.id} ${n.rawBody}`.toLocaleLowerCase().includes(query)))
    .sort((a, b) => state.sort === 'old' ? a.date.localeCompare(b.date) || a.id.localeCompare(b.id) : state.sort === 'cites' ? (counts.get(b.id) || 0) - (counts.get(a.id) || 0) || a.id.localeCompare(b.id) : b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
  const card = (n: BoardNote) => <button key={n.id} className="dnb-card" onClick={() => open(n.id)}><strong>{n.title}</strong><span>{name(categoryNames, n.cls)} · {name(statusNames, n.lifecycle)} · {n.date || '无日期'} · 引用 {counts.get(n.id) || 0}</span><small>{(n.decision || n.problem).slice(0, 180)}</small></button>;
  return <div className="dnb" ref={scrollRef} onScroll={e => update({ scroll: e.currentTarget.scrollTop })}>
    <header className="dnb-header"><strong>工程决策看板 <small>{notes.length} 项</small></strong><nav aria-label="看板视图">{tabs.map(([id, label]) => <button key={id} aria-pressed={state.view === id} onClick={() => update({ view: id })}>{label}</button>)}</nav><input aria-label="搜索笔记" placeholder="搜索决策与避坑" value={state.query} onChange={e => update({ query: e.target.value, view: 'directory' })} /></header>
    <main className="dnb-main">
      <div className="dnb-state" role="status">{snapshot.status === 'loading' ? '正在加载笔记…' : snapshot.status === 'missing' ? '笔记目录尚不存在' : snapshot.status === 'offline' ? '连接已断开，等待重新连接' : snapshot.status === 'error' ? `读取失败：${snapshot.message || '请重试'}` : snapshot.complete === false ? '快照不完整，显示可用数据' : '已同步'}{snapshot.validation && ` · 校验：${snapshot.validation.complete ? `${snapshot.validation.issues.length} 项问题` : '未完成'}`}</div>
      {snapshot.validation && <details className="dnb-panel"><summary>校验详情（{snapshot.validation.complete ? `${snapshot.validation.issues.length} 项问题` : '结果不完整'}）</summary>{(['introduced', 'historical', 'uncertain'] as const).map(group => {
        const issues = snapshot.validation!.issues.filter(issue => issue.attribution === group);
        return <section key={group}><h3>{({ introduced: '本次引入', historical: '历史已有', uncertain: '来源不确定' })[group]}（{issues.length}）</h3>{issues.map((issue, index) => <div className="dnb-issue" key={`${issue.key}:${index}`}><strong>{issue.rule}</strong> · {issue.path || '项目'}<p>{issue.message}</p></div>)}</section>;
      })}{snapshot.validation.warnings.map((warning, index) => <p key={index}>{warning}</p>)}</details>}
      {snapshot.status === 'ready' && !notes.length && <div className="dnb-panel">暂无决策笔记。</div>}
      {state.view === 'overview' && <><div className="dnb-kpis">{[['implemented', '现行落地'], ['proposed', '待评审提案'], ['rejected', '避坑否决'], ['simplification', '化简裁撤']].map(([key, label]) => <button key={key} onClick={() => filter(key, key === 'simplification')}><span>{label}</span><strong>{notes.filter(n => key === 'simplification' ? n.cls === key : n.lifecycle === key).length}</strong></button>)}</div><section className="dnb-panel"><h2>系统承重墙</h2><p>按关联引用展示现行决策</p><div className="dnb-grid">{notes.filter(n => n.lifecycle === 'implemented').sort((a,b) => (counts.get(b.id) || 0) - (counts.get(a.id) || 0)).slice(0,6).map(card)}</div></section><section className="dnb-panel"><h2>领域架构分类</h2><div className="dnb-grid">{Object.entries(categoryNames).map(([category, label]) => <div className="dnb-category" key={category}><h3>{label}</h3>{notes.filter(n => n.cls === category && ['implemented', 'proposed'].includes(n.lifecycle)).map(card)}</div>)}</div></section></>}
      {state.view === 'timeline' && <section className="dnb-panel"><h2>技术演进时间线</h2><div className="dnb-controls"><label>月份 <select value={state.month} onChange={e => update({ month: e.target.value })}><option value="">全部</option>{Array.from(new Set(notes.filter(n => n.date).map(n => n.date.slice(0,7)))).map(m => <option key={m}>{m}</option>)}</select></label><label>分类 <select value={state.timelineCategory} onChange={e => update({ timelineCategory: e.target.value })}><option value="">全部</option>{Object.entries(categoryNames).map(([k,v]) => <option key={k} value={k}>{v}</option>)}</select></label><button onClick={() => update({ month: '', timelineCategory: '' })}>重置</button></div><div className="dnb-timeline">{notes.filter(n => n.date && (!state.month || n.date.startsWith(state.month)) && (!state.timelineCategory || n.cls === state.timelineCategory)).map(card)}</div></section>}
      {state.view === 'pitfalls' && <section className="dnb-panel"><h2>避坑与反思智库</h2><input aria-label="搜索避坑" placeholder="检索被否决方案" value={state.query} onChange={e => update({ query: e.target.value })} /><div className="dnb-grid">{notes.filter(n => (n.lifecycle === 'rejected' || n.alternatives) && (!query || `${n.title} ${n.alternatives} ${n.problem}`.toLocaleLowerCase().includes(query))).map(n => <button className="dnb-card" key={n.id} onClick={() => open(n.id)}><strong>{n.title}</strong><span>{n.lifecycle === 'rejected' ? '已否决提案' : '曾考虑的备选'}</span><small>{n.alternatives || n.problem}</small></button>)}</div></section>}
      {state.view === 'directory' && <section className="dnb-panel"><h2>决策清单</h2><div className="dnb-controls"><label>状态 <select value={state.status} onChange={e => update({ status: e.target.value })}><option value="">全部</option>{Object.entries(statusNames).map(([k,v]) => <option key={k} value={k}>{v}</option>)}</select></label><label>分类 <select value={state.category} onChange={e => update({ category: e.target.value })}><option value="">全部</option>{Object.entries(categoryNames).map(([k,v]) => <option key={k} value={k}>{v}</option>)}</select></label><label>排序 <select value={state.sort} onChange={e => update({ sort: e.target.value })}><option value="new">最新优先</option><option value="old">最早优先</option><option value="cites">引用最多</option></select></label><button onClick={() => update({ status: '', category: '', query: '' })}>重置筛选</button><span>匹配 {visible.length} 条</span></div><div className="dnb-list">{visible.map(card)}</div></section>}
    </main>
    {selected && <div className="dnb-overlay"><button className="dnb-curtain" aria-label="关闭正文" onClick={() => update({ selected: null })}/><aside className="dnb-reader" ref={readerRef} onScroll={e => update({ readerScroll: e.currentTarget.scrollTop })} aria-label="笔记正文"><div className="dnb-reader-head"><span>{name(statusNames, selected.lifecycle)} · {name(categoryNames, selected.cls)}</span><button onClick={() => update({ selected: null })}>关闭</button></div><h2>{selected.title}</h2><p className="dnb-path">{selected.id}</p>{onReference && <button onClick={() => onReference(selected)}>加入当前会话</button>}{referenceMessage && <p role="status">{referenceMessage}</p>}<NoteRenderer body={selected.rawBody} id={selected.id} ids={ids} onOpen={open}/><section><h3>关联笔记</h3><p>引用：{selected.outLinks.map(id => <button className="dnb-link" key={id} onClick={() => open(id)}>{byId.get(id)?.title}</button>)}</p><p>被引用：{notes.filter(n => n.outLinks.includes(selected.id)).map(n => <button className="dnb-link" key={n.id} onClick={() => open(n.id)}>{n.title}</button>)}</p></section></aside></div>}
  </div>;
}
