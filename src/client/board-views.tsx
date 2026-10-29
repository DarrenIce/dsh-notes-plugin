import React, { useMemo } from 'react';
import { BoardNote, byDateAsc, byDateDesc, excerpt, pitfallEntries } from './board-model';
import { ClassBadge, EmptyLine, Panel, StatusBadge, classLabels, classOrder, label, statusLabels } from './board-ui';

export interface ViewProps {
  notes: readonly BoardNote[];
  counts: ReadonlyMap<string, number>;
  onOpen: (id: string) => void;
}

const cites = (counts: ReadonlyMap<string, number>, id: string) => counts.get(id) || 0;

export function BaselineView({ notes, counts, onOpen, onKpi }: ViewProps & { onKpi: (value: string, category: boolean) => void }) {
  const implemented = notes.filter(note => note.lifecycle === 'implemented');
  const proposed = notes.filter(note => note.lifecycle === 'proposed');
  const rejected = notes.filter(note => note.lifecycle === 'rejected');
  const simplifications = notes.filter(note => note.cls === 'simplification');
  const kpis = [
    { key: 'implemented', label: '现行落地', desc: '生产已交付生效', color: '#10B981', count: implemented.length, category: false },
    { key: 'proposed', label: '待评审提案', desc: '待团队确认', color: '#F59E0B', count: proposed.length, category: false },
    { key: 'rejected', label: '避坑否决', desc: '防重犯事实存档', color: '#FF3366', count: rejected.length, category: false },
    { key: 'simplification', label: '化简裁撤', desc: '代码只减不增', color: '#14B8A6', count: simplifications.length, category: true },
  ];
  const pillars = [...implemented].sort((a, b) => cites(counts, b.id) - cites(counts, a.id) || byDateDesc(a, b)).slice(0, 6);
  const active = notes.filter(note => note.lifecycle === 'implemented' || note.lifecycle === 'proposed');
  return <>
    <div className="dnb-kpis">
      {kpis.map(kpi => <button
        key={kpi.key}
        className="dnb-kpi"
        style={{ '--kpi-accent': kpi.color } as React.CSSProperties}
        onClick={() => onKpi(kpi.key, kpi.category)}
        title={`查看${kpi.label}`}
      >
        <span className="dnb-kpi-tag"><span>{kpi.label}</span><span className="dnb-kpi-dot" aria-hidden="true" /></span>
        <span className="dnb-kpi-num">{kpi.count}</span>
        <span className="dnb-kpi-caption">{kpi.desc}</span>
        <span className="dnb-kpi-bar" aria-hidden="true" />
      </button>)}
    </div>

    <Panel icon="🏛️" title="系统承重墙" annotation="基于交叉引用入度权重萃取的系统关键协议">
      {pillars.length
        ? <div className="dnb-pillars">{pillars.map(note => <button key={note.id} className="dnb-pillar" onClick={() => onOpen(note.id)}>
          <span className="dnb-pillar-main">
            <span className="dnb-pillar-meta"><ClassBadge value={note.cls} /><span className="dnb-weight">被引用 × {cites(counts, note.id)}</span></span>
            <span className="dnb-pillar-title">{note.title}</span>
            <span className="dnb-pillar-abstract">{excerpt(note.decision || note.problem || '系统核心架构协议', 180)}</span>
          </span>
          <span className="dnb-pillar-telemetry"><span>{note.date || '进行中'}</span><span>#{note.slug}</span></span>
        </button>)}</div>
        : <EmptyLine>暂无可萃取的核心决策</EmptyLine>}
    </Panel>

    <Panel icon="🧩" title="领域架构分类阵列" annotation="现行生效的生产事实全景清单">
      <div className="dnb-chambers">
        {classOrder.map(cls => {
          const items = active.filter(note => note.cls === cls);
          return <div className="dnb-chamber" key={cls}>
            <div className="dnb-chamber-head">
              <span className="dnb-chamber-name"><span className="dnb-chamber-square" aria-hidden="true" />{label(classLabels, cls)}</span>
              <span className="dnb-chamber-count">{items.length}</span>
            </div>
            <div className="dnb-chamber-stream">
              {items.length ? items.map(note => <button key={note.id} className="dnb-specimen" onClick={() => onOpen(note.id)}>
                <span className="dnb-specimen-title">{note.title}</span>
                <span className="dnb-specimen-info">
                  <span>{note.date || '—'}</span>
                  {cites(counts, note.id) > 0 && <span className="dnb-specimen-cites">↗{cites(counts, note.id)}</span>}
                </span>
              </button>) : <p className="dnb-empty-line">// 暂无该类活跃决策</p>}
            </div>
          </div>;
        })}
      </div>
    </Panel>
  </>;
}

export function TimelineView({ notes, onOpen, month, category, onMonth, onCategory, onReset }: ViewProps & {
  month: string; category: string;
  onMonth: (value: string) => void; onCategory: (value: string) => void; onReset: () => void;
}) {
  const dated = useMemo(() => notes.filter(note => note.date).sort(byDateDesc), [notes]);
  const months = useMemo(() => {
    const groups = new Map<string, number>();
    for (const note of dated) {
      const key = note.date.slice(0, 7);
      groups.set(key, (groups.get(key) || 0) + 1);
    }
    return [...groups.entries()];
  }, [dated]);
  const classCounts = useMemo(() => {
    const groups = new Map<string, number>();
    for (const note of dated) groups.set(note.cls, (groups.get(note.cls) || 0) + 1);
    return groups;
  }, [dated]);
  const filtered = dated.filter(note => (!month || note.date.startsWith(month)) && (!category || note.cls === category));
  const groups = useMemo(() => {
    const result = new Map<string, BoardNote[]>();
    for (const note of filtered) {
      const key = note.date.slice(0, 7);
      const bucket = result.get(key);
      if (bucket) bucket.push(note); else result.set(key, [note]);
    }
    return result;
  }, [filtered]);
  const sliced = [month, category ? label(classLabels, category) : ''].filter(Boolean);
  const summary = sliced.length
    ? `已切片 [${sliced.join(' · ')}] 对应 ${filtered.length} 条记录`
    : `全周期全分类共 ${filtered.length} 条演化记录`;
  return <Panel icon="⏱️" title="技术演进时间线" annotation="记录架构突破与代码裁撤里程碑">
    <div className="dnb-toolbar">
      <div className="dnb-filter-row">
        <span className="dnb-filter-label">📅 月份切片:</span>
        <div className="dnb-pills">
          <button className={`dnb-pill month-pill${!month ? ' active' : ''}`} aria-pressed={!month} onClick={() => onMonth('')}>全部 ({dated.length})</button>
          {months.map(([key, count]) => <button key={key} className={`dnb-pill month-pill${month === key ? ' active' : ''}`} aria-pressed={month === key} onClick={() => onMonth(key)}>{key} ({count})</button>)}
        </div>
      </div>
      <div className="dnb-filter-row">
        <span className="dnb-filter-label">🏷️ 分类切片:</span>
        <div className="dnb-pills">
          <button className={`dnb-pill class-pill${!category ? ' active' : ''}`} aria-pressed={!category} onClick={() => onCategory('')}>全部分类 ({dated.length})</button>
          {classOrder.map(cls => <button key={cls} className={`dnb-pill class-pill${category === cls ? ' active' : ''}`} aria-pressed={category === cls} onClick={() => onCategory(cls)}>{label(classLabels, cls)} ({classCounts.get(cls) || 0})</button>)}
        </div>
      </div>
      <div className="dnb-toolbar-foot">
        <span>{summary}</span>
        <button className="dnb-text-btn" onClick={onReset}>重置时间线筛选</button>
      </div>
    </div>

    <div className="dnb-chrono">
      {groups.size ? [...groups.entries()].map(([key, items]) => <div className="dnb-epoch" key={key}>
        <div className="dnb-epoch-badge">{key} · {items.length} 条</div>
        <div className="dnb-epoch-cards">
          {items.map(note => <button key={note.id} className="dnb-chrono-card" onClick={() => onOpen(note.id)}>
            <span className="dnb-chrono-pulse" aria-hidden="true" />
            <span className="dnb-chrono-meta">
              <span className="dnb-date-badge">📅 {note.date || '进行中'}</span>
              <ClassBadge value={note.cls} />
              <StatusBadge value={note.lifecycle} />
              <span className="dnb-chrono-title">{note.title}</span>
            </span>
            <span className="dnb-chrono-body">{excerpt(note.problem || note.decision, 180)}</span>
          </button>)}
        </div>
      </div>) : <EmptyLine>未找到符合此切片组合的演化记录</EmptyLine>}
    </div>
  </Panel>;
}

export function PitfallsView({ notes, onOpen, query, onQuery }: ViewProps & { query: string; onQuery: (value: string) => void }) {
  const entries = useMemo(() => pitfallEntries(notes), [notes]);
  const needle = query.trim().toLocaleLowerCase();
  const filtered = needle
    ? entries.filter(item => `${item.discarded} ${item.crux} ${item.title}`.toLocaleLowerCase().includes(needle))
    : entries;
  return <Panel icon="🛡️" title="避坑与反思智库" annotation="记录「为什么放弃了方案 B」与被否决的提案，防止重复踩坑">
    <input
      type="text"
      className="dnb-alt-search"
      aria-label="检索被否决方案"
      placeholder="检索被否决方案关键字（如：SQLite、多进程、Redis...）"
      value={query}
      onInput={event => onQuery(event.currentTarget.value)}
    />
    <div className="dnb-pitfalls">
      {filtered.length ? filtered.map((item, index) => <button key={`${item.noteId}:${index}`} className="dnb-pitfall" onClick={() => onOpen(item.noteId)}>
        <span className="dnb-pitfall-top">
          <ClassBadge value={item.cls} />
          <span className="dnb-hash">#{item.slug}</span>
        </span>
        <span className="dnb-hazard">🚫 放弃备选：{item.discarded}</span>
        <span className="dnb-crux">💡 权衡依据：{item.crux}</span>
        <span className="dnb-verdict">✅ {item.winner}</span>
      </button>) : <EmptyLine>未检索到相关避坑记录</EmptyLine>}
    </div>
  </Panel>;
}

export function DirectoryView({ notes, counts, onOpen, query, status, category, sort, onStatus, onCategory, onSort, onReset }: ViewProps & {
  query: string; status: string; category: string; sort: string;
  onStatus: (value: string) => void; onCategory: (value: string) => void; onSort: (value: string) => void; onReset: () => void;
}) {
  const needle = query.trim().toLocaleLowerCase();
  const visible = notes.filter(note => {
    if (status && note.lifecycle !== status) return false;
    if (category && note.cls !== category) return false;
    if (needle && !`${note.title} ${note.slug} ${note.problem} ${note.decision}`.toLocaleLowerCase().includes(needle)) return false;
    return true;
  }).sort(sort === 'old' ? byDateAsc : sort === 'cites'
    ? (a, b) => cites(counts, b.id) - cites(counts, a.id) || byDateDesc(a, b)
    : byDateDesc);
  return <>
    <div className="dnb-matrix-toolbar">
      <select aria-label="按状态筛选" value={status} onChange={event => onStatus(event.target.value)}>
        <option value="">状态：全部</option>
        {Object.entries(statusLabels).map(([key, text]) => <option key={key} value={key}>状态：{text}</option>)}
      </select>
      <select aria-label="按分类筛选" value={category} onChange={event => onCategory(event.target.value)}>
        <option value="">分类：全部</option>
        {classOrder.map(cls => <option key={cls} value={cls}>分类：{label(classLabels, cls)}</option>)}
      </select>
      <select aria-label="排序" value={sort} onChange={event => onSort(event.target.value)}>
        <option value="new">排序：最新优先</option>
        <option value="old">排序：最早优先</option>
        <option value="cites">排序：引用最多</option>
      </select>
      <button className="dnb-text-btn" onClick={onReset} title="清空全部筛选条件">重置筛选</button>
      <span className="dnb-match">匹配 {visible.length} 条</span>
    </div>

    <div className="dnb-matrix">
      <div className="dnb-matrix-head" aria-hidden="true">
        <span>编号</span><span>分类</span><span>标题</span><span>状态</span><span>日期</span><span className="dnb-align-right">引用</span>
      </div>
      {visible.length ? visible.map((note, index) => <button key={note.id} className="dnb-matrix-row" onClick={() => onOpen(note.id)}>
        <span className="dnb-cell-index">#{String(index + 1).padStart(3, '0')}</span>
        <span><ClassBadge value={note.cls} /></span>
        <span className="dnb-cell-title">{note.title}</span>
        <span><StatusBadge value={note.lifecycle} /></span>
        <span className="dnb-cell-date">{note.date || '—'}</span>
        <span className="dnb-cell-cites">{cites(counts, note.id) ? `↗ ${cites(counts, note.id)}` : ''}</span>
      </button>) : <EmptyLine>没有匹配的决策记录</EmptyLine>}
    </div>
  </>;
}
