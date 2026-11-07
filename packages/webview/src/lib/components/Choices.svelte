<script lang="ts">
  import { CHOICES, type Choice } from '@talkthrough/shared';
  import { app } from '$lib/app.svelte';
  import { host } from '$lib/rpc';

  /** Claude Code's per-session options: chosen before a review starts, changed while it runs. */
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

{#each PICKERS as picker (picker.setting)}
  <label
    class="flex items-center gap-1"
    title={app.isBusy
      ? "It can change once Claude's turn ends: changing it restarts the session."
      : app.state.status === 'idle'
        ? `${picker.hint.split('.')[0]}. For the next review or tour you start.`
        : picker.hint}
  >
    {picker.label}
    <select
      class="h-5 rounded border border-input bg-input-background px-1 text-xs text-foreground outline-none focus:border-ring disabled:opacity-50"
      value={app.state.choices[picker.setting]}
      disabled={app.isBusy}
      onchange={(event) => host.choose(picker.setting, event.currentTarget.value)}
    >
      {#each CHOICES[picker.setting] as option (option.value)}
        <option value={option.value}>{option.label}</option>
      {/each}
    </select>
  </label>
{/each}
