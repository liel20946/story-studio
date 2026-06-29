import * as React from "react";
import { cn } from "@/lib/utils";

const INLINE_TOKEN_RE = /(\*\*[^*]+\*\*|`[^`]+`)/g;

function MarkdownCode({ children }: { children: string }) {
  return (
    <code
      className={cn(
        "rounded px-1 py-px font-mono text-[0.85em] leading-none",
        "bg-control text-secondary ring-1 ring-inset ring-separator",
      )}
    >
      {children}
    </code>
  );
}

function parseInline(text: string, keyPrefix: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let lastIndex = 0;
  let tokenIndex = 0;

  for (const match of text.matchAll(INLINE_TOKEN_RE)) {
    const token = match[0];
    const index = match.index ?? 0;
    if (index > lastIndex) {
      nodes.push(text.slice(lastIndex, index));
    }
    if (token.startsWith("**")) {
      nodes.push(
        <strong key={`${keyPrefix}-b-${tokenIndex++}`} className="font-medium text-primary">
          {token.slice(2, -2)}
        </strong>,
      );
    } else {
      nodes.push(
        <MarkdownCode key={`${keyPrefix}-c-${tokenIndex++}`}>
          {token.slice(1, -1)}
        </MarkdownCode>,
      );
    }
    lastIndex = index + token.length;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes;
}

function isOrderedListLine(line: string): boolean {
  return /^\s*\d+\.\s/.test(line);
}

function isBulletListLine(line: string): boolean {
  return /^\s*([-*]|\u2022)\s/.test(line);
}

function stripBulletPrefix(line: string): string {
  return line.replace(/^\s*[-*\u2022]\s+/, "");
}

type BlockSegment =
  | { kind: "p"; lines: string[] }
  | { kind: "ol"; lines: string[] }
  | { kind: "ul"; lines: string[] };

function segmentLines(lines: string[]): BlockSegment[] {
  const segments: BlockSegment[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index]!;
    if (isOrderedListLine(line)) {
      const start = index;
      while (index < lines.length && isOrderedListLine(lines[index]!)) index++;
      segments.push({ kind: "ol", lines: lines.slice(start, index) });
      continue;
    }
    if (isBulletListLine(line)) {
      const start = index;
      while (index < lines.length && isBulletListLine(lines[index]!)) index++;
      segments.push({ kind: "ul", lines: lines.slice(start, index) });
      continue;
    }
    const start = index;
    while (
      index < lines.length &&
      !isOrderedListLine(lines[index]!) &&
      !isBulletListLine(lines[index]!)
    ) {
      index++;
    }
    segments.push({ kind: "p", lines: lines.slice(start, index) });
  }

  return segments;
}

function renderList(
  kind: "ol" | "ul",
  lines: string[],
  blockIndex: number,
  segmentIndex: number,
): React.ReactNode {
  const ListTag = kind;
  return (
    <ListTag
      key={`${blockIndex}-${segmentIndex}`}
      className={cn(
        "generate-assistant-markdown-list",
        kind === "ol"
          ? "generate-assistant-markdown-list--ordered"
          : "generate-assistant-markdown-list--bullet",
      )}
    >
      {lines.map((line, lineIndex) => {
        const content =
          kind === "ol"
            ? line.replace(/^\s*\d+\.\s+/, "")
            : stripBulletPrefix(line);
        return (
          <li key={lineIndex}>{parseInline(content, `b${blockIndex}-s${segmentIndex}-l${lineIndex}`)}</li>
        );
      })}
    </ListTag>
  );
}

function parseBlock(block: string, blockIndex: number): React.ReactNode {
  const lines = block.split("\n").filter((line, index, all) => {
    if (line.trim()) return true;
    return index > 0 && index < all.length - 1;
  });

  const segments = segmentLines(lines);
  if (segments.length === 1 && segments[0]!.kind === "p" && segments[0]!.lines.length === 1) {
    return (
      <p key={blockIndex} className="generate-assistant-markdown-p">
        {parseInline(segments[0]!.lines[0]!, `b${blockIndex}`)}
      </p>
    );
  }

  return (
    <React.Fragment key={blockIndex}>
      {segments.map((segment, segmentIndex) => {
        if (segment.kind === "ol") {
          return renderList("ol", segment.lines, blockIndex, segmentIndex);
        }
        if (segment.kind === "ul") {
          return renderList("ul", segment.lines, blockIndex, segmentIndex);
        }
        return (
          <p key={`${blockIndex}-p-${segmentIndex}`} className="generate-assistant-markdown-p">
            {segment.lines.map((line, lineIndex) => (
              <React.Fragment key={lineIndex}>
                {lineIndex > 0 ? <br /> : null}
                {parseInline(line, `b${blockIndex}-p${segmentIndex}-l${lineIndex}`)}
              </React.Fragment>
            ))}
          </p>
        );
      })}
    </React.Fragment>
  );
}

export function AssistantMarkdown({ text }: { text: string }) {
  const blocks = text.trim().split(/\n\n+/).filter(Boolean);
  if (blocks.length === 0) return null;

  return (
    <div className="generate-assistant-markdown">
      {blocks.map((block, index) => parseBlock(block, index))}
    </div>
  );
}
