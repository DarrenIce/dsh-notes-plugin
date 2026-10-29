import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { BoardNote, incomingCounts, makeBoardNotes, NoteSource } from './board-model';
import { BoardView, BrowseState, getBrowseState, saveBrowseState } from './board-store';
import { BaselineView, DirectoryView, PitfallsView, TimelineView } from './board-views';
import { NoteReader } from './note-reader';
import { classLabels, label } from './board-ui';
import type { ValidationResult } from '../contracts/validation';

export interface BoardSnapshot {
  notes: readonly NoteSource[];
  configRevision: string | number;
  configIdentity?: string;
  notesPath?: string;
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
  /** Hide the host composer while this board view is mounted; returns its disposer. */
  maskComposer?: () => () => void;
}

const tabs: [BoardView, string, string][] = [
  ['overview', '🏛️', '架构基线'],
  ['timeline', '⏱️', '演进时间线'],
  ['pitfalls', '🛡️', '避坑智库'],
  ['directory', '📋', '决策清单'],
];
const issueGroups = [
  ['introduced', '本次引入'],
  ['historical', '历史已有'],
  ['uncertain', '来源不确定'],
] as const;

export function DecisionBoard(props: DecisionBoardProps) {
  return <BoardSession key={props.sessionId} {...props} />;
}

function BoardSession({ sessionId, snapshot, onReference, referenceMessage, maskComposer }: DecisionBoardProps) {
  const [state, setState] = useState(() => getBrowseState(sessionId));
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchIndex, setSearchIndex] = useState(-1);
  const scrollRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const scrollRestored = useRef(false);
  const maskRef = useRef(maskComposer);
  const identity = snapshot.status !== 'loading' && snapshot.configRevision !== ''
    ? snapshot.configIdentity ?? String(snapshot.configRevision) : null;

  useEffect(() => { maskRef.current = maskComposer; }, [maskComposer]);
  // The view is mounted only while its tab is active, so this takeover also
  // restores the resident composer on the next tab switch.
  useEffect(() => {
    const dispose = maskRef.current?.();
    return () => { dispose?.(); };
  }, []);

  useEffect(() => {
    if (identity === null) return;
    setState(old => {
      if (old.configIdentity === identity) return old;
      const changed = old.configIdentity !== null;
      const next = { ...old, configIdentity: identity, ...(changed ? { selected: null, readerScroll: 0 } : {}) };
      saveBrowseState(sessionId, next);
      return next;
    });
  }, [sessionId, identity]);

  const notes = useMemo(() => makeBoardNotes(snapshot.notes), [snapshot.notes]);
  const byId = useMemo(() => new Map(notes.map(note => [note.id, note])), [notes]);
  const ids = useMemo(() => new Set(byId.keys()), [byId]);
  const counts = useMemo(() => incomingCounts(notes), [notes]);
  const identityMatches = identity !== null && (state.configIdentity === null || state.configIdentity === identity);
  const selected = snapshot.status === 'ready' && snapshot.complete !== false && identityMatches && state.selected
    ? byId.get(state.selected) : undefined;
  const update = (change: Partial<BrowseState>) => setState(old => {
    const next = { ...old, ...change };
    saveBrowseState(sessionId, next);
    return next;
  });

  useLayoutEffect(() => {
    scrollRestored.current = false;
    if (snapshot.status === 'ready' && snapshot.complete !== false && identityMatches && scrollRef.current) {
      scrollRef.current.scrollTop = state.scroll;
      scrollRestored.current = true;
    }
    return () => { scrollRestored.current = false; };
  }, [snapshot.status, snapshot.complete, identityMatches]);

  useEffect(() => {
    if (snapshot.status === 'ready' && snapshot.complete !== false && identityMatches && state.selected && !byId.has(state.selected)) {
      update({ selected: null, readerScroll: 0 });
    }
  }, [snapshot.status, snapshot.complete, identityMatches, byId, state.selected]);

  useEffect(() => {
    if (!searchOpen) return;
    const close = (event: MouseEvent) => {
      if (!searchRef.current?.contains(event.target as Node | null)) setSearchOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [searchOpen]);

  const needle = state.query.trim().toLocaleLowerCase();
  const matches = useMemo(() => needle
    ? notes.filter(note => `${note.title} ${note.slug} ${note.problem} ${note.decision}`.toLocaleLowerCase().includes(needle))
    : [], [notes, needle]);
  const topMatches = matches.slice(0, 7);
  const popoverOpen = searchOpen && !!needle;

  const open = (id: string) => {
    setSearchOpen(false);
    update({ selected: id, readerScroll: 0 });
  };
  const filter = (value: string, category = false) => update({
    view: 'directory', query: '', altQuery: '',
    status: category ? '' : value, category: category ? value : '',
  });
  const isEditable = (target: EventTarget | null) => {
    const element = target as HTMLElement | null;
    return !!element && (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA' || element.tagName === 'SELECT' || element.isContentEditable);
  };

  const validation = snapshot.validation;
  const issueCount = validation?.issues.length ?? 0;
  const warnings = validation?.warnings ?? [];
  const incomplete = snapshot.complete === false;
  const ready = snapshot.status === 'ready';
  const alertNeeded = !(ready && !incomplete)
    || !!validation && (!validation.complete || issueCount > 0 || warnings.length > 0);
  const alertTone = snapshot.status === 'error' ? 'error' : issueCount > 0 || validation?.complete === false ? 'warn' : 'info';
  const statusText = snapshot.status === 'loading' ? '正在同步笔记…'
    : snapshot.status === 'missing' ? '笔记目录尚不存在'
      : snapshot.status === 'offline' ? snapshot.message || '连接已断开，等待重新连接'
        : snapshot.status === 'error' ? `读取失败：${snapshot.message || '请重试'}`
          : incomplete ? '快照不完整，显示可用数据' : '已同步';
  const beaconTone = snapshot.status === 'loading' ? 'syncing'
    : snapshot.status === 'error' ? 'error'
      : snapshot.status === 'missing' ? 'idle'
        : snapshot.status === 'offline' || incomplete ? 'warn' : 'active';
  const beaconText = snapshot.status === 'loading' ? '正在同步…'
    : snapshot.status === 'missing' ? '等待笔记目录'
      : snapshot.status === 'offline' ? '连接已断开，重连中'
        : snapshot.status === 'error' ? '读取失败'
          : incomplete ? '快照不完整' : `已同步 · ${notes.length} 篇`;
  const alertSummary = [
    statusText,
    validation ? `校验：${validation.complete ? `${issueCount} 项问题` : '结果不完整'}` : '',
    warnings.length ? `${warnings.length} 条提示` : '',
  ].filter(Boolean).join(' · ');
  const showOnboarding = notes.length === 0 && snapshot.status !== 'loading' && snapshot.status !== 'error' && snapshot.status !== 'offline';
  const onboardingText = snapshot.status === 'missing'
    ? '当前项目尚未创建笔记目录。把「为什么这样定、放弃了什么」写进第一篇 Agent Note，保存后这里会自动同步。'
    : '当前项目还没有决策笔记。记录一条真实决策——为什么这样定、放弃了什么——保存后这里会自动同步。';

  return <div
    className={`dnb${selected ? ' dnb--reading' : ''}`}
    ref={scrollRef}
    onScroll={event => {
      if (scrollRestored.current && snapshot.status === 'ready' && snapshot.complete !== false && identityMatches) {
        update({ scroll: event.currentTarget.scrollTop });
      }
    }}
    onKeyDown={event => {
      if (event.key === 'Escape' && selected) {
        event.stopPropagation();
        update({ selected: null });
      } else if (event.key === '/' && !selected && !isEditable(event.target)) {
        event.preventDefault();
        searchInputRef.current?.focus();
      }
    }}
  >
    <header className="dnb-topbar">
      <div className="dnb-brand">
        <span className="dnb-brand-logo" aria-hidden="true" />
        <span className="dnb-brand-text">
          <span>工程决策看板</span>
          <span className="dnb-chip">{notes.length} 项</span>
        </span>
      </div>
      <nav className="dnb-tabs" aria-label="看板视图">
        {tabs.map(([id, icon, text]) => <button
          type="button"
          key={id}
          className="dnb-tab"
          aria-pressed={state.view === id}
          onClick={() => { setSearchOpen(false); update({ view: id }); }}
        ><span aria-hidden="true">{icon}</span> {text}</button>)}
      </nav>
      <span className="dnb-grow" />
      <div className="dnb-search" ref={searchRef}>
        <svg className="dnb-search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
        <input
          ref={searchInputRef}
          type="text"
          role="combobox"
          aria-label="搜索笔记"
          aria-expanded={popoverOpen}
          aria-controls="dnb-search-popover"
          aria-autocomplete="list"
          placeholder="快速搜索决策与避坑..."
          value={state.query}
          onFocus={() => { if (needle) setSearchOpen(true); }}
          onInput={event => {
            update({ query: event.currentTarget.value, altQuery: event.currentTarget.value });
            setSearchOpen(true);
            setSearchIndex(-1);
          }}
          onKeyDown={event => {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              if (!topMatches.length) return;
              event.preventDefault();
              setSearchIndex(index => {
                if (event.key === 'ArrowDown') return (index + 1) % topMatches.length;
                return (index - 1 + topMatches.length) % topMatches.length;
              });
            } else if (event.key === 'Enter') {
              event.preventDefault();
              if (searchIndex >= 0 && topMatches[searchIndex]) open(topMatches[searchIndex].id);
              else { setSearchOpen(false); update({ view: 'directory' }); }
            } else if (event.key === 'Escape') {
              event.stopPropagation();
              setSearchOpen(false);
            }
          }}
        />
        <span className="dnb-shortcut" aria-hidden="true">/</span>
        {popoverOpen && <div className="dnb-popover" id="dnb-search-popover" role="listbox" aria-label="搜索结果">
          {topMatches.length ? <>
            {topMatches.map((note, index) => <button
              type="button"
              role="option"
              aria-selected={index === searchIndex}
              key={note.id}
              className={`dnb-popover-item${index === searchIndex ? ' selected' : ''}`}
              onMouseEnter={() => setSearchIndex(index)}
              onClick={() => open(note.id)}
            >
              <span className="dnb-popover-main">
                <span className="dnb-popover-title">{note.title}</span>
                <span className="dnb-popover-sub">
                  <span className={`dnb-badge dnb-class cls-${note.cls}`}>{label(classLabels, note.cls)}</span>
                  <span>{note.date || '进行中'}</span>
                  <span>#{note.slug}</span>
                </span>
              </span>
              {(counts.get(note.id) || 0) > 0 && <span className="dnb-weight">↗{counts.get(note.id)}</span>}
            </button>)}
            <div className="dnb-popover-foot">
              <span>共找到 <b>{matches.length}</b> 项决策</span>
              <span>按 ↵ 回车在全量清单中查看全部</span>
            </div>
          </> : <div className="dnb-popover-empty">// 未找到与 "{state.query}" 匹配的决策记录</div>}
        </div>}
      </div>
      <div className={`dnb-beacon tone-${beaconTone}`} role="status" aria-live="polite" title={snapshot.message || statusText}>
        <span className={`dnb-radar${beaconTone === 'active' ? ' active' : beaconTone === 'syncing' ? ' syncing' : ''}`} aria-hidden="true" />
        <span>{beaconText}</span>
      </div>
    </header>

    <main className="dnb-main">
      {alertNeeded && <details className={`dnb-alert tone-${alertTone}`}>
        <summary><span className="dnb-alert-mark" aria-hidden="true" /> {alertSummary}</summary>
        <div className="dnb-alert-body">
          {validation && issueGroups.map(([group, text]) => {
            const issues = validation.issues.filter(issue => issue.attribution === group);
            return <section key={group}>
              <h4>{text}（{issues.length}）</h4>
              {issues.map((issue, index) => <div className="dnb-issue" key={`${issue.key}:${index}`}>
                <strong>{issue.rule}</strong>
                <span className="dnb-issue-path">{issue.path || '项目'}</span>
                <p>{issue.message}</p>
              </div>)}
            </section>;
          })}
          {validation && !validation.complete && <p className="dnb-alert-note">校验结果不完整，尚不能据此判断整个笔记根。</p>}
          {warnings.length > 0 && <ul className="dnb-alert-warnings">{warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>}
          {!validation && snapshot.message && <p className="dnb-alert-note">{snapshot.message}</p>}
        </div>
      </details>}

      {showOnboarding && <section className="dnb-onboarding">
        <span className="dnb-brand-logo large" aria-hidden="true" />
        <h2>工程决策看板</h2>
        <p>{onboardingText}</p>
      </section>}

      {!showOnboarding && <div className="dnb-view" key={state.view}>
        {state.view === 'overview' && <BaselineView notes={notes} counts={counts} onOpen={open} onKpi={filter} />}
        {state.view === 'timeline' && <TimelineView
          notes={notes}
          counts={counts}
          onOpen={open}
          month={state.month}
          category={state.timelineCategory}
          onMonth={month => update({ month })}
          onCategory={category => update({ timelineCategory: category })}
          onReset={() => update({ month: '', timelineCategory: '' })}
        />}
        {state.view === 'pitfalls' && <PitfallsView
          notes={notes}
          counts={counts}
          onOpen={open}
          query={state.altQuery}
          onQuery={altQuery => update({ altQuery })}
        />}
        {state.view === 'directory' && <DirectoryView
          notes={notes}
          counts={counts}
          onOpen={open}
          query={state.query}
          status={state.status}
          category={state.category}
          sort={state.sort}
          onStatus={status => update({ status })}
          onCategory={category => update({ category })}
          onSort={sort => update({ sort })}
          onReset={() => update({ status: '', category: '', query: '' })}
        />}
      </div>}

      <footer className="dnb-footer">
        <span>Agent Notes · 工程决策看板</span>
        <span>{notes.length} 项决策 · 会话实时快照</span>
      </footer>
    </main>

    {selected && <NoteReader
      key={selected.id}
      note={selected}
      notes={notes}
      byId={byId}
      ids={ids}
      counts={counts}
      notesPath={snapshot.notesPath}
      scroll={state.readerScroll}
      onScroll={readerScroll => update({ readerScroll })}
      onOpen={open}
      onClose={() => update({ selected: null })}
      onReference={onReference}
      referenceMessage={referenceMessage}
    />}
  </div>;
}
