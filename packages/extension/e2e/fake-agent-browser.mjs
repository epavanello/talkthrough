#!/usr/bin/env node
/**
 * Plays agent-browser for the e2e tests: answers its commands with --json as the real CLI does, and
 * logs each one (FAKE_AGENT_BROWSER_LOG), keeping the page it is on beside the log.
 */
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2).filter((arg) => arg !== '--json');
const log = process.env.FAKE_AGENT_BROWSER_LOG;
const stateFile = `${log}.json`;
const page = existsSync(stateFile)
  ? JSON.parse(readFileSync(stateFile, 'utf8'))
  : { url: null, title: '' };
const answer = (data, error = null) =>
  console.log(JSON.stringify({ success: !error, data, error }));

if (args[0] === '--version') {
  console.log('agent-browser 0.0.0-fake');
  process.exit(0);
}
// One line per command: scripts (eval) span several
appendFileSync(log, `${args.join(' ').replace(/\s*\n\s*/g, ' ')}\n`);
switch (`${args[0]} ${args[1] ?? ''}`.trim()) {
  case `open ${args[1]}`:
    writeFileSync(stateFile, JSON.stringify({ url: args[1], title: 'Reschedule' }));
    answer({ url: args[1], title: 'Reschedule' });
    break;
  case 'get url':
    answer({ url: page.url });
    break;
  case 'get title':
    answer({ title: page.title });
    break;
  case 'get box':
    answer({ x: 20, y: 40, width: 160, height: 32 });
    break;
  case 'stream status':
    answer({ enabled: true, port: 9 });
    break;
  default:
    answer(
      args[0] === 'snapshot'
        ? { snapshot: '- button "Confirm reschedule" [ref=e2]' }
        : // A mark's script answers its element's selector, as the real page does
          { result: args[0] === 'eval' && args[1].includes('nth-of-type') ? '#confirm' : true }
    );
}
