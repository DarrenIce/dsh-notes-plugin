import React from 'react';
import { externalTarget, noteTarget } from './board-model';

/** Markdown is rendered as React text and elements; raw HTML never becomes DOM. */
export function NoteRenderer({ body, id, ids, onOpen }: { body: string; id: string; ids: ReadonlySet<string>; onOpen: (id: string) => void }) {
  const inline = (line: string) => {
    const tokens = /(`[^`\n]+`|\*\*[^*\n]+\*\*|\[([^\]]+)\]\(([^)]+)\))/g;
    const result: React.ReactNode[] = [];
    let start = 0;
    for (const match of line.matchAll(tokens)) {
      result.push(line.slice(start, match.index));
      const text = match[0];
      if (text.startsWith('`')) result.push(<code key={match.index}>{text.slice(1, -1)}</code>);
      else if (text.startsWith('**')) result.push(<strong key={match.index}>{text.slice(2, -2)}</strong>);
      else {
        const target = noteTarget(id, match[3], ids);
        const external = externalTarget(match[3]);
        result.push(target ? <button className="dnb-link" key={match.index} onClick={() => onOpen(target)}>{match[2]}</button>
          : external ? <a key={match.index} href={external} target="_blank" rel="noopener noreferrer">{match[2]}</a> : <span key={match.index}>{match[2]}</span>);
      }
      start = (match.index || 0) + text.length;
    }
    result.push(line.slice(start));
    return result;
  };
  const lines = body.replace(/\r\n?/g, '\n').split('\n');
  const blocks: React.ReactNode[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*```/.test(line)) {
      const code: string[] = [];
      while (++i < lines.length && !/^\s*```/.test(lines[i])) code.push(lines[i]);
      blocks.push(<pre key={i}><code>{code.join('\n')}</code></pre>);
    } else if (/^#{1,6}\s/.test(line)) {
      const heading = line.replace(/^#{1,6}\s+/, '');
      blocks.push(<h3 key={i}>{inline(heading)}</h3>);
    } else if (line.trim()) {
      blocks.push(<p key={i}>{inline(line)}</p>);
    } else blocks.push(<div className="dnb-md-gap" key={i} />);
  }
  return <div className="dnb-markdown">{blocks}</div>;
}
