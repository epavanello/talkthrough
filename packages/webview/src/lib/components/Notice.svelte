<script lang="ts">
  import {
    CircleX,
    FolderGit2,
    GitBranch,
    GitCommitHorizontal,
    Pause,
    Play,
    RefreshCw,
    RotateCw,
    ShieldQuestion,
    SquareTerminal,
    X
  } from '@lucide/svelte';
  import type { Snippet } from 'svelte';
  import { app } from '$lib/app.svelte';
  import { kindOf } from '@talkthrough/shared';
  import { Button } from '$lib/components/ui/button';
  import { host } from '$lib/rpc';
  import { cn } from '$lib/utils';

  const pr = $derived(app.state.pr);
  const status = $derived(app.state.status);
  const newHead = $derived(app.state.newHead);
  /** Checkout offers dismissed in this window, by PR head. */
  let dismissed = $state<string[]>([]);
  const isCheckoutOffered = $derived(
    Boolean(pr && kindOf(pr) === 'pr' && !pr.isLive && !dismissed.includes(pr.headSha)) &&
      status !== 'error' &&
      status !== 'idle'
  );
</script>

{#snippet notice(
  icon: typeof CircleX,
  tone: string,
  body: Snippet,
  actions: Snippet,
  onclose?: () => void
)}
  {@const Icon = icon}
  <div
    class="flex items-start gap-2 border-b bg-muted px-3 py-2 text-xs"
    role={tone === 'text-destructive' ? 'alert' : 'status'}
  >
    <Icon class={cn('mt-px size-3.5 shrink-0', tone)} />
    <div class="flex min-w-0 flex-1 flex-col items-start gap-1.5">
      {@render body()}
      <div class="flex flex-wrap gap-1.5">{@render actions()}</div>
    </div>
    {#if onclose}
      <button
        class="shrink-0 text-muted-foreground hover:text-foreground"
        aria-label="Dismiss"
        onclick={onclose}
      >
        <X class="size-3.5" />
      </button>
    {/if}
  </div>
{/snippet}

{#if status === 'error'}
  {#snippet body()}
    <p class="[overflow-wrap:anywhere]">{app.state.error ?? 'Something went wrong.'}</p>
  {/snippet}
  {#snippet actions()}
    {#if pr}
      <Button size="xs" icon={Play} onclick={() => host.resume()}>Try again</Button>
      <Button size="xs" variant="secondary" icon={RotateCw} onclick={() => host.restart()}
        >New Claude session</Button
      >
    {/if}
    <Button size="xs" variant="ghost" onclick={() => host.closeReview()}>All reviews</Button>
  {/snippet}
  {@render notice(CircleX, 'text-destructive', body, actions)}
{:else if status === 'waiting'}
  {#snippet body()}
    {#if app.state.dialog === 'trust'}
      <p>
        Claude asks whether you trust this folder. Talkthrough's session only reads it: edits are
        denied.
      </p>
    {:else}
      <p>{app.state.activity ?? 'Claude is asking something in its terminal.'}</p>
    {/if}
  {/snippet}
  {#snippet actions()}
    {#if app.state.dialog === 'trust'}
      <Button size="xs" icon={ShieldQuestion} onclick={() => host.trustFolder()}
        >Trust this folder</Button
      >
    {/if}
    <Button
      size="xs"
      variant={app.state.dialog === 'trust' ? 'secondary' : 'default'}
      icon={SquareTerminal}
      onclick={() => host.showTerminal()}
    >
      Show the terminal
    </Button>
  {/snippet}
  {@render notice(ShieldQuestion, 'text-warn', body, actions)}
{:else if (status === 'paused' || status === 'ended') && pr}
  {#snippet body()}
    <p>
      {status === 'paused' ? 'Your review, as you left it.' : 'Claude is not running.'}
      Resume goes on with the same Claude session: it remembers the review.
    </p>
  {/snippet}
  {#snippet actions()}
    <Button size="xs" icon={Play} onclick={() => host.resume()}>Resume</Button>
  {/snippet}
  {@render notice(Pause, 'text-muted-foreground', body, actions)}
{/if}

{#if newHead && pr && status !== 'error'}
  {#snippet body()}
    <p>
      {app.kind === 'changes'
        ? 'Your changes moved since this review.'
        : newHead.commits === null
          ? 'The PR was rewritten since your review (a force-push).'
          : `${newHead.commits} new commit${newHead.commits === 1 ? '' : 's'} since your review.`}
      Update keeps what didn't change; the rest gathers in a block at the top of the map.
    </p>
  {/snippet}
  {#snippet actions()}
    <Button
      size="xs"
      icon={RefreshCw}
      hint={{
        title: 'Update',
        body: 'The review moves to the new head, in the same Claude session: Claude hears what changed and explains only that.'
      }}
      disabled={status === 'thinking' || status === 'recording' || status === 'starting'}
      onclick={() => host.update()}
    >
      Update
    </Button>
  {/snippet}
  {@render notice(GitCommitHorizontal, 'text-explained', body, actions)}
{/if}

{#if isCheckoutOffered && pr}
  {#snippet body()}
    <p>
      Diffs open on read-only copies: no IntelliSense or local errors. Bring the PR head here for
      the real thing.
    </p>
  {/snippet}
  {#snippet actions()}
    <Button
      size="xs"
      variant="secondary"
      icon={FolderGit2}
      hint={{
        title: 'Review worktree',
        body: `A worktree at the PR head (.claude/worktrees/pr-${pr.number}), opened in a new window where the review goes on. Your checkout stays as it is.`,
        note: 'talkthrough.worktreeSetup runs a setup command there, such as pnpm install.'
      }}
      onclick={() => host.openWorktree()}
    >
      Review worktree
    </Button>
    <Button
      size="xs"
      variant="secondary"
      icon={GitBranch}
      hint={{
        title: 'Check out here',
        body: `This window's checkout moves to ${pr.head}. Asks first; needs no uncommitted changes.`
      }}
      onclick={() => host.checkoutPr()}
    >
      Check out here
    </Button>
  {/snippet}
  {@render notice(
    GitBranch,
    'text-muted-foreground',
    body,
    actions,
    () => (dismissed = [...dismissed, pr.headSha])
  )}
{/if}
