<script lang="ts">
  import { Compass, FileDiff, GitBranch, GitCommitHorizontal } from '@lucide/svelte';
  import type { ChangeScope, LocalChanges } from '@talkthrough/shared';
  import { app } from '$lib/app.svelte';
  import { Button } from '$lib/components/ui/button';
  import { host } from '$lib/rpc';

  const SCOPES: {
    scope: ChangeScope;
    label: string;
    body: string;
    icon: typeof Compass;
    /** Why there is nothing to review in this scope. */
    empty: (changes: LocalChanges) => string;
  }[] = [
    {
      scope: 'staged',
      label: 'Staged',
      body: 'What git commit would take, before you commit it.',
      icon: GitCommitHorizontal,
      empty: () => 'nothing staged (git add what to review)'
    },
    {
      scope: 'uncommitted',
      label: 'Uncommitted',
      body: 'Everything not committed yet, staged or not, new files included.',
      icon: FileDiff,
      empty: () => 'no uncommitted changes'
    },
    {
      scope: 'branch',
      label: 'This branch',
      body: 'Everything since main, committed or not: the pull request it will be.',
      icon: GitBranch,
      empty: (changes) =>
        changes.base
          ? `nothing on this branch that ${changes.base} doesn't have`
          : 'no main or master branch to compare with'
    }
  ];

  let question = $state('');

  const changes = $derived(app.state.changes);
  const blocker = $derived(app.blockerOf('changes'));
  const countOf = (scope: ChangeScope) => changes?.[scope] ?? 0;
  /** What the disabled buttons can't do, said once under them. */
  const why = $derived(
    !changes
      ? 'Open a repository in this window to review its changes.'
      : SCOPES.filter((one) => !countOf(one.scope))
          .map((one) => one.empty(changes))
          .join(' · ')
  );

  // The button starts it itself: a tooltip's trigger makes every button type="button", no submit
  const explain = (event?: Event) => {
    event?.preventDefault();
    const value = question.trim();
    if (!value || blocker || !changes) return;
    question = '';
    void host.startTour(value);
  };
</script>

<section class="flex flex-col gap-2 border-b px-3 py-3" aria-labelledby="changes-title">
  <h2 id="changes-title" class="text-xs font-semibold uppercase text-muted-foreground">
    Your changes
  </h2>
  <div class="flex flex-wrap gap-1.5">
    {#each SCOPES as one (one.scope)}
      {@const count = countOf(one.scope)}
      <Button
        variant="secondary"
        size="sm"
        icon={one.icon}
        hint={{
          title: `Review: ${one.label.toLowerCase()}`,
          body: one.body,
          note: `${count} file${count === 1 ? '' : 's'}`
        }}
        disabled={Boolean(blocker) || !count}
        onclick={() => host.reviewChanges(one.scope)}
      >
        {one.label}
        <span class="text-xs tabular-nums text-muted-foreground">{count}</span>
      </Button>
    {/each}
  </div>
  {#if blocker}
    <p class="text-xs text-warn">{blocker}</p>
  {:else if why}
    <p class="text-xs text-muted-foreground">
      {why[0].toUpperCase()}{why.slice(1)}{why.endsWith('.') ? '' : '.'}
    </p>
  {/if}
</section>

<section class="flex flex-col gap-2 border-b px-3 py-3" aria-labelledby="tour-title">
  <h2 id="tour-title" class="text-xs font-semibold uppercase text-muted-foreground">
    Explain how something works
  </h2>
  <form class="flex gap-1.5" onsubmit={explain}>
    <input
      bind:value={question}
      aria-label="What Claude should walk you through"
      placeholder="How does the sign-up form work?"
      disabled={Boolean(blocker) || !changes}
      class="min-w-0 flex-1 rounded border border-input bg-input-background px-2 py-1 text-sm outline-none focus:border-ring disabled:opacity-50"
    />
    <Button
      size="sm"
      icon={Compass}
      hint={{
        title: 'Tour',
        body: 'Claude finds the code, draws a tour of it in the order it runs, and walks you through it, with the app beside it.'
      }}
      disabled={!question.trim() || Boolean(blocker) || !changes}
      onclick={() => explain()}
    >
      Tour
    </Button>
  </form>
  {#if !blocker && !changes}
    <p class="text-xs text-muted-foreground">Open a repository in this window to explore it.</p>
  {:else if !blocker && !question.trim()}
    <p class="text-xs text-muted-foreground">
      Ask about a feature, a flow or a part of the code: Claude walks you through it.
    </p>
  {/if}
</section>
