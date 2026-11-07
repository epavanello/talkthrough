<script lang="ts">
  import { CircleCheck, CircleX, RotateCw, SquareTerminal, TriangleAlert } from '@lucide/svelte';
  import type { Requirement } from '@talkthrough/shared';
  import { app } from '$lib/app.svelte';
  import { Button } from '$lib/components/ui/button';
  import { host } from '$lib/rpc';

  const ICONS: Record<
    Requirement['state'],
    { icon: typeof CircleCheck; tone: string; label: string }
  > = {
    ok: { icon: CircleCheck, tone: 'text-ok', label: 'Ready' },
    warn: { icon: TriangleAlert, tone: 'text-warn', label: 'Needs a look' },
    missing: { icon: CircleX, tone: 'text-destructive', label: 'Missing' }
  };

  const requirements = $derived(app.state.requirements ?? []);
  const hasProblems = $derived(requirements.some((one) => one.state !== 'ok' && !one.isOptional));
  /** An optional extra not installed, worth a word when nothing else is missing. */
  const extra = $derived(requirements.find((one) => one.state !== 'ok' && one.isOptional));
</script>

<!-- Shown only when something is missing: then the whole setup, so what works is clear too -->
{#if hasProblems}
  <section
    class="mx-3 mt-3 flex flex-col gap-2 rounded border p-2.5 text-xs"
    aria-labelledby="setup-title"
  >
    <h2 id="setup-title" class="font-semibold">Before you start</h2>
    <ul class="flex flex-col gap-2">
      {#each requirements as one (one.name)}
        {@const state = ICONS[one.state]}
        <li class="flex items-start gap-2">
          <state.icon class="mt-px size-3.5 shrink-0 {state.tone}" aria-label={state.label} />
          <div class="flex min-w-0 flex-1 flex-col items-start gap-1">
            <p>
              <span class="font-medium">{one.name}</span>
              <span class="text-muted-foreground">{one.detail}</span>
            </p>
            {#if one.fix}
              <Button
                size="xs"
                variant="secondary"
                icon={SquareTerminal}
                hint={{ body: 'Types it in a new terminal: press Enter there to run it.' }}
                onclick={() => host.runInTerminal(one.fix!)}
              >
                {one.fix}
              </Button>
            {/if}
            {#if one.url}
              <button
                class="text-link hover:text-link-hover"
                onclick={() => host.openUrl(one.url!)}
              >
                How to install it
              </button>
            {/if}
          </div>
        </li>
      {/each}
    </ul>
    <Button
      class="self-start"
      size="xs"
      variant="ghost"
      icon={RotateCw}
      onclick={() => host.checkRequirements()}
    >
      Check again
    </Button>
  </section>
{/if}
{#if !hasProblems && extra}
  <p class="mx-3 mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
    <span>{extra.name}: {extra.detail}</span>
    {#if extra.fix}
      <button
        class="text-link hover:text-link-hover"
        title="Types it in a new terminal: press Enter there to run it"
        onclick={() => host.runInTerminal(extra.fix!)}
      >
        {extra.fix}
      </button>
    {/if}
  </p>
{/if}
