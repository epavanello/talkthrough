<script lang="ts">
  import { ArrowRight, Mic, SendHorizontal, Square, X } from '@lucide/svelte';
  import { app, shortcutOf } from '$lib/app.svelte';
  import { Button } from '$lib/components/ui/button';
  import { host } from '$lib/rpc';

  let text = $state('');
  const isRecording = $derived(app.state.isRecording);
  const isTranscribing = $derived(app.state.activity === 'Transcribing');
  const stepSize = $derived(app.state.step.length);
  const talkKey = shortcutOf('talkthrough.toggleMic');
  const nextKey = shortcutOf('talkthrough.next');

  /** Why the box can't take a message now, else what it is for. */
  const placeholder = $derived(
    app.isPreparing
      ? 'Claude is preparing the review: it is ready in a moment'
      : app.state.status === 'starting'
        ? 'Claude is starting…'
        : app.state.status === 'waiting'
          ? 'Claude is asking something: see above'
          : !app.isRunning
            ? 'Resume the review to talk with Claude'
            : 'Ask about the PR, or press Talk'
  );

  const handleSend = () => {
    const value = text.trim();
    if (!value) return;
    text = '';
    return host.send(value);
  };

  const handleKeydown = (event: KeyboardEvent) => {
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
    event.preventDefault();
    void handleSend();
  };
</script>

<div class="flex flex-col gap-1.5 border-t p-2">
  {#if isRecording || isTranscribing}
    <!-- Dictation goes to Claude's own prompt: what it hears shows here, nothing to type -->
    <div
      class="flex min-h-14 items-start gap-2 rounded border border-destructive/60 bg-input-background px-2 py-1.5 text-sm"
      aria-live="polite"
    >
      <Mic class="mt-0.5 size-4 shrink-0 animate-pulse text-destructive" />
      {#if app.state.draft}
        <p class="min-w-0 flex-1">{app.state.draft}</p>
      {:else}
        <p class="min-w-0 flex-1 text-muted-foreground">
          {isTranscribing ? 'Transcribing…' : 'Listening… talk, then press Send.'}
        </p>
      {/if}
    </div>
    <div class="flex gap-1.5">
      <Button
        variant="secondary"
        size="sm"
        icon={X}
        hint="Stop listening and send nothing"
        onclick={() => host.cancelMic()}
      >
        Cancel
      </Button>
      <Button
        class="flex-1"
        size="sm"
        icon={SendHorizontal}
        hint={{ body: 'Stop listening and send what was said.', note: talkKey }}
        disabled={!isRecording}
        onclick={() => host.toggleMic()}
      >
        Send
      </Button>
    </div>
  {:else}
    <textarea
      bind:value={text}
      rows="2"
      aria-label="Message to Claude"
      {placeholder}
      class="w-full resize-none rounded border border-input bg-input-background px-2 py-1.5 text-sm outline-none focus:border-ring disabled:opacity-60"
      disabled={!app.canTalk}
      onkeydown={handleKeydown}></textarea>
    <div class="flex flex-wrap items-center gap-1.5">
      <Button
        variant="secondary"
        size="sm"
        icon={Mic}
        hint={{
          title: 'Talk',
          body: "Claude Code's own dictation, in the review session: talk, then press Send.",
          note: talkKey
        }}
        disabled={!app.canTalk}
        onclick={() => host.toggleMic()}
      >
        Talk
      </Button>
      {#if text.trim()}
        <Button variant="ghost" size="sm" icon={SendHorizontal} onclick={handleSend}>Send</Button>
      {/if}
      {#if app.state.status === 'thinking' && !app.isPreparing}
        <Button
          variant="ghost"
          size="sm"
          icon={Square}
          hint="Stop Claude's turn"
          onclick={() => host.interrupt()}
        >
          Stop
        </Button>
      {/if}
      <Button
        class="ml-auto"
        size="sm"
        icon={ArrowRight}
        iconAtEnd
        hint={{
          title: 'Next',
          body: stepSize
            ? `The ${stepSize} hunks explained in this step are clear: mark them ok and go on.`
            : 'Go on with the next block.',
          note: nextKey
        }}
        disabled={!app.canTalk}
        onclick={() => host.next()}
      >
        Next{stepSize ? ` · ${stepSize} ok` : ''}
      </Button>
    </div>
  {/if}
</div>
