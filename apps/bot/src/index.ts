// The StarWonder town-crier: a thin, stateless daemon that (1) keeps an IRC presence in
// the game channel and (2) polls POST /api/bot/tick on a heartbeat. Each tick the SERVER
// settles all open dock sessions and hands back fresh events as ready-made third-person
// blurbs — this process holds no database and no game logic. Switch it off and the game
// degrades gracefully to settle-on-check-in (idle-narrative.md §5).
//
// State: a single cursor (last announced events.id), persisted to a JSON file so restarts
// don't replay history. A missing cursor asks the server for "now" instead of the past.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { IrcClient } from './irc';

const env = (k: string, d: string): string => process.env[k] ?? d;

const API_URL = env('API_URL', 'http://localhost:8080');
const BOT_TOKEN = env('BOT_TOKEN', 'dev-bot-token-change-me');
const POLL_SECONDS = Number(env('POLL_SECONDS', '90'));
const CURSOR_FILE = env('CURSOR_FILE', './data/bot-cursor.json');

const irc = new IrcClient({
  server: env('IRC_SERVER', 'irc.afternet.org'),
  port: Number(env('IRC_PORT', '6667')),
  tls: env('IRC_TLS', 'false') === 'true',
  nick: env('IRC_NICK', 'StarWonder'),
  channel: env('IRC_CHANNEL', '#starwonder'),
  realname: 'StarWonder town crier — https://github.com/srvx/StarWonder',
});

function loadCursor(): number | undefined {
  try {
    return (JSON.parse(readFileSync(CURSOR_FILE, 'utf8')) as { cursor: number }).cursor;
  } catch {
    return undefined; // first run: the server hands back "now" so we never replay history
  }
}

function saveCursor(cursor: number): void {
  mkdirSync(dirname(CURSOR_FILE), { recursive: true });
  writeFileSync(CURSOR_FILE, JSON.stringify({ cursor }));
}

let cursor = loadCursor();

interface TickResponse {
  cursor: number;
  events: { id: number; at: number; blurb: string }[];
}

async function tick(): Promise<void> {
  try {
    const res = await fetch(`${API_URL}/api/bot/tick`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${BOT_TOKEN}`,
      },
      body: JSON.stringify(cursor === undefined ? {} : { after: cursor }),
    });
    if (!res.ok) {
      console.error(`[tick] server said ${res.status}`);
      return;
    }
    const data = (await res.json()) as TickResponse;
    for (const e of data.events) irc.say(e.blurb);
    if (data.events.length) console.log(`[tick] announced ${data.events.length} event(s)`);
    if (data.cursor !== cursor) {
      cursor = data.cursor;
      saveCursor(cursor);
    }
  } catch (e) {
    console.error('[tick] failed:', (e as Error).message);
  }
}

console.log(`[bot] api=${API_URL} poll=${POLL_SECONDS}s cursor=${cursor ?? '(fresh)'}`);
irc.connect();
void tick();
setInterval(() => void tick(), POLL_SECONDS * 1000);
