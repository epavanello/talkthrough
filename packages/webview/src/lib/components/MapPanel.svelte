<script lang="ts">
  import {
    ChevronDown,
    ChevronRight,
    Circle,
    CircleCheck,
    CircleDot,
    RotateCcw,
    TriangleAlert
  } from '@lucide/svelte';
  import type { Block, HunkState, PrFile } from '@talkthrough/shared';
  import { app, basename, dirname, type MapView } from '$lib/app.svelte';
  import { Button } from '$lib/components/ui/button';
  import { fileTree, filesIn, type Dir } from '$lib/fileTree';
  import { host } from '$lib/rpc';
  import { cn } from '$lib/utils';

  const STATES: Record<HunkState, { icon: typeof Circle; tone: string; title: string }> = {
    todo: { icon: Circle, tone: 'text-muted-foreground', title: 'To review: click to mark it ok' },
    explained: { icon: CircleDot, tone: 'text-explained', title: 'Explained: click to mark it ok' },
    ok: { icon: CircleCheck, tone: 'text-ok', title: 'Clear: click to mark it to review again' }
  };
  const VIEWS: { value: MapView; label: string; hint: string }[] = [
    { value: 'flow', label: 'Flow', hint: "Claude's blocks, in the order the code runs" },
    { value: 'tree', label: 'Tree', hint: 'The files by folder' },
    { value: 'list', label: 'List', hint: 'The files in one flat list' }
  ];

  /** Without a map yet, Flow lists the files in diff order. */
  const blocks = $derived<Block[]>(
    app.state.blocks.length
      ? app.state.blocks
      : app.state.files.map((file) => ({
          id: file.path,
          title: file.path,
          why: '',
          hunks: file.hunks
        }))
  );
  const tree = $derived(fileTree(app.state.files));
  const step = $derived(new Set(app.state.step));
  const summary = $derived(
    app.mapView !== 'flow'
      ? `${app.state.files.length} files`
      : app.state.blocks.length
        ? `${app.state.blocks.length} blocks · ${app.state.hotspots.length} hotspots`
        : app.isPreparing
          ? 'Claude is drawing it…'
          : app.state.files.length
            ? 'no map yet: files in diff order'
            : ''
  );

  /** Rows opened or closed by hand; the others are open while they hold this step's hunks. */
  let toggled = $state<Record<string, boolean>>({});
  const isOpen = (key: string, ids: string[]) => toggled[key] ?? ids.some((id) => step.has(id));
  const toggle = (key: string, ids: string[]) => (toggled[key] = !isOpen(key, ids));
  const handleGroup = (ids: string[]) =>
    host.setHunks(ids, app.groupState(ids) === 'ok' ? 'todo' : 'ok');
  const doneOf = (ids: string[]) => ids.filter((id) => app.stateOf(id) === 'ok').length;
  const showFile = (file: PrFile) =>
    host.runCue({ kind: 'show', path: file.path, start: null, end: null, symbol: null });
</script>

{#snippet chevron(isExpanded: boolean)}
  {#if isExpanded}
    <ChevronDown class="size-3 shrink-0 text-muted-foreground" />
  {:else}
    <ChevronRight class="size-3 shrink-0 text-muted-foreground" />
  {/if}
{/snippet}

{#snippet groupState(ids: string[], what: string)}
  {@const state = STATES[app.groupState(ids)]}
  {@const label =
    app.groupState(ids) === 'ok'
      ? `${what}: all clear. Click to mark it to review again`
      : `${what}: click to mark it all ok`}
  <button
    class={cn('shrink-0', state.tone)}
    title={label}
    aria-label={label}
    onclick={() => handleGroup(ids)}
  >
    <state.icon class="size-3" />
  </button>
{/snippet}

{#snippet count(ids: string[])}
  <span
    class={cn(
      'shrink-0 tabular-nums',
      doneOf(ids) === ids.length ? 'text-ok' : 'text-muted-foreground'
    )}
  >
    {doneOf(ids)}/{ids.length}
  </span>
{/snippet}

{#snippet hunkRow(id: string, indent: number, isNamed: boolean)}
  {@const hunk = app.state.hunks[id]}
  {#if hunk}
    {@const state = STATES[app.stateOf(id)]}
    <div
      class={cn(
        'flex items-center gap-1.5 rounded py-0.5 pr-1 hover:bg-accent',
        step.has(id) && 'bg-accent/60'
      )}
      style:padding-left="{indent}rem"
    >
      <button
        class={cn('shrink-0', state.tone)}
        title={state.title}
        aria-label={state.title}
        onclick={() => host.setHunks([id], app.stateOf(id) === 'ok' ? 'todo' : 'ok')}
      >
        <state.icon class="size-3" />
      </button>
      <button
        class="min-w-0 flex-1 truncate text-left font-mono"
        title="{hunk.path} L{hunk.start}-{hunk.end}{hunk.header ? ` · ${hunk.header}` : ''}"
        onclick={() => host.showHunk(id)}
      >
        {#if app.kind === 'tour'}
          <span class="font-sans">{hunk.header || basename(hunk.path)}</span>
          <span class="text-muted-foreground"
            >{isNamed ? `${basename(hunk.path)}:` : 'L'}{hunk.start}</span
          >
        {:else if isNamed}
          {basename(hunk.path)} <span class="text-muted-foreground">L{hunk.start}</span>
        {:else}
          L{hunk.start}–{hunk.end}
          <span class="font-sans text-muted-foreground">{hunk.header}</span>
        {/if}
      </button>
      {#if app.kind !== 'tour'}
        <span class="shrink-0 text-muted-foreground">
          <span class="text-ok">+{hunk.additions}</span>
          <span class="text-destructive">−{hunk.deletions}</span>
        </span>
      {/if}
    </div>
  {/if}
{/snippet}

{#snippet fileRow(file: PrFile, indent: number, isFlat: boolean)}
  {@const key = `file:${file.path}`}
  <div
    class="flex items-center gap-1.5 rounded py-0.5 pr-1 hover:bg-accent"
    style:padding-left="{indent}rem"
  >
    <button
      class="shrink-0"
      title="Show or hide its hunks"
      aria-label="Show or hide its hunks"
      aria-expanded={isOpen(key, file.hunks)}
      onclick={() => toggle(key, file.hunks)}
    >
      {@render chevron(isOpen(key, file.hunks))}
    </button>
    {@render groupState(file.hunks, 'This file')}
    <button
      class="min-w-0 flex-1 truncate text-left"
      title="{app.kind === 'tour' ? 'Open' : 'Show the diff of'} {file.path}"
      onclick={() => showFile(file)}
    >
      {#if isFlat && dirname(file.path)}<span class="text-muted-foreground"
          >{dirname(file.path)}/</span
        >{/if}{basename(file.path)}
    </button>
    {@render count(file.hunks)}
  </div>
  {#if isOpen(key, file.hunks)}
    {#each file.hunks as id (id)}
      {@render hunkRow(id, indent + 2.25, false)}
    {/each}
  {/if}
{/snippet}

{#snippet dirRows(dir: Dir<PrFile>, indent: number)}
  {#each dir.dirs as child (child.path)}
    {@const key = `dir:${child.path}`}
    {@const ids = filesIn(child).flatMap((file) => file.hunks)}
    {@const isExpanded = toggled[key] ?? true}
    <div
      class="flex items-center gap-1.5 rounded py-0.5 pr-1 hover:bg-accent"
      style:padding-left="{indent}rem"
    >
      <button
        class="shrink-0"
        title="Open or close the folder"
        aria-label="Open or close the folder"
        aria-expanded={isExpanded}
        onclick={() => (toggled[key] = !isExpanded)}
      >
        {@render chevron(isExpanded)}
      </button>
      {@render groupState(ids, 'This folder')}
      <button
        class="min-w-0 flex-1 truncate text-left text-muted-foreground"
        title={child.path}
        onclick={() => (toggled[key] = !isExpanded)}
      >
        {child.name}/
      </button>
      {@render count(ids)}
    </div>
    {#if isExpanded}
      {@render dirRows(child, indent + 1)}
    {/if}
  {/each}
  {#each dir.files as file (file.path)}
    {@render fileRow(file, indent, false)}
  {/each}
{/snippet}

<section class="border-b">
  <div class="flex items-center gap-1.5 px-3 py-1">
    <button
      class="flex items-center gap-1 text-xs font-semibold uppercase text-muted-foreground hover:text-foreground"
      aria-expanded={app.isMapOpen}
      onclick={() => (app.isMapOpen = !app.isMapOpen)}
    >
      {@render chevron(app.isMapOpen)}
      Map
    </button>
    <div
      class="flex items-center rounded border p-px text-[11px]"
      role="group"
      aria-label="Map view"
    >
      {#each VIEWS as view (view.value)}
        <button
          class={cn(
            'rounded-sm px-1.5 leading-4',
            app.mapView === view.value
              ? 'bg-secondary text-secondary-foreground'
              : 'text-muted-foreground hover:text-foreground'
          )}
          title={view.hint}
          aria-pressed={app.mapView === view.value}
          onclick={() => (app.mapView = view.value)}
        >
          {view.label}
        </button>
      {/each}
    </div>
    <span class="ml-auto min-w-0 truncate text-xs text-muted-foreground">{summary}</span>
    <Button
      variant="ghost"
      size="icon-xs"
      icon={RotateCcw}
      hint={{
        title: 'Start over',
        body: 'Every hunk back to to review, and the files marked as Viewed on GitHub unmarked.',
        note: 'Asks first.'
      }}
      disabled={!app.counts.total}
      onclick={() => host.reset()}
    />
  </div>
  {#if app.isMapOpen && app.state.files.length}
    <div class="max-h-[38vh] overflow-y-auto px-2 pb-2 text-xs">
      {#if app.mapView === 'flow'}
        {#each blocks as block, index (block.id)}
          {@const key = `block:${block.id}`}
          <div class="flex items-center gap-1.5 rounded px-1 py-0.5 hover:bg-accent">
            <button
              class="shrink-0"
              title="Show or hide its hunks"
              aria-label="Show or hide its hunks"
              aria-expanded={isOpen(key, block.hunks)}
              onclick={() => toggle(key, block.hunks)}
            >
              {@render chevron(isOpen(key, block.hunks))}
            </button>
            {@render groupState(block.hunks, 'This block')}
            {#if app.state.blocks.length}
              <span class="w-4 shrink-0 text-right tabular-nums text-muted-foreground"
                >{index + 1}</span
              >
            {/if}
            <button
              class="min-w-0 flex-1 truncate text-left"
              title={block.why || block.title}
              onclick={() => toggle(key, block.hunks)}
            >
              {block.title}
            </button>
            {@render count(block.hunks)}
          </div>
          {#if isOpen(key, block.hunks)}
            {#each block.hunks as id (id)}
              {@render hunkRow(id, 2.25, true)}
            {/each}
          {/if}
        {/each}
      {:else if app.mapView === 'tree'}
        {@render dirRows(tree, 0.25)}
      {:else}
        {#each app.state.files as file (file.path)}
          {@render fileRow(file, 0.25, true)}
        {/each}
      {/if}
      {#if app.state.hotspots.length}
        <p class="mt-2 px-1 font-semibold uppercase text-muted-foreground">Hotspots</p>
        {#each app.state.hotspots as hotspot (hotspot.id)}
          <button
            class="flex w-full items-start gap-1.5 rounded px-1 py-0.5 text-left hover:bg-accent"
            title={hotspot.detail}
            onclick={() => host.send(`Let's explore this hotspot: ${hotspot.title}`)}
          >
            <TriangleAlert class="mt-0.5 size-3 shrink-0 text-warn" />
            <span>{hotspot.title}</span>
          </button>
        {/each}
      {/if}
    </div>
  {/if}
</section>
