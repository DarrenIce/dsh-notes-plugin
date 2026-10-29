import React from 'react';

export const statusLabels: Record<string, string> = { implemented: '已落地', proposed: '待评审', rejected: '已否决', archived: '已归档' };
export const classLabels: Record<string, string> = { architecture: '架构设计', feature: '功能特性', 'bug-fix': '缺陷修复', simplification: '化简裁撤', process: '流程规范', testing: '测试基建' };
export const classOrder = ['architecture', 'feature', 'bug-fix', 'simplification', 'process', 'testing'];
export const label = (map: Record<string, string>, key: string) => map[key] || key;

export function StatusBadge({ value }: { value: string }) {
  return <span className={`dnb-badge dnb-status st-${value}`}>{label(statusLabels, value)}</span>;
}
export function ClassBadge({ value }: { value: string }) {
  return <span className={`dnb-badge dnb-class cls-${value}`}>{label(classLabels, value)}</span>;
}

export function Panel(props: { icon: string; title: string; annotation?: string; className?: string; children: React.ReactNode }) {
  return <section className={`dnb-panel${props.className ? ` ${props.className}` : ''}`}>
    <div className="dnb-panel-head">
      <span className="dnb-panel-title"><span className="dnb-panel-icon" aria-hidden="true">{props.icon}</span>{props.title}</span>
      {props.annotation && <span className="dnb-panel-annotation">{props.annotation}</span>}
    </div>
    {props.children}
  </section>;
}

export function EmptyLine({ children }: { children: React.ReactNode }) {
  return <p className="dnb-empty-line">// {children}</p>;
}
