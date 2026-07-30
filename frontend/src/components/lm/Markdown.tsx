/**
 * Rendu Markdown des réponses d'agent et des détails d'étapes.
 *
 * Les agents renvoient du markdown (gras, listes, liens vers les sources officielles) : affiché
 * brut, un `**micro-BNC**` ou un `[BOFiP](url)` reste illisible. On construit ici des éléments
 * React — jamais de `dangerouslySetInnerHTML` — donc rien d'injectable même si un extrait de
 * source contenait du HTML.
 *
 * Sous-ensemble volontairement réduit à ce que les agents produisent : titres, listes, gras,
 * italique, code, liens.
 */

import type { ReactNode } from "react";

/** Les agents ponctuent parfois d'émojis ; le thème est typographique, on les retire. */
const EMOJI =
  /[←-⇿⌀-➿⬀-⯿️]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|\uD83E[\uDD00-\uDFFF]/g;

export function stripEmoji(text: string): string {
  return (text || "").replace(EMOJI, "").replace(/[ \t]{2,}/g, " ").trim();
}

const INLINE = /(\*\*[^*]+\*\*|\*[^*\n]+\*|`[^`]+`|\[[^\]]+\]\([^)\s]+\)|https?:\/\/[^\s<>()]+)/g;

/** Gras, italique, code, liens markdown et URL nues — appliqué segment par segment. */
function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  const parts = text.split(INLINE);

  parts.forEach((part, i) => {
    if (!part) return;
    const key = `${keyPrefix}-${i}`;

    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      out.push(
        <strong key={key} className="font-semibold text-ink">
          {part.slice(2, -2)}
        </strong>,
      );
      return;
    }
    if (part.startsWith("*") && part.endsWith("*") && part.length > 2) {
      out.push(<em key={key}>{part.slice(1, -1)}</em>);
      return;
    }
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      out.push(
        <code
          key={key}
          className="px-1.5 py-0.5 rounded-md bg-teal-light/10 text-teal-dark font-mono text-[0.85em]"
        >
          {part.slice(1, -1)}
        </code>,
      );
      return;
    }

    const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(part);
    const href = link ? link[2] : part.startsWith("http") ? part : null;
    // Seuls http(s) sont rendus cliquables : pas de `javascript:` ni de `data:`.
    if (href && /^https?:\/\//i.test(href)) {
      out.push(
        <a
          key={key}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="text-teal-dark underline underline-offset-2 hover:text-ink transition-colors break-words"
        >
          {link ? link[1] : href}
        </a>,
      );
      return;
    }

    out.push(<span key={key}>{part}</span>);
  });

  return out;
}

type Block =
  | { kind: "p"; lines: string[] }
  | { kind: "h"; lines: string[]; level: number }
  | { kind: "ul"; items: string[] }
  | { kind: "ol"; items: string[] };

/** Découpe le texte en blocs : titres, listes à puces, listes numérotées, paragraphes. */
function parseBlocks(source: string): Block[] {
  const lines = source.split("\n");
  const blocks: Block[] = [];
  let current: Block | null = null;

  const flush = () => {
    if (current) blocks.push(current);
    current = null;
  };

  for (const raw of lines) {
    const line = raw.trimEnd();

    if (!line.trim()) {
      flush();
      continue;
    }

    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      flush();
      blocks.push({ kind: "h", lines: [heading[2]], level: heading[1].length });
      continue;
    }

    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
    if (bullet) {
      if (current?.kind !== "ul") {
        flush();
        current = { kind: "ul", items: [] };
      }
      (current as { kind: "ul"; items: string[] }).items.push(bullet[1]);
      continue;
    }

    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (numbered) {
      if (current?.kind !== "ol") {
        flush();
        current = { kind: "ol", items: [] };
      }
      (current as { kind: "ol"; items: string[] }).items.push(numbered[1]);
      continue;
    }

    if (current?.kind !== "p") {
      flush();
      current = { kind: "p", lines: [] };
    }
    (current as { kind: "p"; lines: string[] }).lines.push(line.trim());
  }
  flush();

  return blocks;
}

export function Markdown({ text, className = "" }: { text?: string | null; className?: string }) {
  const source = stripEmoji(text ?? "");
  if (!source) return null;

  const blocks = parseBlocks(source);

  return (
    <div className={`space-y-2.5 leading-relaxed ${className}`}>
      {blocks.map((block, i) => {
        if (block.kind === "h") {
          return (
            <p key={i} className="font-semibold text-ink text-[1.15em] mt-1">
              {renderInline(block.lines[0], `h${i}`)}
            </p>
          );
        }
        if (block.kind === "ul") {
          return (
            <ul key={i} className="space-y-1.5 pl-1">
              {block.items.map((item, j) => (
                <li key={j} className="flex gap-2.5">
                  <span className="mt-[0.55em] size-1 rounded-full bg-teal-dark shrink-0" />
                  <span className="min-w-0">{renderInline(item, `ul${i}-${j}`)}</span>
                </li>
              ))}
            </ul>
          );
        }
        if (block.kind === "ol") {
          return (
            <ol key={i} className="space-y-1.5">
              {block.items.map((item, j) => (
                <li key={j} className="flex gap-2.5">
                  <span className="font-mono text-xs text-teal-dark mt-[0.15em] shrink-0">
                    {String(j + 1).padStart(2, "0")}
                  </span>
                  <span className="min-w-0">{renderInline(item, `ol${i}-${j}`)}</span>
                </li>
              ))}
            </ol>
          );
        }
        return <p key={i}>{renderInline(block.lines.join(" "), `p${i}`)}</p>;
      })}
    </div>
  );
}
