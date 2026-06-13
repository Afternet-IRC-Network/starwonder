// A deliberately tiny IRC client — raw socket, no deps. Registers, answers PING, joins
// one channel, and sends throttled PRIVMSGs. Reconnects with backoff forever; the bot is
// stateless so a drop costs nothing (the cursor file survives restarts).

import net from 'node:net';
import tls from 'node:tls';

export interface IrcOpts {
  server: string;
  port: number;
  tls: boolean;
  nick: string;
  channel: string;
  realname: string;
}

export class IrcClient {
  private sock: net.Socket | null = null;
  private buf = '';
  private queue: string[] = [];
  private sendTimer: ReturnType<typeof setInterval> | null = null;
  private backoffMs = 5_000;
  private registered = false;

  constructor(private opts: IrcOpts) {}

  connect(): void {
    const { server, port } = this.opts;
    console.log(`[irc] connecting to ${server}:${port}${this.opts.tls ? ' (tls)' : ''}`);
    const sock = this.opts.tls
      ? tls.connect({ host: server, port, rejectUnauthorized: false })
      : net.connect({ host: server, port });
    this.sock = sock;
    this.registered = false;

    sock.setEncoding('utf8');
    sock.on(this.opts.tls ? 'secureConnect' : 'connect', () => {
      this.backoffMs = 5_000;
      this.raw(`NICK ${this.opts.nick}`);
      this.raw(`USER ${this.opts.nick} 0 * :${this.opts.realname}`);
    });
    sock.on('data', (chunk: string) => this.onData(chunk));
    const retry = () => {
      this.registered = false;
      this.sock = null;
      console.log(`[irc] disconnected — retrying in ${this.backoffMs / 1000}s`);
      setTimeout(() => this.connect(), this.backoffMs);
      this.backoffMs = Math.min(this.backoffMs * 2, 300_000);
    };
    sock.on('error', (e) => console.error('[irc] socket error:', e.message));
    sock.once('close', retry);

    // Throttle outbound channel messages (~1 per 2s) to stay clear of flood limits.
    if (!this.sendTimer) {
      this.sendTimer = setInterval(() => {
        if (!this.registered || !this.queue.length) return;
        const msg = this.queue.shift()!;
        this.raw(`PRIVMSG ${this.opts.channel} :${msg}`);
      }, 2_000);
    }
  }

  private onData(chunk: string): void {
    this.buf += chunk;
    let i: number;
    while ((i = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, i).replace(/\r$/, '');
      this.buf = this.buf.slice(i + 1);
      this.onLine(line);
    }
  }

  private onLine(line: string): void {
    if (line.startsWith('PING')) {
      this.raw(`PONG${line.slice(4)}`);
      return;
    }
    const parts = line.split(' ');
    const cmd = parts[1];
    if (cmd === '001') {
      console.log('[irc] registered — joining', this.opts.channel);
      this.registered = true;
      this.raw(`JOIN ${this.opts.channel}`);
    } else if (cmd === '433') {
      // nick in use — tack on a digit and retry
      const alt = `${this.opts.nick}${Math.floor(Math.random() * 100)}`;
      console.log(`[irc] nick in use, trying ${alt}`);
      this.raw(`NICK ${alt}`);
    } else if (cmd === 'KICK' && parts[2] === this.opts.channel) {
      setTimeout(() => this.raw(`JOIN ${this.opts.channel}`), 5_000);
    }
  }

  private raw(line: string): void {
    this.sock?.write(`${line}\r\n`);
  }

  /** Queue a channel announcement (throttled; silently dropped if the backlog is huge). */
  say(msg: string): void {
    if (this.queue.length >= 30) return; // a quiet galaxy should never hit this
    this.queue.push(msg.slice(0, 420)); // stay inside the 512-byte line limit
  }
}
