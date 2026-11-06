<script lang="ts">
  import { Pause, Play, RotateCcw, SkipBack, SkipForward, Volume2, VolumeX } from '@lucide/svelte';
  import { app, shortcutOf } from '$lib/app.svelte';
  import { Button } from '$lib/components/ui/button';
  import { host } from '$lib/rpc';

  const player = $derived(app.state.player);
  const message = $derived(app.state.messages.find((one) => one.id === player.messageId));
  const hasClaude = $derived(app.state.messages.some((one) => one.role === 'claude'));
</script>

<div class="flex items-center gap-0.5 border-t px-2 py-1">
  <Button
    variant="ghost"
    size="icon-xs"
    icon={SkipBack}
    hint="Previous sentence"
    disabled={!message}
    onclick={() => host.seek(-1)}
  />
  <Button
    variant="ghost"
    size="icon-xs"
    icon={player.isPlaying ? Pause : Play}
    hint={{
      body: player.isPlaying ? 'Pause' : 'Read from the current sentence',
      note: shortcutOf('talkthrough.pauseResume')
    }}
    disabled={!message}
    onclick={() => host.pauseResume()}
  />
  <Button
    variant="ghost"
    size="icon-xs"
    icon={SkipForward}
    hint="Next sentence"
    disabled={!message}
    onclick={() => host.seek(1)}
  />
  <Button
    variant="ghost"
    size="icon-xs"
    icon={RotateCcw}
    hint={{ body: "Replay Claude's last message", note: shortcutOf('talkthrough.replay') }}
    disabled={!hasClaude}
    onclick={() => host.replayLast()}
  />
  {#if message}
    <span class="ml-1 truncate text-xs tabular-nums text-muted-foreground">
      sentence {player.sentence + 1}/{message.sentences.length}
    </span>
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
