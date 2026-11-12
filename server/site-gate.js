// Keeps requests made with the site's own start.gg token (visitors who aren't logged in share it)
// under start.gg's limit of 80 requests per 60 seconds per token.
//
// At most `perWindow` requests start in any `windowMs`; the rest wait in line. A request that would
// wait longer than `maxWaitMs` is turned away at once with a SiteBusyError, which the server sends
// as 503 with Retry-After, so the page can say "busy, try again in a few seconds or log in".
// After start.gg answers 429, pause() stops every start for a while.

class SiteBusyError extends Error {
    constructor(retryAfterS) {
        super('BracketGG is busy. Try again in a few seconds, or log in with start.gg to skip the wait.');
        this.retryAfterS = retryAfterS;
    }
}

function createSiteGate({ perWindow = 70, windowMs = 60_000, maxWaitMs = 15_000, now = () => Date.now() } = {}) {
    let starts = []; // when each recent request started, oldest first
    const queue = []; // functions that start a waiting request
    let pausedUntil = 0;
    let timer = null;

    const prune = () => {
        const cutoff = now() - windowMs;
        while (starts.length && starts[0] <= cutoff) starts.shift();
    };

    // How long a request joining the line now would wait before it starts
    function waitFor(position) {
        prune();
        const t = now();
        // Plays the line forward: each request starts once the one `perWindow` places before it is a window old
        const times = [...starts];
        let at = Math.max(t, pausedUntil);
        for (let p = 0; p <= position; p++) {
            at = Math.max(t, pausedUntil, times.length >= perWindow ? times[times.length - perWindow] + windowMs : t);
            times.push(at);
        }
        return at - t;
    }

    function pump() {
        if (timer) { clearTimeout(timer); timer = null; }
        while (queue.length) {
            const wait = waitFor(0);
            if (wait > 0) {
                timer = setTimeout(pump, wait);
                timer.unref?.();
                return;
            }
            starts.push(now());
            queue.shift()();
        }
    }

    return {
        // Runs `task` when the gate allows, or throws SiteBusyError if that's too far off
        run(task) {
            const wait = waitFor(queue.length);
            if (wait > maxWaitMs) return Promise.reject(new SiteBusyError(Math.min(60, Math.ceil(wait / 1000))));
            return new Promise((resolve, reject) => {
                queue.push(() => { Promise.resolve().then(task).then(resolve, reject); });
                pump();
            });
        },
        pause(ms) {
            pausedUntil = Math.max(pausedUntil, now() + ms);
            pump();
        },
        stats: () => { prune(); return { recent: starts.length, waiting: queue.length, pausedForMs: Math.max(0, pausedUntil - now()) }; },
    };
}

module.exports = { createSiteGate, SiteBusyError };
