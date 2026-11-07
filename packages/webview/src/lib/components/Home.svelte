<script lang="ts">
  import { Compass, FileDiff, MessagesSquare, Trash2 } from '@lucide/svelte';
  import { reviewName } from '@talkthrough/shared';
  import { ago, app } from '$lib/app.svelte';
  import { Button } from '$lib/components/ui/button';
  import { host } from '$lib/rpc';
  import { cn } from '$lib/utils';
  import PullPicker from './PullPicker.svelte';
  import Requirements from './Requirements.svelte';
  import Shortcuts from './Shortcuts.svelte';
  import Starters from './Starters.svelte';
</script>

<div class="flex min-h-0 flex-1 flex-col overflow-y-auto">
  <header class="flex items-center gap-2 border-b px-3 py-2">
    <MessagesSquare class="size-4 shrink-0 text-link" />
    <h1 class="min-w-0 flex-1 truncate font-semibold">Talkthrough</h1>
    <Shortcuts />
  </header>
  <p class="px-3 pt-3 text-muted-foreground">
    Talk a pull request, your own changes or a part of the code through with Claude: it opens the
    code, explains it a step at a time, and remembers what is clear.
  </p>

  <Requirements />

  {#if app.state.reviews.length}
    <section class="flex flex-col gap-1 border-b px-3 py-3" aria-labelledby="kept-title">
      <h2 id="kept-title" class="text-xs font-semibold uppercase text-muted-foreground">
        In progress
      </h2>
      <ul class="-mx-1 flex flex-col">
        {#each app.state.reviews as review (review.id)}
          {@const isDone = review.total > 0 && review.ok === review.total}
          <li class="group flex items-center gap-1 rounded hover:bg-accent">
            <button
              class="flex min-w-0 flex-1 flex-col gap-1 px-1 py-1.5 text-left"
              title="Go on with this review: Claude remembers it"
              onclick={() => host.openReview(review.id)}
            >
              <span class="flex items-baseline gap-1.5">
                {#if review.kind === 'tour'}
                  <Compass class="size-3.5 shrink-0 self-center text-muted-foreground" />
                {:else if review.kind === 'changes'}
                  <FileDiff class="size-3.5 shrink-0 self-center text-muted-foreground" />
                {:else}
                  <span class="shrink-0 text-muted-foreground tabular-nums">#{review.number}</span>
                {/if}
                <span class="min-w-0 flex-1 truncate">{review.title}</span>
              </span>
              <span class="flex items-center gap-2 text-xs text-muted-foreground">
                <span
                  class="h-1 w-14 shrink-0 overflow-hidden rounded-full bg-input"
                  role="progressbar"
                  aria-label="Hunks ok"
                  aria-valuemin={0}
                  aria-valuemax={review.total}
                  aria-valuenow={review.ok}
                >
                  <span
                    class="block h-full bg-ok"
                    style:width="{(review.ok / Math.max(1, review.total)) * 100}%"
                  ></span>
                </span>
                <span class={cn('tabular-nums', isDone && 'text-ok')}>
                  {isDone
                    ? 'all clear'
                    : review.total
                      ? `${review.ok}/${review.total} ok`
                      : 'not started'}
                </span>
                <span class="truncate">· {ago(review.updatedAt)}</span>
              </span>
            </button>
            <Button
              class={cn(
                'mr-1',
                !isDone && 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100'
              )}
              variant="ghost"
              size="icon-xs"
              icon={Trash2}
              hint={isDone
                ? `Remove ${reviewName(review)} from the list`
                : `Drop ${reviewName(review)} (asks first)`}
              onclick={() => host.dropReview(review.id)}
            />
          </li>
        {/each}
      </ul>
    </section>
  {/if}

  <Starters />

  <PullPicker />
</div>
