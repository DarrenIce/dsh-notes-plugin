import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { DecisionBoard, type BoardSnapshot } from '../../src/client/decision-board';

const notes = [
  {
    id: 'implemented/feature/2026-01-02-alpha.md',
    raw: '# Agent Note: Alpha\n\n## Problem\n输入框只显示纯文本。\n\n## Decision\n显示引用预览。\n\n## Alternatives considered\n### 旧方案：成本更低\n否决，无法区分同名文件。',
  },
  {
    id: 'proposed/architecture/2026-02-03-beta.md',
    raw: '# Agent Note: Beta\n\n## Problem\n工作区共用根。\n\n## Decision\n按项目声明笔记根。',
  },
  {
    id: 'rejected/testing/2026-03-04-gamma.md',
    raw: '# Agent Note: Gamma\n\nStatus: rejected — 维护成本过高\n\n## Problem\n快照测试。',
  },
];

const validation = {
  workspaceId: 'w', notesRoot: '.agents/notes', configRevision: 'r', rulesVersion: '1',
  snapshotVersion: 1, sourceVersion: 's', complete: true, checkedAt: '2026-10-29T00:00:00Z', warnings: [],
  issues: [{ key: 'k', rule: 'note-status', path: 'rejected/testing/2026-03-04-gamma.md', anchor: 'Status', message: '状态与生命周期不一致。', severity: 'warning' as const, attribution: 'uncertain' as const }],
};

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://local.test' });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });

function setup(): { root: Root; container: HTMLElement } {
  const container = document.createElement('div');
  document.body.append(container);
  return { root: createRoot(container), container };
}
async function paint(root: Root, sessionId: string, snapshot: BoardSnapshot) {
  await act(async () => root.render(<DecisionBoard sessionId={sessionId} snapshot={snapshot} />));
}
async function dispose(root: Root, container: HTMLElement) {
  await act(async () => root.unmount());
  container.remove();
}
const button = (text: string) => [...document.querySelectorAll('button')].find(el => el.textContent?.includes(text)) as HTMLButtonElement | undefined;

test('KPI routing, directory reset and Escape-to-close reader', async () => {
  const { root, container } = setup();
  const snapshot = { status: 'ready' as const, configRevision: 'r', configIdentity: 'ui-kpi', complete: true, notes };
  await paint(root, 'ui-kpi', snapshot);
  assert.match(container.textContent!, /系统承重墙/);
  assert.match(container.textContent!, /领域架构分类阵列/);
  await act(async () => button('现行落地')!.click());
  assert.match(container.textContent!, /匹配 1 条/);
  assert.match(container.querySelector('.dnb-matrix-row')!.textContent!, /Alpha/);
  await act(async () => button('重置筛选')!.click());
  assert.match(container.textContent!, /匹配 3 条/);
  await act(async () => button('Alpha')!.click());
  assert.match(container.querySelector('.dnb-reader')!.textContent!, /01\. 背景与痛点/);
  const close = container.querySelector('.dnb-icon-btn') as HTMLButtonElement;
  await act(async () => { close.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
  assert.equal(container.querySelector('.dnb-reader'), null);
  await dispose(root, container);
});

test('global search opens the reader from its popover', async () => {
  const { root, container } = setup();
  const snapshot = { status: 'ready' as const, configRevision: 'r', configIdentity: 'ui-search', complete: true, notes };
  await paint(root, 'ui-search', snapshot);
  const input = container.querySelector('.dnb-search input') as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value')?.set;
  await act(async () => {
    setter?.call(input, 'Alpha');
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  });
  assert.ok(container.querySelector('.dnb-popover'));
  assert.match(container.querySelector('.dnb-popover')!.textContent!, /Alpha/);
  await act(async () => (container.querySelector('.dnb-popover-item') as HTMLButtonElement).click());
  assert.match(container.querySelector('.dnb-reader')!.textContent!, /Alpha/);
  await dispose(root, container);
});

test('pitfall vault renders discarded alternatives and rejected reasons', async () => {
  const { root, container } = setup();
  const snapshot = { status: 'ready' as const, configRevision: 'r', configIdentity: 'ui-pitfalls', complete: true, notes };
  await paint(root, 'ui-pitfalls', snapshot);
  await act(async () => button('避坑智库')!.click());
  const vault = container.querySelector('.dnb-pitfalls')!;
  assert.match(vault.textContent!, /旧方案/);
  assert.match(vault.textContent!, /维护成本过高/);
  const dossier = [...container.querySelectorAll('.dnb-pitfall')].find(el => el.textContent?.includes('旧方案')) as HTMLButtonElement;
  await act(async () => dossier.click());
  assert.match(container.querySelector('.dnb-reader')!.textContent!, /Alpha/);
  await dispose(root, container);
});

test('validation issues stay reachable from the alert strip', async () => {
  const { root, container } = setup();
  const snapshot = { status: 'ready' as const, configRevision: 'r', configIdentity: 'ui-alert', complete: true, notes, validation };
  await paint(root, 'ui-alert', snapshot);
  const alert = container.querySelector('.dnb-alert')!;
  assert.match(alert.textContent!, /校验：1 项问题/);
  assert.match(alert.textContent!, /状态与生命周期不一致/);
  assert.match(alert.textContent!, /来源不确定/);
  await dispose(root, container);
});

test('anchor copy falls back when the async clipboard is unavailable', async () => {
  const { root, container } = setup();
  const snapshot = { status: 'ready' as const, configRevision: 'r', configIdentity: 'ui-copy', complete: true, notes };
  await paint(root, 'ui-copy', snapshot);
  await act(async () => button('Alpha')!.click());
  Object.defineProperty(dom.window.navigator, 'clipboard', { value: undefined, configurable: true });
  Object.defineProperty(dom.window.document, 'execCommand', { value: () => true, configurable: true });
  const copyButton = [...container.querySelectorAll('.dnb-anchor-actions button')].find(el => el.textContent?.includes('复制反向代码注释')) as HTMLButtonElement;
  await act(async () => { copyButton.click(); await Promise.resolve(); });
  assert.match(copyButton.textContent!, /已复制/);
  await dispose(root, container);
});

test('composer takeover follows the board mount without churning on snapshots', async () => {
  const { root, container } = setup();
  let attached = 0;
  let disposed = 0;
  const maskComposer = () => { attached += 1; return () => { disposed += 1; }; };
  const snapshot = { status: 'ready' as const, configRevision: 'r', configIdentity: 'ui-mask', complete: true, notes };
  await act(async () => root.render(<DecisionBoard sessionId="ui-mask" snapshot={snapshot} maskComposer={maskComposer} />));
  assert.equal(attached, 1);
  await act(async () => root.render(<DecisionBoard sessionId="ui-mask" snapshot={{ ...snapshot, configRevision: 'r2' }} maskComposer={maskComposer} />));
  assert.equal(attached, 1);
  await act(async () => root.unmount());
  assert.equal(disposed, 1);
  container.remove();
});
