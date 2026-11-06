/**
 * A review on the PR's new head. Hunks whose change is the same (matched by `key`, not by id: ids
 * shift) keep their state and their block; new or changed hunks are todo, gathered in a block of
 * their own at the top of the map. vscode-free.
 */
import type { Block, Hunk, HunkState } from '@talkthrough/shared';

export const DELTA_TITLE = 'What changed since your review';

export interface ReviewMap {
  hunks: Record<string, Hunk>;
  coverage: Record<string, HunkState>;
  step: string[];
  blocks: Block[];
}

/** The review's states and map carried to `hunks`, and the hunks that are new or changed. */
export function carryOver(before: ReviewMap, hunks: Record<string, Hunk>) {
  const idOf = new Map(Object.values(hunks).map((hunk) => [hunk.key, hunk.id]));
  /** Old id → new id, for the hunks whose change is the same. */
  const moved = new Map<string, string>();
  for (const hunk of Object.values(before.hunks)) {
    const id = idOf.get(hunk.key);
    if (id) moved.set(hunk.id, id);
  }
  const kept = new Set(moved.values());
  const changed = Object.keys(hunks).filter((id) => !kept.has(id));
  const coverage: Record<string, HunkState> = {};
  for (const [from, to] of moved) coverage[to] = before.coverage[from] ?? 'todo';
  for (const id of changed) coverage[id] = 'todo';
  const rename = (ids: string[]) => ids.flatMap((id) => moved.get(id) ?? []);

  // An earlier update's block stays one block: what it held is still new to the review
  const earlier = before.blocks.find((block) => block.title === DELTA_TITLE);
  const delta = [...rename(earlier?.hunks ?? []), ...changed];
  const blocks: Block[] = before.blocks.length
    ? [
        ...(delta.length
          ? [
              {
                id: '',
                title: DELTA_TITLE,
                why: 'New or changed since the head you reviewed',
                hunks: delta
              }
            ]
          : []),
        ...before.blocks
          .filter((block) => block !== earlier)
          .map((block) => ({ ...block, hunks: rename(block.hunks) }))
          .filter((block) => block.hunks.length)
      ].map((block, index) => ({ ...block, id: `B${index + 1}` }))
    : [];
  return { coverage, blocks, step: rename(before.step), changed };
}
