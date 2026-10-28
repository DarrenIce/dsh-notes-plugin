// This file is valid JavaScript so the standalone HTML can embed the same source.
export function resolveNoteLink(id, href) {
  let target = href.trim().replace(/^<|>$/g, '').split('#')[0];
  if (!target || /^(?:[a-z][a-z\d+.-]*:|\/)/i.test(target)) return '';
  const parts = id.split('/').slice(0, -1);
  for (const part of target.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') { if (!parts.length) return ''; parts.pop(); }
    else parts.push(part);
  }
  return parts.join('/');
}

export function parseNote(raw, id, ids = new Set()) {
  let fenced = false;
  const text = raw.replace(/\r\n?/g, '\n').split('\n').map(line => {
    if (/^\s{0,3}```/.test(line)) { fenced = !fenced; return ''; }
    return fenced ? '' : line;
  }).join('\n');
  const parts = id.split('/');
  const slug = parts.at(-1).replace(/\.md$/, '');
  const lifecycle = parts[0];
  const cls = parts[1] || 'architecture';
  const title = /^# Agent Note[^:：]*[:：]\s*(.*)$/m.exec(text)?.[1].trim() || slug;
  const date = /^(\d{4}-\d{2}-\d{2})/.exec(slug)?.[1] || '';
  const section = pattern => new RegExp(`^## (?:${pattern})\\s*\\n+([\\s\\S]*?)(?=^## |(?![\\s\\S]))`, 'm').exec(text)?.[1].trim() || '';
  const links = [];
  for (const match of text.matchAll(/\]\(([^)]+)\)/g)) {
    const target = resolveNoteLink(id, match[1]);
    if (target.endsWith('.md') && ids.has(target) && target !== id) links.push(target);
  }
  return { id, slug, lifecycle, cls, date, title, status: lifecycle,
    problem: section('Problem|问题'), decision: section('Decision|Proposal|决策|决定|提案'),
    alternatives: section('Alternatives considered|曾考虑的替代方案|曾考虑的备选'),
    consequences: section('Consequences|后果'), outLinks: [...new Set(links)], rawBody: raw };
}
