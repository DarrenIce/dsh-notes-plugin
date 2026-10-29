import React from 'react';
import { externalTarget, noteTarget } from './board-model';

export interface NoteRendererProps {
  body: string;
  id: string;
  ids: ReadonlySet<string>;
  onOpen: (id: string) => void;
}

/** Markdown is rendered as React text and elements; raw HTML never becomes DOM. */
export function NoteRenderer({ body, id, ids, onOpen }: NoteRendererProps) {
  const inline = (line: string, prefix: string): React.ReactNode[] => {
    const tokens = /(`[^`\n]+`|\*\*[^*\n]+\*\*|\[([^\]]+)\]\(([^)]+)\))/g;
    const result: React.ReactNode[] = [];
    let start = 0;
    let token = 0;
    for (const match of line.matchAll(tokens)) {
      const index = match.index ?? 0;
      if (index > start) result.push(line.slice(start, index));
      const text = match[0];
      const key = `${prefix}-t${token++}`;
      if (text.startsWith('`')) result.push(<code key={key}>{text.slice(1, -1)}</code>);
      else if (text.startsWith('**')) result.push(<strong key={key}>{text.slice(2, -2)}</strong>);
      else {
        const target = noteTarget(id, match[3], ids);
        const external = externalTarget(match[3]);
        result.push(target ? <button className="dnb-link" key={key} onClick={() => onOpen(target)}>{match[2]}</button>
          : external ? <a key={key} href={external} target="_blank" rel="noopener noreferrer">{match[2]}</a> : <span key={key}>{match[2]}</span>);
      }
      start = index + text.length;
    }
    if (start < line.length) result.push(line.slice(start));
    return result;
  };
  const lines = body.replace(/\r\n?/g, '\n').split('\n');
  const blocks: React.ReactNode[] = [];
  let block = 0;
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const key = `b${block++}`;
    if (!line.trim()) { i++; continue; }
    if (/^\s*```/.test(line)) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) code.push(lines[i++]);
      if (i < lines.length) i++;
      blocks.push(<pre key={key}><code>{code.join('\n')}</code></pre>);
      continue;
    }
    const heading = /^\s*(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      const content = inline(heading[2], key);
      blocks.push(heading[1].length <= 3 ? <h3 key={key}>{content}</h3> : <h4 key={key}>{content}</h4>);
      i++;
      continue;
    }
    if (/^\s*>\s?/.test(line)) {
      const quoted: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) quoted.push(lines[i++].replace(/^\s*>\s?/, ''));
      blocks.push(<blockquote key={key}>{quoted.map((text, n) => <React.Fragment key={`${key}-${n}`}>{n > 0 && <br />}{inline(text, `${key}-${n}`)}</React.Fragment>)}</blockquote>);
      continue;
    }
    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*[-*]\s+/, ''));
      blocks.push(<ul key={key}>{items.map((text, n) => <li key={`${key}-${n}`}>{inline(text, `${key}-${n}`)}</li>)}</ul>);
      continue;
    }
    const paragraph: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^\s*(```|#{1,6}\s|>\s?|[-*]\s+)/.test(lines[i])) paragraph.push(lines[i++]);
    if (!paragraph.length) paragraph.push(lines[i++]);
    blocks.push(<p key={key}>{paragraph.map((text, n) => <React.Fragment key={`${key}-${n}`}>{n > 0 && <br />}{inline(text, `${key}-${n}`)}</React.Fragment>)}</p>);
  }
  return <div className="dnb-markdown">{blocks}</div>;
}
