// Keeps the app under start.gg's limit of 80 requests per 60 seconds per token.
// Requests wait in a queue: at most `maxInFlight` run at once, at most `maxPerWindow`
// start in any `windowMs`, and nothing starts while the gate is paused after a rate limit.
export class RequestGate {
    private queue: (() => void)[] = [];
    private inFlight = 0;
    private starts: number[] = [];
    private pausedUntil = 0;
    private timer: ReturnType<typeof setTimeout> | null = null;

    constructor(
        private maxInFlight = 4,
        private maxPerWindow = 70,
        private windowMs = 60_000,
        private now: () => number = Date.now
    ) { }

    run<T>(task: () => Promise<T>): Promise<T> {
        return new Promise<T>((resolve, reject) => {
            this.queue.push(() => {
                task().then(resolve, reject).finally(() => {
                    this.inFlight--;
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
        return this.queue.length;
    }

    private pump() {
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
        while (this.queue.length && this.inFlight < this.maxInFlight) {
            const now = this.now();
            this.starts = this.starts.filter(t => t > now - this.windowMs);
            let waitMs = this.pausedUntil - now;
            if (this.starts.length >= this.maxPerWindow) waitMs = Math.max(waitMs, this.starts[0] + this.windowMs - now);
            if (waitMs > 0) {
                this.timer = setTimeout(() => this.pump(), waitMs);
                return;
            }
            this.starts.push(now);
            this.inFlight++;
            this.queue.shift()!();
        }
    }
}
