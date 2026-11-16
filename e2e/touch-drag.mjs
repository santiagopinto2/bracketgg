// Finger drags on a phone's bottom sheet, for e2e/api-calls.mjs and e2e/attendees.mjs.

// One finger down at `from` ({ x, y } in the viewport), moved `by` px down the screen (up when
// negative) in `steps` moves 16 ms apart, then lifted. With `hold`, the finger rests that long (ms)
// before it lifts, so the release has no speed. `during` runs with the finger still down, and what it
// returns comes back. The touches go through Chromium's own input (CDP), so a move the page doesn't
// stop scrolls it the way a finger would.
export async function touchDrag(page, from, by, { steps = 12, hold = 0, during = null } = {}) {
    const cdp = await page.context().newCDPSession(page);
    const at = y => [{ x: Math.round(from.x), y: Math.round(y) }];
    let seen;
    try {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: at(from.y) });
        for (let i = 1; i <= steps; i++) {
            await page.waitForTimeout(16);
            await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: at(from.y + by * i / steps) });
        }
        if (during) seen = await during();
        if (hold) await page.waitForTimeout(hold);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } finally {
        await cdp.detach().catch(() => { });
    }
    return seen;
}

// The same drag as touch events made in the page, for a browser without CDP (WebKit). Nothing scrolls
// by itself there, so it only shows what the page's own handlers do. Playwright's WebKit can't
// construct a Touch, so each event is a plain Event that carries the finger in `touches`. Returns
// whether each move was stopped (preventDefault).
export function scriptedDrag(page, from, by, { steps = 12, hold = 0 } = {}) {
    return page.evaluate(async ({ from, by, steps, hold }) => {
        const target = document.elementFromPoint(from.x, from.y);
        const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
        const fire = (type, y) => {
            const touch = { identifier: 1, target, clientX: from.x, clientY: y, pageX: from.x, pageY: y };
            const down = type === 'touchend' ? [] : [touch];
            const event = new Event(type, { bubbles: true, cancelable: true, composed: true });
            Object.defineProperties(event, { touches: { value: down }, targetTouches: { value: down }, changedTouches: { value: [touch] } });
            return !target.dispatchEvent(event);
        };
        const stopped = [];
        fire('touchstart', from.y);
        for (let i = 1; i <= steps; i++) {
            await wait(16);
            stopped.push(fire('touchmove', from.y + by * i / steps));
        }
        if (hold) await wait(hold);
        fire('touchend', from.y + by);
        return stopped;
    }, { from, by, steps, hold });
}

// Records, from here on, whether each touchmove on the page was stopped (preventDefault): a move that
// isn't is the browser's to scroll or pull to refresh with. `window.__touchMoves` holds them.
export const watchTouchMoves = page => page.evaluate(() => {
    window.__touchMoves = [];
    window.addEventListener('touchmove', event => window.__touchMoves.push(event.defaultPrevented));
});
export const touchMoves = page => page.evaluate(() => window.__touchMoves.splice(0));

// Where everything outside the dialog is scrolled to: the window, and every element that has scrolled
export const scrollBehind = page => page.evaluate(() => JSON.stringify([Math.round(scrollX), Math.round(scrollY),
    ...[...document.querySelectorAll('body *')].filter(el => !el.closest('.cdk-overlay-container') && (el.scrollTop || el.scrollLeft)).map(el => [el.tagName, Math.round(el.scrollLeft), Math.round(el.scrollTop)])]));

// The sheet's panel: where its top is, how tall it is, and the transform a drag has left on it
export const sheetPane = page => page.evaluate(() => {
    const pane = document.querySelector('.cdk-overlay-pane:has(mat-dialog-container)');
    if (!pane) return null;
    const box = pane.getBoundingClientRect();
    return { top: Math.round(box.top), height: Math.round(box.height), transform: pane.style.transform };
});
