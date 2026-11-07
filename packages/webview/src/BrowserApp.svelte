<script lang="ts">
  import { ArrowLeft, ArrowRight, Eraser, Globe, LoaderCircle, RotateCw } from '@lucide/svelte';
  import {
    keyInput,
    macKeys,
    type BrowserEdit,
    type BrowserInput,
    type BrowserMark,
    type BrowserPage
  } from '@talkthrough/shared';
  import { onMount } from 'svelte';
  import { Button } from '$lib/components/ui/button';
  import * as Tooltip from '$lib/components/ui/tooltip';
  import { browserHost as browser, onHostEvent } from '$lib/rpc';
  import { cn } from '$lib/utils';

  /** The kinds of marks, as the page draws them. */
  const KINDS: Record<BrowserMark['kind'], { color: string; label: string }> = {
    change: { color: '#2f81f7', label: 'Changed by this PR' },
    action: { color: '#1a7f37', label: 'What to do' },
    note: { color: '#bf8700', label: 'A note' }
  };

  let page = $state<BrowserPage | null>(null);
  let marks = $state<BrowserMark[]>([]);
  let isLive = $state(false);
  let hasFrame = $state(false);
  let address = $state('');
  let addressInput = $state<HTMLInputElement | null>(null);
  let isEditing = $state(false);
  let activity = $state<string | null>(null);
  /** Why the last address typed didn't open. */
  let problem = $state<string | null>(null);
  let isLoading = $state(false);
  let canvas = $state<HTMLCanvasElement | null>(null);
  let stage = $state<HTMLDivElement | null>(null);
  /** Takes the person's keys, pastes and composed letters for the page (a canvas gets none of them). */
  let keys = $state<HTMLTextAreaElement | null>(null);
  let isFocused = $state(false);
  /** The viewport the frames show, in CSS pixels of the page. */
  let viewport = { width: 0, height: 0 };
  let activityTimer: ReturnType<typeof setTimeout> | undefined;

  const show = (view: { page: BrowserPage | null; marks: BrowserMark[] }) => {
    page = view.page;
    marks = view.marks;
    if (!isEditing) address = view.page?.url ?? '';
  };

  /** A frame: its pixels as they come (the page's pixel ratio), the viewport in CSS pixels. */
  const draw = (data: string, width: number, height: number) => {
    const image = new Image();
    image.onload = () => {
      if (!canvas) return;
      const { naturalWidth, naturalHeight } = image;
      if (canvas.width !== naturalWidth || canvas.height !== naturalHeight) {
        canvas.width = naturalWidth;
        canvas.height = naturalHeight;
      }
      canvas.getContext('2d')?.drawImage(image, 0, 0);
      viewport = { width, height };
      hasFrame = true;
    };
    image.src = `data:image/jpeg;base64,${data}`;
  };

  onMount(() => {
    const unsubscribe = onHostEvent((event) => {
      if (event.event === 'frame') draw(event.data, event.width, event.height);
      else if (event.event === 'browser') {
        show(event);
        isLive = event.isLive;
      } else if (event.event === 'activity') {
        activity = event.text;
        clearTimeout(activityTimer);
        activityTimer = setTimeout(() => (activity = null), 3500);
      }
    });
    // No page yet: the address bar takes the first one
    void browser.connect().then((view) => {
      show(view);
      if (!view.page) addressInput?.focus();
    });
    // The page's viewport follows the panel's size, a moment after it settles
    let resizeTimer: ReturnType<typeof setTimeout> | undefined;
    const observer = new ResizeObserver(([entry]) => {
      clearTimeout(resizeTimer);
      const { width, height } = entry.contentRect;
      resizeTimer = setTimeout(() => {
        if (page && width > 200 && height > 150)
          void browser.resize(width, height, window.devicePixelRatio || 1).catch(() => {});
      }, 400);
    });
    if (stage) observer.observe(stage);
    return () => {
      unsubscribe();
      observer.disconnect();
    };
  });

  const navigate = async (event: SubmitEvent) => {
    event.preventDefault();
    const url = address.trim();
    if (!url) return;
    isEditing = false;
    isLoading = true;
    problem = null;
    try {
      await browser.navigate(url);
    } catch (error) {
      problem = (error as Error).message;
    } finally {
      isLoading = false;
    }
  };

  // ---- the person's mouse and keys, on the page

  /** Where a pointer event lands on the page, the canvas drawn with object-fit: contain. */
  const pointOf = (event: MouseEvent) => {
    const box = canvas!.getBoundingClientRect();
    const scale = Math.min(box.width / viewport.width, box.height / viewport.height) || 1;
    const left = (box.width - viewport.width * scale) / 2;
    const top = (box.height - viewport.height * scale) / 2;
    return {
      x: Math.round((event.clientX - box.left - left) / scale),
      y: Math.round((event.clientY - box.top - top) / scale)
    };
  };

  const modifiersOf = (event: MouseEvent | KeyboardEvent) =>
    (event.altKey ? 1 : 0) |
    (event.ctrlKey ? 2 : 0) |
    (event.metaKey ? 4 : 0) |
    (event.shiftKey ? 8 : 0);

  const BUTTONS = ['left', 'middle', 'right'] as const;
  const send = (input: BrowserInput) => void browser.input(input).catch(() => {});

  const handleMouse = (event: MouseEvent, eventType: 'mousePressed' | 'mouseReleased') => {
    if (!hasFrame) return;
    if (eventType === 'mousePressed') {
      // The keys go to the page from here on
      event.preventDefault();
      keys?.focus();
    }
    send({
      type: 'input_mouse',
      eventType,
      ...pointOf(event),
      button: BUTTONS[event.button] ?? 'left',
      clickCount: event.detail || 1,
      modifiers: modifiersOf(event)
    });
  };

  let lastMove = 0;
  const handleMove = (event: MouseEvent) => {
    const now = performance.now();
    if (!hasFrame || now - lastMove < 40) return;
    lastMove = now;
    send({
      type: 'input_mouse',
      eventType: 'mouseMoved',
      ...pointOf(event),
      button: event.buttons ? 'left' : 'none'
    });
  };

  const handleWheel = (event: WheelEvent) => {
    if (!hasFrame) return;
    event.preventDefault();
    send({
      type: 'input_mouse',
      eventType: 'mouseWheel',
      ...pointOf(event),
      deltaX: event.deltaX,
      deltaY: event.deltaY
    });
  };

  const isMac = navigator.platform.toUpperCase().includes('MAC');

  /** ⌘ shortcuts (Ctrl elsewhere) that edit: Chrome on macOS doesn't act on them as keys. */
  const editOf = (event: KeyboardEvent): BrowserEdit | null => {
    if (!(isMac ? event.metaKey : event.ctrlKey) || event.altKey) return null;
    const key = event.key.toLowerCase();
    if (key === 'a') return 'selectAll';
    if (key === 'c') return 'copy';
    if (key === 'x') return 'cut';
    if (key === 'z') return event.shiftKey ? 'redo' : 'undo';
    if (key === 'y' && !isMac) return 'redo';
    return null;
  };

  const press = (event: KeyboardEvent) => ({
    key: event.key,
    code: event.code,
    keyCode: event.keyCode,
    modifiers: modifiersOf(event)
  });

  const handleKey = (event: KeyboardEvent, isUp: boolean) => {
    // A dead key or an input method composing: the text comes when it's done
    if (event.isComposing || event.key === 'Dead' || event.keyCode === 229) return;
    // ⌘V: VS Code pastes into the focused field, and the paste event carries the text
    if ((isMac ? event.metaKey : event.ctrlKey) && event.key.toLowerCase() === 'v') return;
    event.preventDefault();
    const edit = editOf(event);
    if (edit) {
      if (!isUp) void browser.edit(edit).catch(() => {});
      return;
    }
    for (const one of isMac ? macKeys(press(event)) : [press(event)]) send(keyInput(one, isUp));
  };

  const handlePaste = (event: ClipboardEvent) => {
    event.preventDefault();
    const text = event.clipboardData?.getData('text/plain');
    if (text) void browser.insertText(text);
  };

  const handleComposed = (event: CompositionEvent) => {
    if (event.data) void browser.insertText(event.data);
    if (keys) keys.value = '';
  };

  const pageHost = $derived(page ? page.url.replace(/^https?:\/\//, '').replace(/\/$/, '') : '');
</script>

<Tooltip.Provider delayDuration={500}>
  <div class="flex h-full flex-col">
    <form class="flex items-center gap-0.5 border-b px-2 py-1" onsubmit={navigate}>
      <Button
        variant="ghost"
        size="icon-xs"
        icon={ArrowLeft}
        hint="Back"
        disabled={!page}
        onclick={() => browser.go('back')}
      />
      <Button
        variant="ghost"
        size="icon-xs"
        icon={ArrowRight}
        hint="Forward"
        disabled={!page}
        onclick={() => browser.go('forward')}
      />
      <Button
        variant="ghost"
        size="icon-xs"
        icon={RotateCw}
        hint="Reload"
        disabled={!page}
        onclick={() => browser.go('reload')}
      />
      <label class="relative mx-1 min-w-0 flex-1">
        <span class="sr-only">Address</span>
        {#if isLoading}
          <LoaderCircle
            class="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 animate-spin text-muted-foreground"
          />
        {:else}
          <Globe
            class="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground"
          />
        {/if}
        <input
          bind:this={addressInput}
          bind:value={address}
          class="h-6 w-full rounded border border-input bg-input-background pr-2 pl-7 text-xs outline-none focus:border-ring"
          placeholder="The app's address"
          spellcheck="false"
          onfocus={() => (isEditing = true)}
          onblur={() => {
            isEditing = false;
            address = page?.url ?? address;
          }}
        />
      </label>
      <span
        class={cn(
          'flex shrink-0 items-center gap-1 px-1 text-[11px]',
          isLive ? 'text-ok' : 'text-muted-foreground'
        )}
        title={isLive
          ? 'Live: what Claude and you see is the same page'
          : 'Not connected to the browser'}
      >
        <span class={cn('size-1.5 rounded-full bg-current', isLive && 'animate-pulse')}></span>
        {isLive ? 'Live' : 'Off'}
      </span>
    </form>

    {#if marks.length}
      <div class="flex items-center gap-1 border-b px-2 py-1 text-xs">
        <ul
          class="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto"
          aria-label="Marks on the page"
        >
          {#each marks as mark, index (mark.id)}
            <li class="shrink-0">
              <button
                class="flex max-w-64 items-center gap-1.5 rounded border px-1.5 py-0.5 hover:bg-accent"
                title="{KINDS[mark.kind].label}: {mark.label}. Click to scroll to it"
                onclick={() => browser.showMark(mark.id)}
              >
                <span
                  class="flex size-4 shrink-0 items-center justify-center rounded text-[10px] font-semibold text-white"
                  style:background={KINDS[mark.kind].color}
                >
                  {index + 1}
                </span>
                <span class="truncate">{mark.label}</span>
              </button>
            </li>
          {/each}
        </ul>
        <Button
          class="shrink-0"
          variant="ghost"
          size="icon-xs"
          icon={Eraser}
          hint="Clear the marks"
          onclick={() => browser.clearMarks()}
        />
      </div>
    {/if}

    <div bind:this={stage} class="relative min-h-0 flex-1 overflow-hidden bg-muted">
      <!-- The page: frames of the browser's live view; clicks and keys go back to it -->
      <canvas
        bind:this={canvas}
        class={cn(
          'h-full w-full object-contain',
          !hasFrame && 'invisible',
          isFocused && 'outline outline-1 -outline-offset-1 outline-ring'
        )}
        aria-hidden="true"
        onmousedown={(event) => handleMouse(event, 'mousePressed')}
        onmouseup={(event) => handleMouse(event, 'mouseReleased')}
        onmousemove={handleMove}
        onwheel={handleWheel}
        oncontextmenu={(event) => event.preventDefault()}
      ></canvas>
      <textarea
        bind:this={keys}
        class="pointer-events-none absolute top-0 left-0 size-px resize-none opacity-0"
        aria-label={page
          ? `The page ${page.title || page.url}: type to use it, click it to focus`
          : 'The page'}
        autocomplete="off"
        spellcheck="false"
        tabindex={hasFrame ? 0 : -1}
        onfocus={() => (isFocused = true)}
        onblur={() => (isFocused = false)}
        onkeydown={(event) => handleKey(event, false)}
        onkeyup={(event) => handleKey(event, true)}
        onpaste={handlePaste}
        oncopy={(event) => event.preventDefault()}
        oncut={(event) => event.preventDefault()}
        oncompositionend={handleComposed}></textarea>
      {#if !page}
        <div
          class="absolute inset-0 flex flex-col items-center justify-center gap-2 p-6 text-center"
        >
          <Globe class="size-8 text-muted-foreground" />
          <p class="font-semibold">No page yet</p>
          <p class="max-w-80 text-xs text-muted-foreground">
            Claude opens the app here when seeing it helps, and marks what the PR changed. You can
            type an address above, and click and type in the page, to sign in say.
          </p>
        </div>
      {:else if !hasFrame}
        <div
          class="absolute inset-0 flex items-center justify-center gap-2 text-xs text-muted-foreground"
        >
          <LoaderCircle class="size-4 animate-spin" />
          Connecting to {pageHost}…
        </div>
      {/if}
      {#if problem}
        <p
          class="absolute top-2 right-2 left-2 rounded border border-destructive/50 bg-background px-2 py-1.5 text-xs [overflow-wrap:anywhere]"
          role="alert"
        >
          {problem}
        </p>
      {/if}
      {#if activity}
        <p
          class="absolute bottom-2 left-2 max-w-[80%] truncate rounded bg-background/90 px-2 py-1 text-xs shadow"
          role="status"
        >
          <span class="font-semibold text-explained">Claude</span> · {activity}
        </p>
      {/if}
    </div>
  </div>
</Tooltip.Provider>
