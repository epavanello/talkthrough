<script lang="ts">
  import {
    ArrowRightToLine,
    LoaderCircle,
    Pause,
    Play,
    RotateCcw,
    SkipBack,
    SkipForward,
    Volume2,
    VolumeX
  } from '@lucide/svelte';
  import { app, shortcutOf } from '$lib/app.svelte';
  import { Button } from '$lib/components/ui/button';
  import { host } from '$lib/rpc';
  import { cn } from '$lib/utils';

  const player = $derived(app.state.player);
  const message = $derived(app.state.messages.find((one) => one.id === player.messageId));
  const hasClaude = $derived(app.state.messages.some((one) => one.role === 'claude'));
  /** Reading needs the voice: off, the controls stay but are greyed out. */
  const canRead = $derived(app.state.isSpeechOn);
  const canControl = $derived(Boolean(message) && canRead);
  const isLast = $derived(!message || player.sentence >= message.sentences.length - 1);
  /** The whole reply was read: Play starts it again. */
  const isOver = $derived(isLast && app.progress >= 1 && !player.isPlaying);
  /** The voice stops at the end of this sentence: a mark there on the bar. */
  const stops = $derived(player.isSentenceBySentence && !isLast);
</script>

<div class="flex items-center gap-0.5 border-t px-2 py-1">
  <Button
    variant="ghost"
    size="icon-xs"
    icon={SkipBack}
    hint={app.progress > 0
      ? 'The start of this sentence (again: the previous one)'
      : 'The previous sentence'}
    disabled={!canControl || (player.sentence === 0 && app.progress <= 0)}
    onclick={() => host.seek(-1)}
  />
  <Button
    variant="ghost"
    size="icon-xs"
    icon={player.isPlaying ? Pause : Play}
    hint={{
      body: player.isPlaying
        ? 'Pause: Play goes on from here'
        : isOver
          ? 'Read this reply again'
          : 'Go on from where it stopped',
      note: shortcutOf('talkthrough.pauseResume')
    }}
    disabled={!canControl}
    onclick={() => host.pauseResume()}
  />
  <Button
    variant="ghost"
    size="icon-xs"
    icon={SkipForward}
    hint={isLast ? 'This is the last sentence' : 'The next sentence'}
    disabled={!canControl || isLast}
    onclick={() => host.seek(1)}
  />
  <Button
    variant="ghost"
    size="icon-xs"
    icon={ArrowRightToLine}
    class={cn(player.isSentenceBySentence && 'bg-accent text-link')}
    aria-pressed={player.isSentenceBySentence}
    hint={{
      title: player.isSentenceBySentence ? 'One sentence at a time: on' : 'One sentence at a time',
      body: player.isSentenceBySentence
        ? 'Every play stops at the end of its sentence. Click to read on without stopping.'
        : 'Every play stops at the end of its sentence, so you can look at the code; Play reads the next one.'
    }}
    disabled={!canRead}
    onclick={() => host.setSentenceBySentence(!player.isSentenceBySentence)}
  />
  {#if canControl && message}
    <div class="ml-1.5 flex min-w-0 flex-1 items-center gap-1.5">
      <span class="shrink-0 text-xs tabular-nums text-muted-foreground" title="Sentence">
        {player.sentence + 1}/{message.sentences.length}
      </span>
      <!-- How far the voice is through this sentence, word by word; a pause holds it, and a stop at
           its end shows as a mark there -->
      <div
        class={cn(
          'h-1.5 min-w-6 max-w-40 flex-1 overflow-hidden rounded-full border border-input bg-muted-foreground/20',
          stops && 'border-r-2 border-r-link'
        )}
        role="progressbar"
        aria-label="This sentence"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(app.progress * 100)}
      >
        <div
          class={cn(
            'h-full rounded-full transition-[width] duration-300 ease-linear',
            player.isPlaying ? 'bg-link' : 'bg-muted-foreground'
          )}
          style:width="{app.progress * 100}%"
        ></div>
      </div>
      {#if player.isPlaying && player.isWaiting}
        <LoaderCircle
          class="size-3 shrink-0 animate-spin text-muted-foreground"
          aria-label="The voice is starting"
        />
      {/if}
    </div>
  {/if}
  <div class="ml-auto flex items-center gap-0.5">
    <Button
      variant="ghost"
      size="icon-xs"
      icon={RotateCcw}
      hint={{
        body: "Read Claude's last reply from the start",
        note: shortcutOf('talkthrough.replay')
      }}
      disabled={!hasClaude || !canRead}
      onclick={() => host.replayLast()}
    />
    <Button
      variant="ghost"
      size="icon-xs"
      icon={app.state.isSpeechOn ? Volume2 : VolumeX}
      aria-pressed={app.state.isSpeechOn}
      hint={app.state.isSpeechOn
        ? 'Voice on: replies are read aloud. Click to only read them'
        : 'Voice off: replies are only written. Click to hear them'}
      onclick={() => host.setSpeech(!app.state.isSpeechOn)}
    />
  </div>
</div>
