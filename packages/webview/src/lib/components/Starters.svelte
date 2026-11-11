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
  const hasFocus = $derived(Boolean(app.focus.trim()));

  /** Enter starts nothing: the goal is for whichever target the person picks next. */
  const tour = () => {
    if (hasFocus && !blocker && changes) void host.startTour(app.takeFocus());
  };
</script>

<section class="flex flex-col gap-1.5 border-b px-3 py-3" aria-labelledby="goal-title">
  <h2 id="goal-title" class="text-xs font-semibold uppercase text-muted-foreground">
    Goal <span class="font-normal normal-case">(optional)</span>
  </h2>
  <textarea
    bind:value={app.focus}
    rows="2"
    aria-labelledby="goal-title"
    aria-describedby="goal-hint"
    placeholder="Could anything break? How does the sign-up form work?"
    disabled={Boolean(blocker) || !changes}
    class="block w-full resize-none rounded border border-input bg-input-background px-2 py-1 text-sm outline-none focus:border-ring disabled:opacity-50"
  ></textarea>
  <p id="goal-hint" class="text-xs text-muted-foreground">
    {#if blocker || !changes}
      Open a repository in this window to explore it.
    {:else}
      What you want to know above all: Claude starts from it, whatever you pick below.
    {/if}
  </p>
</section>

<section class="flex flex-col gap-3 px-3 pt-3" aria-labelledby="target-title">
  <h2 id="target-title" class="flex items-baseline gap-1.5 text-xs">
    <span class="font-semibold uppercase text-muted-foreground">What to look at</span>
    {#if hasFocus}<span class="text-explained">with your goal</span>{/if}
  </h2>

  <div class="flex flex-col gap-1.5" role="group" aria-labelledby="code-title">
    <h3 id="code-title" class="text-xs font-semibold">The code</h3>
    <div class="flex items-center gap-2">
      <p class="min-w-0 flex-1 text-xs text-muted-foreground">
        {hasFocus
          ? 'A tour of what your goal asks about, in the order it runs.'
          : 'A tour of a feature or a flow: write the goal first, it starts from it.'}
      </p>
      <Button
        variant="secondary"
        size="sm"
        icon={Compass}
        hint={{
          title: 'Tour',
          body: 'Claude finds the code your goal asks about, draws a tour of it in the order it runs, and walks you through it, with the app beside it.'
        }}
        disabled={!hasFocus || Boolean(blocker) || !changes}
        onclick={tour}
      >
        Tour
      </Button>
    </div>
  </div>

  <div class="flex flex-col gap-1.5" role="group" aria-labelledby="changes-title">
    <h3 id="changes-title" class="text-xs font-semibold">Your changes</h3>
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
          onclick={() => host.reviewChanges(one.scope, app.takeFocus())}
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
  </div>
</section>
