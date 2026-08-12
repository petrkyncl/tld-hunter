"use client";

import { Fragment, type ReactNode } from "react";

/**
 * A small renderer for the markdown the agent actually writes: inline code,
 * emphasis, links, bullets and the occasional heading.
 *
 * It builds React elements rather than HTML strings, so nothing the model
 * emits can become markup — and because the text arrives token by token, it
 * has to tolerate half-finished syntax without throwing or flickering.
 */

const INLINE =
  /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(\*[^*\n]+\*)|(_[^_\n]+_)|(\[[^\]\n]+\]\((?:https?:\/\/)[^)\s]+\))/g;

function inline(text: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;

  INLINE.lastIndex = 0;
  while ((match = INLINE.exec(text)) !== null) {
    if (match.index > last) out.push(text.slice(last, match.index));
    const token = match[0];
    const key = `${keyPrefix}-${match.index}`;

    if (token.startsWith("`")) {
      out.push(
        <code key={key} className="rounded bg-edge/60 px-1 py-0.5 font-mono text-[0.9em]">
          {token.slice(1, -1)}
        </code>,
      );
    } else if (token.startsWith("**")) {
      out.push(
        <strong key={key} className="font-semibold text-fg">
          {token.slice(2, -2)}
        </strong>,
      );
    } else if (token.startsWith("[")) {
      const split = token.indexOf("](");
      const href = token.slice(split + 2, -1);
      out.push(
        <a
          key={key}
          href={href}
          target="_blank"
          rel="noreferrer noopener"
          className="text-brand hover:underline"
        >
          {token.slice(1, split)}
        </a>,
      );
    } else {
      out.push(
        <em key={key} className="italic">
          {token.slice(1, -1)}
        </em>,
      );
    }

    last = match.index + token.length;
  }

  if (last < text.length) out.push(text.slice(last));
  return out;
}

const BULLET = /^\s*[-*•]\s+/;
const NUMBERED = /^\s*\d+[.)]\s+/;

export default function Markdown({ text, className }: { text: string; className?: string }) {
  const lines = text.split("\n");
  const blocks: ReactNode[] = [];
  let list: string[] = [];
  let paragraph: string[] = [];

  const flushList = (key: string) => {
    if (!list.length) return;
    blocks.push(
      <ul key={key} className="ml-1 list-disc space-y-0.5 pl-4">
        {list.map((item, i) => (
          <li key={i}>{inline(item, `${key}-${i}`)}</li>
        ))}
      </ul>,
    );
    list = [];
  };

  const flushParagraph = (key: string) => {
    if (!paragraph.length) return;
    blocks.push(<p key={key}>{inline(paragraph.join(" "), key)}</p>);
    paragraph = [];
  };

  lines.forEach((line, i) => {
    const key = `b${i}`;
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);

    if (heading) {
      flushParagraph(`${key}-p`);
      flushList(`${key}-l`);
      blocks.push(
        <p key={key} className="mt-1 font-semibold text-fg">
          {inline(heading[2], key)}
        </p>,
      );
      return;
    }

    if (BULLET.test(line) || NUMBERED.test(line)) {
      flushParagraph(`${key}-p`);
      list.push(line.replace(BULLET, "").replace(NUMBERED, ""));
      return;
    }

    if (!line.trim()) {
      flushParagraph(`${key}-p`);
      flushList(`${key}-l`);
      return;
    }

    flushList(`${key}-l`);
    paragraph.push(line);
  });

  flushParagraph("tail-p");
  flushList("tail-l");

  return <div className={`space-y-2 ${className ?? ""}`}>{blocks.map((b, i) => (
    <Fragment key={i}>{b}</Fragment>
  ))}</div>;
}
