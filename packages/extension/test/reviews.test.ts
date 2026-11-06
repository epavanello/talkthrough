import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ReviewStore } from '../src/reviews';

describe('ReviewStore', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'talkthrough-reviews-'));
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('GIVEN reviews WHEN kept, read, listed and dropped THEN each is its own file', async () => {
    const store = new ReviewStore<{ id: string; title: string }>(path.join(dir, 'reviews'));

    await store.save({ id: '/repo/.git#o/r#7', title: 'Round prices up' });
    await store.save({ id: '/repo/.git#o/r#8', title: 'Cache threads' });
    await store.save({ id: '/repo/.git#o/r#7', title: 'Round prices up, again' });
    writeFileSync(path.join(dir, 'reviews', 'broken.json'), '{ half');

    expect(await store.get('/repo/.git#o/r#7')).toEqual({
      id: '/repo/.git#o/r#7',
      title: 'Round prices up, again'
    });
    expect((await store.all()).map((review) => review.title).sort()).toEqual([
      'Cache threads',
      'Round prices up, again'
    ]);
    await store.remove('/repo/.git#o/r#8');
    expect(await store.get('/repo/.git#o/r#8')).toBeNull();
    expect(await store.all()).toHaveLength(1);
  });

  it('GIVEN no folder yet WHEN listed THEN there is nothing', async () => {
    expect(await new ReviewStore(path.join(dir, 'missing')).all()).toEqual([]);
  });
});
