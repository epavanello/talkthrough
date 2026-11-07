/**
 * Checks the browser panel's plumbing against the real agent-browser, outside VS Code: a small page
 * on a local server, opened, read, acted on and marked; a screenshot; frames from the live stream.
 *
 *   pnpm browser-check [agent-browser]    (default: the one the .vsix carries for this platform)
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { keyInput } from '@talkthrough/shared';
import { Browser } from '../src/browser';
import { run } from '../src/proc';
import { hasChrome } from '../src/requirements';
// @ts-expect-error: a plain script, shared with packaging
import { hostTarget, vendor } from './agent-browser.mjs';

/** A JPEG's width in pixels, from its frame header. */
const jpegWidth = (data: Buffer) => {
  for (let at = 2; at < data.length - 9; at += 2 + data.readUInt16BE(at + 2)) {
    if (data[at] !== 0xff) return 0;
    if (data[at + 1] >= 0xc0 && data[at + 1] <= 0xc2) return data.readUInt16BE(at + 7);
  }
  return 0;
};

const until = async (isDone: () => boolean, problem: string) => {
  for (let tries = 0; !isDone(); tries++) {
    if (tries > 80) throw new Error(problem);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
};

const PAGE = `<!doctype html><html><head><title>Reschedule</title></head>
<body style="font-family:sans-serif;padding:24px"><h1>Reschedule</h1>
<label>Email <input name="email"></label>
<button id="confirm" onclick="document.title='Confirmed'">Confirm reschedule</button>
<button id="edge" style="position:absolute;right:0;top:140px">Download</button>
<span id="top" style="position:absolute;left:300px;top:0">Signed in</span>
<div style="height:1600px"></div><a href="/other">Further down</a></body></html>`;

const server = createServer((_, res) =>
  res.writeHead(200, { 'Content-Type': 'text/html' }).end(PAGE)
);
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
const storage = mkdtempSync(path.join(tmpdir(), 'talkthrough-browser-'));
const bin = process.argv[2] ?? vendor(path.resolve('.cache', 'agent-browser'), hostTarget());
const browser = new Browser({ bin: bin ?? 'agent-browser', key: storage, storage });
const checks: [string, boolean][] = [];
const check = (label: string, isOk: boolean) => {
  checks.push([label, isOk]);
  console.log(`  ${isOk ? '✓' : '✗'} ${label}`);
};

try {
  check('agent-browser installed', Boolean(await browser.version()));
  const doctor = await run(bin ?? 'agent-browser', ['doctor', '--offline', '--quick', '--json'], {
    allowFailure: true
  });
  check(
    'its doctor finds Chrome',
    /"chrome\.installed"/.test(doctor.stdout) && hasChrome(doctor.stdout)
  );
  const page = await browser.open(url);
  check('open answers the title', page?.title === 'Reschedule');
  const snapshot = await browser.snapshot();
  const button = snapshot.match(/button "Confirm reschedule" \[ref=(e\d+)\]/)?.[1];
  check('the snapshot has refs', Boolean(button));
  const mark = await browser.mark(`@${button}`, 'Changed: the reschedule guard', 'change');
  const drawn = await browser.evaluate(
    `document.querySelectorAll('#__talkthrough_marks [data-mark]').length`
  );
  check('a mark is drawn on the page', mark.id === 'm1' && drawn === 1);
  // Its element as a selector that outlives the @ref, for the reply to keep
  check(
    'a mark finds a stable selector for its element',
    Boolean(mark.selector) &&
      (await browser.evaluate(
        `document.querySelector(${JSON.stringify(mark.selector)})?.id === 'confirm'`
      )) === true
  );
  const again = await browser.mark(mark.selector!, 'Changed: the reschedule guard', 'change');
  check(
    'the selector draws it again as the same mark',
    again.id === 'm1' &&
      (await browser.evaluate(
        `document.querySelectorAll('#__talkthrough_marks [data-mark]').length`
      )) === 1
  );
  await browser.mark('input[name=email]', 'Type the email', 'action');
  check(
    'marks are numbered and listed',
    browser.currentMarks.map((one) => one.id).join() === 'm1,m2'
  );
  const label = await browser.evaluate(`document.querySelector('[data-mark=m1]').textContent`);
  check('its label is text, numbered', label === '1  Changed: the reschedule guard');
  // Labels go where there is room: by the right edge, toward the left; at the top, below
  await browser.mark('#edge', 'Export: it now needs the web.session.read permission', 'change');
  await browser.mark('#top', 'Who is signed in', 'note');
  const placed = (await browser.evaluate(`(() => {
    const rect = (id, part) => document.querySelector('[data-mark=' + id + ']' + part).getBoundingClientRect();
    const edge = rect('m3', ' div'), title = rect('m4', ' div'), box = rect('m4', '');
    return { inside: edge.left >= 0 && edge.right <= innerWidth, below: title.top >= box.bottom, scrolls: document.documentElement.scrollWidth > innerWidth };
  })()`)) as { inside: boolean; below: boolean; scrolls: boolean };
  check(
    'a label by the right edge stays in view, the page unscrolled',
    placed.inside && !placed.scrolls
  );
  check('a label with no room above goes below', placed.below);
  // A mark follows its element as the page moves, and goes with it (a client-side route change)
  const settle = () => new Promise((resolve) => setTimeout(resolve, 700));
  await browser.evaluate(`document.getElementById('edge').style.top = '300px'`);
  await settle();
  const followed = await browser.evaluate(`(() => {
    const box = document.querySelector('[data-mark=m3]').getBoundingClientRect();
    return Math.abs(box.top + 4 - document.getElementById('edge').getBoundingClientRect().top) < 3;
  })()`);
  check('a mark follows its element', followed === true);
  await browser.evaluate(`document.getElementById('edge').remove()`);
  await settle();
  await browser.refresh();
  check(
    'a mark goes with its element',
    (await browser.evaluate(`!document.querySelector('[data-mark=m3]')`)) === true &&
      !browser.currentMarks.some((one) => one.id === 'm3')
  );
  await browser.act('click', `@${button}`);
  check('act clicks, and the page is read again', browser.page?.title === 'Confirmed');
  await browser.act('fill', 'input[name=email]', 'ada@example.com');
  check(
    'act fills',
    (await browser.evaluate(`document.querySelector('input').value`)) === 'ada@example.com'
  );
  const image = await browser.screenshot();
  check(
    'a screenshot comes back as JPEG',
    Buffer.from(image, 'base64').subarray(0, 2).toString('hex') === 'ffd8'
  );
  await browser.clearMarks();
  check(
    'marks clear',
    (await browser.evaluate(`!document.getElementById('__talkthrough_marks')`)) === true
  );
  // The live view, as the panel drives it: frames at the pixel ratio, keys that edit
  const port = await browser.streamPort();
  const socket = new WebSocket(`ws://127.0.0.1:${port}/?pacing=ack&maxFps=10`);
  const frames: { width: number; pixels: number }[] = [];
  socket.onmessage = (event) => {
    const message = JSON.parse(String(event.data));
    if (message.type !== 'frame') return;
    frames.push({
      width: message.metadata.deviceWidth,
      pixels: jpegWidth(Buffer.from(message.data, 'base64'))
    });
    socket.send(JSON.stringify({ type: 'ack', seq: message.seq }));
  };
  await until(() => frames.length > 0, 'no frame in 8 s');
  check('the live stream sends frames', frames[0].width > 0);
  await browser.resize(800, 600, 2);
  await browser.act('scroll', undefined, 'down 10');
  await until(() => frames.some((one) => one.width === 800), 'no frame at 800 px');
  check(
    'frames come at the pixel ratio',
    frames.findLast((one) => one.width === 800)?.pixels === 1600
  );
  await browser.act('fill', 'input[name=email]', '');
  await browser.act('click', 'input[name=email]');
  const press = (key: string, code: string, keyCode: number, modifiers = 0) => {
    socket.send(JSON.stringify(keyInput({ key, code, keyCode, modifiers })));
    socket.send(JSON.stringify(keyInput({ key, code, keyCode, modifiers }, true)));
  };
  for (const letter of 'abc')
    press(letter, `Key${letter.toUpperCase()}`, letter.charCodeAt(0) - 32);
  press('ArrowLeft', 'ArrowLeft', 37);
  press('Backspace', 'Backspace', 8);
  await new Promise((resolve) => setTimeout(resolve, 400));
  const field = `document.querySelector('input[name=email]')`;
  check(
    'keys type, move the caret and delete',
    (await browser.evaluate(`${field}.value`)) === 'ac'
  );
  press('ArrowLeft', 'ArrowLeft', 37, 8);
  await new Promise((resolve) => setTimeout(resolve, 300));
  check('Shift+arrow selects', (await browser.selectedText()) === 'a');
  await browser.execCommand('selectAll');
  check('select all, and the selection read', (await browser.selectedText()) === 'ac');
  socket.close();
  await browser.open('http://127.0.0.1:9/').then(
    () => check('a server that is down is reported', false),
    (error: Error) =>
      check('a server that is down is reported', /Nothing answers|ERR_/.test(error.message))
  );
} catch (error) {
  check(`no error: ${(error as Error).message}`, false);
} finally {
  await browser.close();
  server.close();
  rmSync(storage, { recursive: true, force: true });
}
process.exit(checks.every(([, isOk]) => isOk) ? 0 : 1);
