/** The stage's tools as the review session's MCP server lists them. vscode-free. */
import type { ToolSpec } from './server';

const object = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false
});
const string = (description: string) => ({ type: 'string', description });
const strings = (description: string) => ({
  type: 'array',
  items: { type: 'string' },
  description
});
const integer = (description: string) => ({ type: 'integer', minimum: 1, description });

export const TOOLS: ToolSpec[] = [
  {
    name: 'pr_overview',
    description:
      'The pull request: title, description, the author notes, each file with its hunk ids, and whether the checkout is at the PR head.',
    inputSchema: object({})
  },
  {
    name: 'pr_diff',
    description:
      'The PR diff from the merge base, hunk by hunk: each hunk headed by its id and its changed lines. Pass paths for a large PR.',
    inputSchema: object({ paths: strings('Repository-relative paths; all files when omitted') })
  },
  {
    name: 'pr_file',
    description: 'A file as it is at the PR head, with line numbers.',
    inputSchema: object(
      {
        path: string('Repository-relative path'),
        start: integer('First line'),
        end: integer('Last line')
      },
      ['path']
    )
  },
  {
    name: 'set_map',
    description:
      'Sets the review map: blocks of hunks in the order of the application flow (every hunk in exactly one block), and hotspots worth exploring. Answers with the problems to fix, if any.',
    inputSchema: object(
      {
        blocks: {
          type: 'array',
          items: object(
            {
              title: string('A few words'),
              why: string('One sentence: what this block does'),
              hunks: strings('Hunk ids, such as H3')
            },
            ['title', 'hunks']
          )
        },
        hotspots: {
          type: 'array',
          items: object(
            {
              title: string('A few words'),
              detail: string('The problem and the evidence found'),
              anchors: strings('Where to look: path#L10-20')
            },
            ['title', 'detail']
          )
        }
      },
      ['blocks']
    )
  },
  {
    name: 'find_references',
    description:
      "References to the symbol on that line, from VS Code's language server (at most 50), with each line's text.",
    inputSchema: object(
      {
        path: string('Repository-relative path'),
        line: integer('The line, at the PR head'),
        symbol: string('The symbol on that line; its first identifier when omitted')
      },
      ['path', 'line']
    )
  },
  {
    name: 'mark_ok',
    description: 'Marks hunks as ok: the person said they are clear. Only after they said so.',
    inputSchema: object({ hunks: strings('Hunk ids') }, ['hunks'])
  },
  {
    name: 'review_state',
    description:
      'Hunk states (todo, explained, ok), this step, and the next hunks in logical order.',
    inputSchema: object({})
  }
];

export interface MapInput {
  blocks: { title: string; why?: string; hunks: string[] }[];
  hotspots?: { title: string; detail: string; anchors?: string[] }[];
}

/** What is wrong with a map: unknown, repeated or missing hunk ids. */
export function mapProblems(map: MapInput, hunkIds: string[]) {
  const known = new Set(hunkIds);
  const seen = new Map<string, string>();
  const problems: string[] = [];
  for (const block of map.blocks) {
    for (const id of block.hunks) {
      if (!known.has(id)) problems.push(`Unknown hunk ${id} in "${block.title}".`);
      else if (seen.has(id))
        problems.push(`${id} is in both "${seen.get(id)}" and "${block.title}".`);
      else seen.set(id, block.title);
    }
  }
  const missing = hunkIds.filter((id) => !seen.has(id));
  if (missing.length) problems.push(`Not in any block: ${missing.join(', ')}.`);
  return problems;
}
