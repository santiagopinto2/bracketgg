// Keeps the app under start.gg's limit of 80 requests per 60 seconds per token.
// Requests wait in a queue: at most `maxInFlight` run at once, at most `maxPerWindow`
// start in any `windowMs`, and nothing starts while the gate is paused after a rate limit.
//
// Background requests (phase-prefetch.ts) wait in a queue of their own and start only when no other
// request is waiting, at most `maxBackgroundInFlight` at once, and only while fewer than
// `maxPerWindow - foregroundReserve` requests started in the window, so what the visitor asked for
// never waits behind them.
export class RequestGate {
    private queue: (() => void)[] = [];
    private backgroundQueue: (() => void)[] = [];
    private inFlight = 0;
    private backgroundInFlight = 0;
    private starts: number[] = [];
    private pausedUntil = 0;
    private timer: ReturnType<typeof setTimeout> | null = null;

    constructor(
        private maxInFlight = 4,
        private maxPerWindow = 70,
        private windowMs = 60_000,
        private now: () => number = Date.now,
        private maxBackgroundInFlight = 2,
        private foregroundReserve = 20
    ) { }

    run<T>(task: () => Promise<T>, background = false): Promise<T> {
        return new Promise<T>((resolve, reject) => {
            (background ? this.backgroundQueue : this.queue).push(() => {
                task().then(resolve, reject).finally(() => {
                    this.inFlight--;
                    if (background) this.backgroundInFlight--;
                    this.pump();
                });
            });
            this.pump();
        });
    }

    // Stop starting requests for `ms`. A longer pause wins over a shorter one.
    pause(ms: number) {
        this.pausedUntil = Math.max(this.pausedUntil, this.now() + ms);
        this.pump();
    }

    get waiting() {
        return this.queue.length + this.backgroundQueue.length;
    }

    private pump() {
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
        for (; ;) {
            // The visitor's own requests first; the background's only when none is waiting
            const background = !this.queue.length;
            const queue = background ? this.backgroundQueue : this.queue;
            if (!queue.length || this.inFlight >= this.maxInFlight) return;
            if (background && this.backgroundInFlight >= this.maxBackgroundInFlight) return;
            const now = this.now();
            this.starts = this.starts.filter(t => t > now - this.windowMs);
            const limit = background ? Math.max(1, this.maxPerWindow - this.foregroundReserve) : this.maxPerWindow;
            let waitMs = this.pausedUntil - now;
            if (this.starts.length >= limit) waitMs = Math.max(waitMs, this.starts[this.starts.length - limit] + this.windowMs - now);
            if (waitMs > 0) {
                this.timer = setTimeout(() => this.pump(), waitMs);
                return;
            }
            this.starts.push(now);
            this.inFlight++;
            if (background) this.backgroundInFlight++;
            queue.shift()!();
        }
    }
}
