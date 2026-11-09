<script lang="ts">
  import { ArrowRight, Check, Info, LoaderCircle, Mic } from '@lucide/svelte';
  import { choiceText, type ChatMessage, type Cue, type Sentence } from '@talkthrough/shared';
  import { app, basename } from '$lib/app.svelte';
  import { Button } from '$lib/components/ui/button';
  import { host } from '$lib/rpc';
  import { cn } from '$lib/utils';

  let list = $state<HTMLDivElement | null>(null);
  /** Auto messages shown whole, by id. */
  let expanded = $state(new Set<string>());

  const ICONS = { show: '◆', open: '↗', refs: '⇄', page: '◎', mark: '▣', choice: '›' } as const;
  /** Steps of the preparation shown at once; the older ones fold into a count. */
  const TRAIL = 6;

  const cueLabel = (cue: Cue) =>
    cue.kind === 'page'
      ? `${ICONS.page} ${cue.path.replace(/^https?:\/\/[^/]+/, '') || '/'}`
      : cue.kind === 'mark'
        ? `${ICONS.mark} ${(cue.symbol ?? cue.path).replace(/^(change|action|note):\s*/i, '')}`
        : `${ICONS[cue.kind]} ${basename(cue.path)}${cue.start ? `:${cue.start}` : ''}`;
  const cueTitle = (cue: Cue) =>
    cue.kind === 'page'
      ? `Open ${cue.path} in the browser panel`
      : cue.kind === 'mark'
        ? `Mark ${cue.path} in the browser panel`
        : `${cue.kind === 'show' ? (app.kind === 'tour' ? 'Show' : 'Show the diff of') : cue.kind === 'open' ? 'Open' : 'References in'} ${cue.path}${
            cue.start
              ? ` L${cue.start}${cue.end && cue.end !== cue.start ? `-${cue.end}` : ''}`
              : ''
          }${cue.symbol ? ` (${cue.symbol})` : ''}`;
  const time = (at: number) =>
    new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const isCurrent = (message: ChatMessage, index: number) =>
    app.state.player.messageId === message.id && app.state.player.sentence === index;
  const isCode = (sentence: Sentence) =>
    sentence.parts.length === 1 && sentence.parts[0].type === 'code';
  const PREPARING = {
    pr: {
      title: 'Claude is studying the pull request',
      body: 'It reads the diff and draws a map of the changes, in the order the code runs.'
    },
    changes: {
      title: 'Claude is studying your changes',
      body: 'It reads the diff and draws a map of them, in the order the code runs.'
    },
    tour: {
      title: 'Claude is exploring the code',
      body: 'It finds where this lives and draws a tour of it, in the order it runs.'
    }
  } as const;

  /**
   * A repository path written as code (`src/a.ts`, `src/a.ts:40`) rather than as a cue: still a link
   * that opens it.
   */
  const fileOf = (code: string): Cue | null => {
    const match = code.match(
      /^([\w@.+[\]()-]+(?:\/[\w@.+[\]()-]+)+\.[A-Za-z0-9]{1,8})(?::(\d+))?$/
    );
    if (!match) return null;
    const start = match[2] ? Number(match[2]) : null;
    return { kind: 'open', path: match[1].replace(/^\.?\//, ''), start, end: start, symbol: null };
  };

  /** The replies a message offers to click, as its choice cues say them. */
  const choicesOf = (message: ChatMessage) => [
    ...new Set(
      message.sentences.flatMap((sentence) =>
        sentence.parts.flatMap((part) =>
          part.type === 'cue' && part.cue.kind === 'choice' ? [choiceText(part.cue)] : []
        )
      )
    )
  ];

  /** Next, pressed or said: an action more than a message. */
  const isNext = (message: ChatMessage) => message.text.trim() === 'Next';

  const trail = $derived(app.state.trail.slice(-TRAIL));
  const folded = $derived(Math.max(0, app.state.trail.length - TRAIL));

  // New messages, and the preparation's steps, scroll into view: only when they come (the state is
  // replaced on every update, the player's included), and at once (a smooth scroll stops halfway
  // when the first sentence read scrolls too)
  let seen = '';
  const toBottom = () =>
    // After the layout settles: the composer below changes height too (dictation → text box)
    requestAnimationFrame(() =>
      requestAnimationFrame(() => list?.scrollTo({ top: list.scrollHeight }))
    );
  $effect(() => {
    const isWorking = app.state.status === 'thinking' && !app.isPreparing;
    const key = `${app.state.messages.length}:${app.state.trail.length}:${isWorking}`;
    if (key === seen) return;
    seen = key;
    toBottom();
  });

  // At the bottom, the chat stays there when its height changes
  let isAtBottom = true;
  $effect(() => {
    if (!list) return;
    const element = list;
    const onScroll = () =>
      (isAtBottom = element.scrollHeight - element.scrollTop - element.clientHeight < 24);
    const observer = new ResizeObserver(() => {
      if (isAtBottom) element.scrollTop = element.scrollHeight;
    });
    observer.observe(element);
    element.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      observer.disconnect();
      element.removeEventListener('scroll', onScroll);
    };
  });

  // So does the sentence being read, once each, and only when it is out of sight: scrolling by hand
  // while it reads is left alone
  let followed = '';
  $effect(() => {
    const { messageId, sentence, isPlaying } = app.state.player;
    const key = `${messageId}-${sentence}`;
    if (!isPlaying || !messageId || key === followed) return;
    followed = key;
    const element = list?.querySelector(`[data-sentence="${key}"]`);
    if (!element || !list) return;
    const box = element.getBoundingClientRect();
    const view = list.getBoundingClientRect();
    if (box.top >= view.top && box.bottom <= view.bottom) return;
    element.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  });

  const handleKeydown = (event: KeyboardEvent, message: ChatMessage, index: number) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    void host.play(message.id, index);
  };
</script>

<!-- Kept on one line: whitespace between these tags would show as extra spaces in the sentence -->
<!-- prettier-ignore -->
{#snippet inline(text: string)}{#each text.split(/(`[^`]+`)/g) as piece, at (at)}{#if piece.length > 2 && piece.startsWith('`') && piece.endsWith('`')}{@const file = fileOf(piece.slice(1, -1))}{#if file}{@render chip(file)}{:else}<code class="rounded bg-muted px-1 font-mono text-[0.9em]">{piece.slice(1, -1)}</code>{/if}{:else}{piece.replace(/\*\*|__/g, '')}{/if}{/each}{/snippet}

<!-- prettier-ignore -->
{#snippet parts(sentence: Sentence)}{#each sentence.parts as part, at (at)}{#if part.type === 'text'}{@render inline(part.text)}{:else if part.type === 'cue' && part.cue.kind !== 'choice'}{@render chip(part.cue)}{/if}{/each}{/snippet}
<!-- prettier-ignore -->
{#snippet chip(cue: Cue)}<button class="mx-0.5 inline-flex items-center rounded border bg-muted px-1 align-baseline font-mono text-[11px] text-link hover:bg-accent" title={cueTitle(cue)} onclick={(event) => { event.stopPropagation(); void host.runCue(cue); }}>{cueLabel(cue)}</button>{/snippet}

{#snippet aside(icon: typeof Info, text: string)}
  {@const Icon = icon}
  <p class="my-2 flex items-start gap-1.5 text-xs text-muted-foreground">
    <Icon class="mt-px size-3 shrink-0" />
    <span class="min-w-0 [overflow-wrap:anywhere]">{text}</span>
  </p>
{/snippet}

<div
  bind:this={list}
  class="min-h-0 flex-1 overflow-y-auto px-3 py-2 text-sm"
  role="log"
  aria-label="Conversation"
>
  {#each app.state.messages as message (message.id)}
    {#if message.role === 'note'}
      {@render aside(Info, message.text)}
    {:else if message.isAuto}
      <!-- The kickoff can carry a long question: one line, the rest on click -->
      <button
        class={cn(
          'my-2 flex w-full items-start gap-1.5 text-left text-xs text-muted-foreground',
          !expanded.has(message.id) && '[&>span]:truncate'
        )}
        title={expanded.has(message.id) ? undefined : 'Show it all'}
        onclick={() => (expanded = new Set([...expanded, message.id]))}
      >
        <ArrowRight class="mt-px size-3 shrink-0" />
        <span class="min-w-0 [overflow-wrap:anywhere]">{message.text}</span>
      </button>
    {:else if message.role === 'user' && isNext(message)}
      {@render aside(ArrowRight, 'You: Next')}
    {:else}
      {@const isClaude = message.role === 'claude'}
      <article
        class={cn('my-3 border-l-2 pl-2.5', isClaude ? 'border-explained' : 'border-border')}
        aria-label={isClaude ? 'Claude' : 'You'}
      >
        <header class="mb-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span class={cn('font-semibold tracking-wide uppercase', isClaude && 'text-explained')}>
            {isClaude ? 'Claude' : 'You'}
          </span>
          {#if message.isDictated}<Mic class="size-3" aria-label="Dictated" />{/if}
          <time class="ml-auto tabular-nums" datetime={new Date(message.at).toISOString()}
            >{time(message.at)}</time
          >
        </header>
        {#if !isClaude}
          <p class="whitespace-pre-wrap [overflow-wrap:anywhere]">{message.text}</p>
        {:else}
          <div class="leading-relaxed [overflow-wrap:anywhere]">
            {#each message.sentences as sentence, index (index)}
              {#if isCode(sentence) && sentence.parts[0].type === 'code'}
                <pre class="my-1 overflow-x-auto rounded bg-muted p-2 font-mono text-xs"><code
                    >{sentence.parts[0].code}</code
                  ></pre>
              {:else if app.state.isSpeechOn}
                <span
                  role="button"
                  tabindex="0"
                  data-sentence="{message.id}-{index}"
                  title="Read from here"
                  class={cn(
                    // A chip's own hover, not the sentence's, when the pointer is on it
                    'cursor-pointer rounded px-0.5 transition-colors hover:not-has-[button:hover]:bg-accent',
                    isCurrent(message, index) &&
                      (app.state.player.isPlaying
                        ? 'bg-selection text-selection-foreground'
                        : 'underline decoration-dotted underline-offset-4')
                  )}
                  onclick={() => host.play(message.id, index)}
                  onkeydown={(event) => handleKeydown(event, message, index)}
                  ><!-- prettier-ignore -->{@render parts(sentence)}</span
                >{' '}
              {:else}
                <!-- Voice off: plain text, only the cues are links -->
                <span class="px-0.5">{@render parts(sentence)}</span>{' '}
              {/if}
            {/each}
          </div>
          {@const choices = choicesOf(message)}
          {#if choices.length && message === app.state.messages.at(-1)}
            <!-- What can come next: a click sends it as the person's reply -->
            <div class="mt-2 flex flex-wrap gap-1.5" aria-label="Replies">
              {#each choices as choice (choice)}
                <Button
                  variant="secondary"
                  size="xs"
                  icon={ArrowRight}
                  disabled={!app.canTalk || app.state.status !== 'ready'}
                  onclick={() => host.send(choice)}
                >
                  {choice}
                </Button>
              {/each}
            </div>
          {/if}
        {/if}
      </article>
    {/if}
  {/each}

  {#if app.state.status === 'thinking' && !app.isPreparing}
    <!-- Claude is on its turn: the reply comes here -->
    <div class="my-3 border-l-2 border-explained pl-2.5" role="status" aria-live="polite">
      <p class="mb-0.5 text-[11px] font-semibold tracking-wide text-explained uppercase">Claude</p>
      <p class="flex items-center gap-1.5 text-xs text-muted-foreground">
        <LoaderCircle class="size-3.5 shrink-0 animate-spin text-explained" />
        <span class="min-w-0 truncate">{app.state.activity ?? 'Thinking'}…</span>
      </p>
    </div>
  {/if}

  {#if app.isPreparing}
    <section class="my-3 rounded border p-3" aria-labelledby="preparing-title">
      <h2 id="preparing-title" class="flex items-center gap-2 font-semibold">
        <LoaderCircle class="size-4 shrink-0 animate-spin text-explained" />
        {PREPARING[app.kind].title}
      </h2>
      <p class="mt-1 text-xs text-muted-foreground">
        {PREPARING[app.kind].body} You can talk as soon as it is ready.
      </p>
      <ol class="mt-2 flex flex-col gap-0.5 text-xs" aria-live="polite">
        {#if folded}<li class="text-muted-foreground">… {folded} earlier steps</li>{/if}
        {#each trail as step, index (index)}
          {@const isLast = index === trail.length - 1}
          <li class={cn('flex items-center gap-1.5', !isLast && 'text-muted-foreground')}>
            {#if isLast}
              <LoaderCircle class="size-3 shrink-0 animate-spin" />
            {:else}
              <Check class="size-3 shrink-0 text-ok" />
            {/if}
            <span class="min-w-0 truncate">{step}</span>
          </li>
        {/each}
      </ol>
    </section>
  {:else if !app.state.messages.length}
    <p class="py-6 text-center text-xs text-muted-foreground">
      Claude's replies show here and are read aloud.
    </p>
  {/if}
</div>
