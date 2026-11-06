<script lang="ts">
  import { ChevronLeft, RotateCw, Square, Terminal } from '@lucide/svelte';
  import { CHOICES, type Choice, type SessionStatus } from '@talkthrough/shared';
  import { app } from '$lib/app.svelte';
  import { Button } from '$lib/components/ui/button';
  import { host } from '$lib/rpc';
  import { cn } from '$lib/utils';
  import Shortcuts from './Shortcuts.svelte';

  const STATUS: Record<SessionStatus, { label: string; tone: string; isBusy?: boolean }> = {
    idle: { label: 'No review', tone: 'text-muted-foreground' },
    starting: { label: 'Starting', tone: 'text-explained', isBusy: true },
    waiting: { label: 'Claude needs you', tone: 'text-warn' },
    ready: { label: 'Your turn', tone: 'text-ok' },
    thinking: { label: 'Claude', tone: 'text-explained', isBusy: true },
    recording: { label: 'Listening', tone: 'text-destructive', isBusy: true },
    ended: { label: 'Claude stopped', tone: 'text-muted-foreground' },
    paused: { label: 'Saved', tone: 'text-muted-foreground' },
    error: { label: 'Error', tone: 'text-destructive' }
  };

  const pr = $derived(app.state.pr);
  const status = $derived(
    app.isPreparing
      ? { label: 'Preparing', tone: 'text-explained', isBusy: true }
      : STATUS[app.state.status]
  );
  const counts = $derived(app.counts);
  /** `claude-opus-5-5` → `Opus 5.5` */
  const running = $derived(
    app.state.model
      ?.replace(/^claude-/, '')
      .replace(/-(\d+)-(\d+).*$/, ' $1.$2')
      .replace(/^\w/, (first) => first.toUpperCase()) ?? null
  );

  /** The header's pickers: Claude Code's per-session options. */
  const PICKERS: { setting: Choice; label: string; hint: string }[] = [
    {
      setting: 'model',
      label: 'Model',
      hint: "Claude Code's model aliases. A running session goes on with the new one."
    },
    {
      setting: 'effort',
      label: 'Effort',
      hint: 'How long Claude thinks before it answers: higher is deeper and slower. A running session goes on with the new one.'
    }
  ];
</script>

<header class="flex flex-col gap-1 border-b px-2 py-1.5">
  <div class="flex items-center gap-0.5">
    <Button
      variant="ghost"
      size="icon-xs"
      icon={ChevronLeft}
      hint={{
        title: 'All reviews',
        body: 'Back to the start screen. Claude stops; this review is kept and goes on where it was.'
      }}
      onclick={() => host.closeReview()}
    />
    {#if pr}
      <button
        class="min-w-0 flex-1 truncate px-1 text-left font-semibold hover:text-link"
        title={pr.url ? `${pr.title}: open it on GitHub` : pr.title}
        onclick={() => pr.url && host.openUrl(pr.url)}
      >
        #{pr.number}
        {pr.title}
      </button>
    {:else}
      <span class="min-w-0 flex-1 truncate px-1 text-muted-foreground"
        >Loading the pull request…</span
      >
    {/if}
    <Shortcuts />
    <Button
      variant="ghost"
      size="icon-xs"
      icon={Terminal}
      class={app.state.isTerminalShown ? 'bg-accent text-foreground' : ''}
      aria-pressed={app.state.isTerminalShown}
      hint={app.state.isTerminalShown
        ? "Hide Claude's terminal"
        : "Show Claude's terminal: the review session itself"}
      disabled={!app.isRunning}
      onclick={() => host.toggleTerminal()}
    />
    {#if app.isRunning}
      <Button
        variant="ghost"
        size="icon-xs"
        icon={Square}
        hint="Stop Claude. The review stays: Resume goes on with it"
        onclick={() => host.stop()}
      />
    {:else if pr}
      <Button
        variant="ghost"
        size="icon-xs"
        icon={RotateCw}
        hint="New Claude session on this pull request: it prepares again; the chat and hunk states stay"
        onclick={() => host.restart()}
      />
    {/if}
  </div>
  <div class="flex items-center gap-2 px-1 text-xs">
    <span class={cn('flex shrink-0 items-center gap-1 font-medium', status.tone)} role="status">
      <span class={cn('size-1.5 rounded-full bg-current', status.isBusy && 'animate-pulse')}></span>
      {status.label}
    </span>
    {#if app.state.activity && !app.isPreparing && app.state.status !== 'waiting'}
      <span class="min-w-0 truncate text-muted-foreground">{app.state.activity}…</span>
    {/if}
    {#if counts.total}
      <span
        class="ml-auto shrink-0 text-muted-foreground tabular-nums"
        title="{counts.ok} ok, {counts.explained} explained, {counts.total -
          counts.ok -
          counts.explained} to go"
      >
        <span class="text-ok">{counts.ok}</span>/{counts.total} ok
      </span>
    {/if}
  </div>
  {#if pr}
    <div
      class="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1 px-1 text-xs text-muted-foreground"
    >
      {#each PICKERS as picker (picker.setting)}
        <label class="flex items-center gap-1" title={picker.hint}>
          {picker.label}
          <select
            class="h-5 rounded border border-input bg-input-background px-1 text-xs text-foreground outline-none focus:border-ring disabled:opacity-50"
            value={app.state.choices[picker.setting]}
            disabled={app.isPreparing}
            onchange={(event) => host.choose(picker.setting, event.currentTarget.value)}
          >
            {#each CHOICES[picker.setting] as option (option.value)}
              <option value={option.value}>{option.label}</option>
            {/each}
          </select>
        </label>
      {/each}
      {#if running}<span class="truncate" title={app.state.model}>running {running}</span>{/if}
    </div>
  {/if}
</header>
