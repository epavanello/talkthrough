<script lang="ts">
  import { ArrowRight, LoaderCircle, RotateCw, Search } from '@lucide/svelte';
  import type { PullFilter, PullList } from '@talkthrough/shared';
  import { ago, app, isPrRef, keyLabel } from '$lib/app.svelte';
  import { Button } from '$lib/components/ui/button';
  import { host } from '$lib/rpc';
  import { cn } from '$lib/utils';

  /** GitHub's own lists. */
  const FILTERS: { value: PullFilter; label: string; hint: string; empty: string }[] = [
    {
      value: 'review',
      label: 'To review',
      hint: 'Your review is requested',
      empty: 'No pull request waits for your review.'
    },
    {
      value: 'assigned',
      label: 'Assigned',
      hint: 'Assigned to you',
      empty: 'No open pull request is assigned to you.'
    },
    {
      value: 'mine',
      label: 'Mine',
      hint: 'Opened by you',
      empty: 'You have no open pull request.'
    },
    {
      value: 'open',
      label: 'All open',
      hint: 'Every open pull request',
      empty: 'No open pull request here.'
    }
  ];

  let text = $state('');
  let list = $state<PullList | null>(null);
  let isLoading = $state(false);
  let asked = 0;

  const filter = $derived(FILTERS.find((one) => one.value === app.pullFilter) ?? FILTERS[0]);
  /** The search: words or qualifiers; a PR number or URL starts it instead. */
  const query = $derived(isPrRef(text) ? '' : text.trim());
  const number = $derived(text.trim().match(/^#?(\d+)$/)?.[1]);

  const load = async (which: PullFilter, words: string) => {
    const at = ++asked;
    isLoading = true;
    const answer = await host
      .listPulls(which, words)
      .catch((error: Error): PullList => ({ status: 'error', message: error.message }));
    if (at !== asked) return;
    list = answer;
    isLoading = false;
  };

  // The list follows the filter at once, and the search a moment after typing stops
  $effect(() => {
    const which = app.pullFilter;
    const words = query;
    const timer = setTimeout(() => void load(which, words), words ? 350 : 0);
    return () => clearTimeout(timer);
  });

  const kept = (number: number) => app.state.reviews.find((review) => review.number === number);

  /** Why a pull request can't be reviewed now (a requirement missing), or null. */
  const blocker = $derived(app.blockerOf('pr'));

  const handleKeydown = (event: KeyboardEvent) => {
    if (event.key !== 'Enter' || !isPrRef(text) || blocker) return;
    event.preventDefault();
    void host.start(text.trim(), app.takeFocus());
  };
</script>

<!-- The last target of the start screen's "What to look at", after the code and your changes -->
<section class="flex flex-col gap-1.5 px-3 pt-3 pb-3" role="group" aria-labelledby="pulls-title">
  <div class="flex items-center gap-2">
    <h3 id="pulls-title" class="text-xs font-semibold">A pull request</h3>
    {#if isLoading && list}<LoaderCircle
        class="size-3 animate-spin text-muted-foreground"
        aria-label="Loading"
      />{/if}
  </div>
  {#if blocker}<p class="text-xs text-warn">{blocker}</p>{/if}
  <div
    class="flex flex-wrap gap-px rounded border p-px text-xs"
    role="radiogroup"
    aria-label="Which pull requests"
  >
    {#each FILTERS as one (one.value)}
      <button
        class={cn(
          'grow rounded-sm px-1.5 py-0.5 whitespace-nowrap',
          app.pullFilter === one.value
            ? 'bg-secondary text-secondary-foreground'
            : 'text-muted-foreground hover:text-foreground'
        )}
        role="radio"
        aria-checked={app.pullFilter === one.value}
        title={one.hint}
        onclick={() => (app.pullFilter = one.value)}
      >
        {one.label}
      </button>
    {/each}
  </div>
  <label class="relative block">
    <span class="sr-only">Search the pull requests, or type a PR number or URL</span>
    <Search
      class="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground"
    />
    <input
      bind:value={text}
      class="h-7 w-full rounded border border-input bg-input-background pr-2 pl-7 text-sm outline-none focus:border-ring"
      placeholder="Search, or a PR number or URL"
      onkeydown={handleKeydown}
    />
  </label>

  {#if isPrRef(text)}
    <button
      class="flex items-center gap-2 rounded border border-ring px-2 py-1.5 text-left hover:bg-accent disabled:pointer-events-none disabled:opacity-50"
      disabled={Boolean(blocker)}
      onclick={() => host.start(text.trim(), app.takeFocus())}
    >
      <ArrowRight class="size-3.5 shrink-0 text-link" />
      <span class="min-w-0 flex-1 truncate"
        >Review {number ? `PR #${number}` : 'this pull request'}</span
      >
      <kbd>{keyLabel('enter')}</kbd>
    </button>
  {/if}

  {#if !list}
    <p class="flex items-center gap-2 py-2 text-xs text-muted-foreground">
      <LoaderCircle class="size-3.5 animate-spin" /> Loading pull requests…
    </p>
  {:else if list.status === 'error'}
    <div class="flex flex-col items-start gap-1.5 rounded border p-2 text-xs" role="alert">
      <p class="text-destructive">Could not list the pull requests.</p>
      <p class="text-muted-foreground [overflow-wrap:anywhere]">{list.message}</p>
      <Button
        size="xs"
        variant="secondary"
        icon={RotateCw}
        onclick={() => load(app.pullFilter, query)}>Try again</Button
      >
    </div>
  {:else if list.status === 'none'}
    <p class="text-xs text-muted-foreground">{list.message}</p>
  {:else if !list.items.length}
    <div class="flex flex-col items-start gap-1 py-1 text-xs text-muted-foreground">
      <p>{query ? `No open pull request matches “${query}”.` : filter.empty}</p>
      {#if app.pullFilter !== 'open'}
        <button class="text-link hover:text-link-hover" onclick={() => (app.pullFilter = 'open')}>
          Show every open pull request
        </button>
      {/if}
    </div>
  {:else}
    <ul class={cn('-mx-1 flex flex-col', isLoading && 'opacity-60')} aria-busy={isLoading}>
      {#each list.items as pr (pr.number)}
        {@const review = kept(pr.number)}
        <li>
          <button
            class="flex w-full flex-col gap-0.5 rounded px-1 py-1.5 text-left hover:bg-accent disabled:pointer-events-none disabled:opacity-50"
            disabled={Boolean(blocker)}
            title={review
              ? 'Go on with this review: Claude remembers it'
              : 'Start a review of this pull request'}
            onclick={() => host.start(pr.url, app.takeFocus())}
          >
            <span class="flex items-baseline gap-1.5">
              <span class="shrink-0 text-muted-foreground tabular-nums">#{pr.number}</span>
              <span class="min-w-0 flex-1 truncate">{pr.title}</span>
            </span>
            <span class="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
              {#if pr.isDraft}<span class="rounded border px-1 leading-4">Draft</span>{/if}
              {#if pr.author}<span>{pr.author}</span>{/if}
              <span>{ago(pr.updatedAt)}</span>
              <span class="tabular-nums"
                ><span class="text-ok">+{pr.additions}</span>
                <span class="text-destructive">−{pr.deletions}</span></span
              >
              {#if review}<span class="text-explained"
                  >in progress · {review.ok}/{review.total} ok</span
                >{/if}
            </span>
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</section>
