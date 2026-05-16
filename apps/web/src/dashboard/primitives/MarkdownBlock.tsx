import type { PrimitiveProps } from '../types';
import { substituteString } from '../tokens';

/**
 * Minimaler Markdown-Renderer: unterstützt H1/H2/H3, **bold**, *italic*, `code`,
 * Listen, Links. Absichtlich klein gehalten — wenn mehr nötig wird, einen Markdown-
 * Parser einbinden.
 *
 * Token-Substitution: `content` wird gegen die Parent-Row substituiert
 * (z.B. {{title}} → Wert der Spalte `title` im gebundenen Dataset).
 */
export function MarkdownBlock({ node, row }: PrimitiveProps) {
  const props = node.props ?? {};
  const rawContent = (props.content as string) ?? '';
  const content = row ? substituteString(rawContent, row) : rawContent;
  const span = props.span as number | undefined;
  const style: React.CSSProperties = span
    ? { gridColumn: `span ${span} / span ${span}` }
    : {};
  return (
    <div className="dash-markdown" style={style}>
      {renderMarkdown(content)}
    </div>
  );
}

function renderMarkdown(input: string): React.ReactNode {
  const lines = input.split('\n');
  const nodes: React.ReactNode[] = [];
  let listBuffer: string[] = [];
  let key = 0;

  const flushList = () => {
    if (listBuffer.length === 0) return;
    nodes.push(
      <ul key={`ul-${key++}`}>
        {listBuffer.map((item, i) => (
          <li key={i}>{renderInline(item)}</li>
        ))}
      </ul>
    );
    listBuffer = [];
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith('### ')) {
      flushList();
      nodes.push(<h3 key={key++}>{renderInline(line.slice(4))}</h3>);
    } else if (line.startsWith('## ')) {
      flushList();
      nodes.push(<h2 key={key++}>{renderInline(line.slice(3))}</h2>);
    } else if (line.startsWith('# ')) {
      flushList();
      nodes.push(<h1 key={key++}>{renderInline(line.slice(2))}</h1>);
    } else if (line.startsWith('- ') || line.startsWith('* ')) {
      listBuffer.push(line.slice(2));
    } else if (line === '') {
      flushList();
    } else {
      flushList();
      nodes.push(<p key={key++}>{renderInline(line)}</p>);
    }
  }
  flushList();
  return nodes;
}

function renderInline(text: string): React.ReactNode {
  // Order matters: code → bold → italic → link
  const parts: React.ReactNode[] = [];
  let rest = text;
  let k = 0;
  // very simple tokenizer
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\([^)]+\))/;
  while (rest.length > 0) {
    const m = pattern.exec(rest);
    if (!m) {
      parts.push(rest);
      break;
    }
    if (m.index > 0) parts.push(rest.slice(0, m.index));
    const token = m[0];
    if (token.startsWith('`')) {
      parts.push(<code key={k++}>{token.slice(1, -1)}</code>);
    } else if (token.startsWith('**')) {
      parts.push(<strong key={k++}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith('*')) {
      parts.push(<em key={k++}>{token.slice(1, -1)}</em>);
    } else if (token.startsWith('[')) {
      const linkM = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token);
      if (linkM) {
        parts.push(
          <a key={k++} href={linkM[2]} target="_blank" rel="noopener noreferrer">
            {linkM[1]}
          </a>
        );
      }
    }
    rest = rest.slice(m.index + token.length);
  }
  return parts;
}
