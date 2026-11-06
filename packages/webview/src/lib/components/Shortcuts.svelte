<script lang="ts">
  import { Keyboard } from '@lucide/svelte';
  import { SHORTCUTS } from '@talkthrough/shared';
  import { keyLabel } from '$lib/app.svelte';
  import Tip from './Tip.svelte';
</script>

{#snippet list()}
  <p class="font-semibold">Keyboard shortcuts</p>
  <dl class="grid grid-cols-[auto_1fr] items-baseline gap-x-3 gap-y-1">
    {#each SHORTCUTS as shortcut (shortcut.command)}
      <dt><kbd>{keyLabel(shortcut.key)}</kbd></dt>
      <dd>{shortcut.label}</dd>
    {/each}
    <dt><kbd>{keyLabel('enter')}</kbd></dt>
    <dd>Send what you typed; <kbd>{keyLabel('shift+enter')}</kbd> for a new line</dd>
  </dl>
  <p class="text-muted-foreground">They work anywhere in VS Code while Claude runs.</p>
{/snippet}

<Tip content={list}>
  {#snippet children(trigger)}
    <button
      {...trigger}
      class="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
      aria-label="Keyboard shortcuts"
    >
      <Keyboard class="size-3.5" />
    </button>
  {/snippet}
</Tip>
