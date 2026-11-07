<script lang="ts">
  import { Compass, FileDiff, GitBranch, GitCommitHorizontal } from '@lucide/svelte';
  import type { ChangeScope } from '@talkthrough/shared';
  import { Button } from '$lib/components/ui/button';
  import { host } from '$lib/rpc';

  const SCOPES: { scope: ChangeScope; label: string; body: string; icon: typeof Compass }[] = [
    {
      scope: 'staged',
      label: 'Staged',
      body: 'What git commit would take, before you commit it.',
      icon: GitCommitHorizontal
    },
    {
      scope: 'uncommitted',
      label: 'Uncommitted',
      body: 'Everything not committed yet, staged or not, new files included.',
      icon: FileDiff
    },
    {
      scope: 'branch',
      label: 'This branch',
      body: 'Everything since main, committed or not: the pull request it will be.',
      icon: GitBranch
    }
  ];

  let question = $state('');

  const explain = (event: SubmitEvent) => {
    event.preventDefault();
    const value = question.trim();
    if (!value) return;
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
      <Button
        variant="secondary"
        size="sm"
        icon={one.icon}
        hint={{ title: `Review: ${one.label.toLowerCase()}`, body: one.body }}
        onclick={() => host.reviewChanges(one.scope)}
      >
        {one.label}
      </Button>
    {/each}
  </div>
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
      class="min-w-0 flex-1 rounded border border-input bg-input-background px-2 py-1 text-sm outline-none focus:border-ring"
    />
    <Button
      type="submit"
      size="sm"
      icon={Compass}
      hint={{
        title: 'Tour',
        body: 'Claude finds the code, draws a tour of it in the order it runs, and walks you through it, with the app beside it.'
      }}
      disabled={!question.trim()}
    >
      Tour
    </Button>
  </form>
</section>
