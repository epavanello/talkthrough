<script lang="ts">
  import { app } from '$lib/app.svelte';
  import Composer from '$lib/components/Composer.svelte';
  import Header from '$lib/components/Header.svelte';
  import Home from '$lib/components/Home.svelte';
  import MapPanel from '$lib/components/MapPanel.svelte';
  import Messages from '$lib/components/Messages.svelte';
  import Notice from '$lib/components/Notice.svelte';
  import PlayerBar from '$lib/components/PlayerBar.svelte';
  import * as Tooltip from '$lib/components/ui/tooltip';
</script>

<Tooltip.Provider delayDuration={500}>
  <!-- A container: the side bar can be narrow, and controls fold by its width -->
  <div class="@container flex h-full flex-col">
    {#if app.state.status === 'idle'}
      <Home />
    {:else}
      <Header />
      <Notice />
      <MapPanel />
      <Messages />
      <PlayerBar />
      <Composer />
    {/if}
  </div>
</Tooltip.Provider>
