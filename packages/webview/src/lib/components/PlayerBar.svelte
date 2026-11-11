<script lang="ts">
  import { Pause, Play, RotateCcw, SkipBack, SkipForward, Volume2, VolumeX } from '@lucide/svelte';
  import { app, shortcutOf } from '$lib/app.svelte';
  import { Button } from '$lib/components/ui/button';
  import { host } from '$lib/rpc';
  import { cn } from '$lib/utils';

  const player = $derived(app.state.player);
  const message = $derived(app.state.messages.find((one) => one.id === player.messageId));
  const hasClaude = $derived(app.state.messages.some((one) => one.role === 'claude'));
  /** Reading needs the voice: off, the controls stay but are greyed out. */
  const canRead = $derived(app.state.isSpeechOn);
</script>

<div class="flex items-center gap-0.5 border-t px-2 py-1">
  <Button
    variant="ghost"
    size="icon-xs"
    icon={SkipBack}
    hint="The start of this sentence, then the previous one"
    disabled={!message || !canRead}
    onclick={() => host.seek(-1)}
  />
  <Button
    variant="ghost"
    size="icon-xs"
    icon={player.isPlaying ? Pause : Play}
    hint={{
      body: player.isPlaying ? 'Pause' : 'Go on from where it stopped',
      note: shortcutOf('talkthrough.pauseResume')
    }}
    disabled={!message || !canRead}
    onclick={() => host.pauseResume()}
  />
  <Button
    variant="ghost"
    size="icon-xs"
    icon={SkipForward}
    hint="Next sentence"
    disabled={!message || !canRead}
    onclick={() => host.seek(1)}
  />
  <Button
    variant="ghost"
    size="icon-xs"
    icon={RotateCcw}
    hint={{ body: "Replay Claude's last message", note: shortcutOf('talkthrough.replay') }}
    disabled={!hasClaude || !canRead}
    onclick={() => host.replayLast()}
  />
  {#if message && canRead}
    <div class="ml-1 flex min-w-0 flex-1 items-center gap-1.5">
      <span class="shrink-0 text-xs tabular-nums text-muted-foreground" title="Sentence">
        {player.sentence + 1}/{message.sentences.length}
      </span>
      <!-- How far the voice is through this sentence, word by word; a pause holds it -->
      <div
        class="h-1 min-w-6 max-w-40 flex-1 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-label="This sentence"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(player.progress * 100)}
      >
        <div
          class={cn(
            'h-full rounded-full transition-[width] duration-300 ease-linear',
            player.isPlaying ? 'bg-link' : 'bg-muted-foreground'
          )}
          style:width="{player.progress * 100}%"
        ></div>
      </div>
    </div>
  {/if}
  <Button
    class="ml-auto"
    variant="ghost"
    size="icon-xs"
    icon={app.state.isSpeechOn ? Volume2 : VolumeX}
    hint={app.state.isSpeechOn
      ? 'Voice on: replies are read aloud. Click to only read them'
      : 'Voice off: replies are only written. Click to hear them'}
    onclick={() => host.setSpeech(!app.state.isSpeechOn)}
  />
</div>
