/** Server-sent events: one stream per open tab, keyed by user. */
export class Realtime {
  constructor() {
    this.streams = new Map();
    this.timer = setInterval(() => {
      for (const set of this.streams.values()) for (const res of set) res.write(': ping\n\n');
    }, 25_000);
    this.timer.unref();
  }

  open(userId, req, res) {
    let set = this.streams.get(userId);
    if (!set) { set = new Set(); this.streams.set(userId, set); }
    if (set.size >= 6) { const oldest = set.values().next().value; oldest.end(); set.delete(oldest); }
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 4000\n\n');
    set.add(res);
    req.on('close', () => { set.delete(res); if (!set.size) this.streams.delete(userId); });
  }

  send(userId, event, data = {}) {
    const set = this.streams.get(userId);
    if (!set) return;
    const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of set) res.write(frame);
  }

  /** Close every stream for a user (sign-out everywhere, suspension, deletion). */
  drop(userId) {
    const set = this.streams.get(userId);
    if (!set) return;
    for (const res of set) res.end();
    this.streams.delete(userId);
  }

  stop() {
    clearInterval(this.timer);
    for (const set of this.streams.values()) for (const res of set) res.end();
    this.streams.clear();
  }
}
