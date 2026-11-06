/**
 * Claude's replies: stage cues (`[[show src/a.ts#L10-20]]`), sentences the player reads and seeks
 * to, and the words as the voice says them. vscode-free.
 */
import type { Cue, CueKind, Part, Sentence } from '@talkthrough/shared';

const CUE =
  /\[\[\s*(show|open|refs)\s+([^\s\]#]+)(?:#L(\d+)(?:-L?(\d+))?)?(?:\s+([^\]]*?))?\s*\]\]/g;
const FENCE = /```([\w+-]*)[^\n]*\n([\s\S]*?)```/g;
/** A sentence ends at . ! ? … (also before a closing quote or parenthesis), or at a line break. */
const BOUNDARY = /([.!?…]+["'”’)\]]*)(\s+)|(\n+)/g;
/** The voice-mode marker (earshot) a reply may still carry. */
const SPOKEN_MARKER = /⁣/g;

export function parseCue(
  kind: string,
  path: string,
  start?: string,
  end?: string,
  symbol?: string
): Cue {
  const first = start ? Number(start) : null;
  return {
    kind: kind as CueKind,
    path: path.replace(/^\.?\//, ''),
    start: first,
    end: end ? Number(end) : first,
    symbol: symbol?.trim() || null
  };
}

/** Cues, text and code of a reply in order, before splitting into sentences. */
function tokens(raw: string): Part[] {
  const out: Part[] = [];
  const text = raw.replace(SPOKEN_MARKER, '').replace(/\r\n/g, '\n');
  let at = 0;
  for (const fence of text.matchAll(FENCE)) {
    out.push(...cuesAndText(text.slice(at, fence.index)));
    out.push({ type: 'code', lang: fence[1] ?? '', code: (fence[2] ?? '').replace(/\n$/, '') });
    at = fence.index! + fence[0].length;
  }
  out.push(...cuesAndText(text.slice(at)));
  return out;
}

function cuesAndText(text: string): Part[] {
  const out: Part[] = [];
  let at = 0;
  for (const match of text.matchAll(CUE)) {
    if (match.index! > at) out.push({ type: 'text', text: text.slice(at, match.index) });
    out.push({ type: 'cue', cue: parseCue(match[1], match[2], match[3], match[4], match[5]) });
    at = match.index! + match[0].length;
  }
  if (at < text.length) out.push({ type: 'text', text: text.slice(at) });
  return out;
}

/**
 * Splits a reply into sentences. A cue stays where it is written, so one written before the words
 * it illustrates opens their sentence; a code block is a sentence of its own.
 */
export function parseReply(raw: string): Sentence[] {
  const sentences: Sentence[] = [];
  let current: Part[] = [];
  const close = () => {
    const parts = current
      .map((part) =>
        part.type === 'text' ? { ...part, text: part.text.replace(/\s+/g, ' ') } : part
      )
      .filter((part) => part.type !== 'text' || part.text.trim());
    if (parts.length) {
      const first = parts[0];
      if (first.type === 'text') parts[0] = { ...first, text: first.text.trimStart() };
      const last = parts[parts.length - 1];
      if (last.type === 'text') parts[parts.length - 1] = { ...last, text: last.text.trimEnd() };
      sentences.push({ parts });
    }
    current = [];
  };

  for (const part of tokens(raw)) {
    if (part.type === 'cue') {
      current.push(part);
      continue;
    }
    if (part.type === 'code') {
      close();
      current.push(part);
      close();
      continue;
    }
    let at = 0;
    for (const boundary of part.text.matchAll(BOUNDARY)) {
      const end = boundary.index! + (boundary[1]?.length ?? 0);
      current.push({ type: 'text', text: part.text.slice(at, end) });
      close();
      at = boundary.index! + boundary[0].length;
    }
    if (at < part.text.length) current.push({ type: 'text', text: part.text.slice(at) });
  }
  close();
  return sentences;
}

/** Every cue of a reply, in order. */
export const cuesOf = (sentences: Sentence[]) =>
  sentences.flatMap((sentence) =>
    sentence.parts.flatMap((part) => (part.type === 'cue' ? [part.cue] : []))
  );

/** Words as the voice should say them: no markdown, links, paths or bullets. */
export function speakable(text: string) {
  return text
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]*)`/g, (_, code: string) => code.replace(/^.*\//, ''))
    .replace(/(\*\*|__|\*|_|~~)(\S[\s\S]*?\S|\S)\1/g, '$2')
    .replace(/^\s*(?:[-*•]|\d+[.)])\s+/gm, '')
    .replace(/^#+\s*/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
}
