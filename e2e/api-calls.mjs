// Browser test of how the app talks to start.gg, against a fake start.gg.
// Counts the requests a bracket view costs, and checks rate-limit and error handling.
//
//   node e2e/api-calls.mjs <app url> [--report-only]
//
// The app must be served (STATIC_DIR=dist/bracketgg/browser node proxy-server.js). Needs the
// playwright package and Chromium (npm install --no-save playwright && npx playwright install chromium).
// Prints a JSON report. Without --report-only it exits 1 if a check fails.
import { chromium, webkit, devices } from 'playwright';
import { readFileSync } from 'node:fs';

const appUrl = process.argv[2] ?? 'http://localhost:4300';
const reportOnly = process.argv.includes('--report-only');
const eventPath = '/tournament/test-tourney/event/test-event/brackets';

const entrants = ['Alpha', 'Bravo', 'Charlie', 'Delta'].map((name, i) => ({
    id: i + 1, name, initialSeedNum: i + 1, participants: [{ gamerTag: name, user: null }]
}));

// A finished 4-player double elimination pool, in start.gg's ROUND order (losers first)
function poolSets(idBase) {
    const slot = (entrantId, score) => {
        const e = entrants[entrantId - 1];
        return { entrant: { id: e.id, name: e.name, initialSeedNum: e.initialSeedNum }, standing: { stats: { score: { value: score } } } };
    };
    return [
        { id: idBase + 5, round: -2, fullRoundText: 'Losers Final', winnerId: 2, slots: [slot(2, 2), slot(3, 1)] },
        { id: idBase + 4, round: -1, fullRoundText: 'Losers Round 1', winnerId: 3, slots: [slot(4, 0), slot(3, 2)] },
        { id: idBase + 1, round: 1, fullRoundText: 'Winners Semi-Final', winnerId: 1, slots: [slot(1, 2), slot(4, 0)] },
        { id: idBase + 2, round: 1, fullRoundText: 'Winners Semi-Final', winnerId: 2, slots: [slot(2, 2), slot(3, 1)] },
        { id: idBase + 3, round: 2, fullRoundText: 'Winners Final', winnerId: 1, slots: [slot(1, 2), slot(2, 0)] },
        { id: idBase + 6, round: 3, fullRoundText: 'Grand Final', winnerId: 1, slots: [slot(1, 3), slot(2, 1)] },
    ];
}

// A real pool that hasn't started (empty slots), where only the top 8 progress, with three guesses
// at what start.gg's GraphQL returns for it: every preview set, no bye sets, or no byes and no
// sets past the progression cut.
const unstarted = JSON.parse(readFileSync(new URL('./fixtures/unstarted-progressing-pool.json', import.meta.url))).sets;
const unstartedVariants = {
    all: unstarted,
    noByes: unstarted.filter(s => !s.bye),
    noByesNoUnreachable: unstarted.filter(s => !s.bye && !s.unreachable),
};
// A later-phase pool whose losers bracket starts with players from phase 1, seeded but not played
const laterPhase = JSON.parse(readFileSync(new URL('./fixtures/later-phase-pool.json', import.meta.url)));
const phaseGroupOf = { 1001: 2001, 1002: 2002, 1003: 2003, 1004: 2004 };
const setsOf = { 2001: poolSets(100), 2002: poolSets(200), 2003: unstartedVariants.noByes, 2004: laterPhase.sets };

function kindOf(query) {
    if (query.includes('tournament(slug')) return 'tournament';
    if (query.includes('entrants(query')) return 'entrants';
    if (query.includes('phase(id')) return 'phase';
    if (query.includes('phaseGroup(id')) return 'sets';
    return 'other';
}

function answer(query) {
    switch (kindOf(query)) {
        case 'tournament':
            return { data: { tournament: {
                images: [], rules: null, id: 1, name: 'Test Tourney', slug: 'tournament/test-tourney', venueAddress: null,
                startAt: 1794000000, primaryContact: null, primaryContactType: null,
                events: [{ name: 'Test Event', slug: 'tournament/test-tourney/event/test-event', numEntrants: entrants.length,
                    startAt: 1794000000, type: 1, videogame: { name: 'Test Game', images: [] }, standings: { nodes: [] } }]
            } } };
        case 'entrants':
            return { data: { event: { id: 10, name: 'Test Event', phases: [{ id: 1001, name: 'Pools' }, { id: 1002, name: 'Top 4' }, { id: 1003, name: 'Unstarted Pool' }, { id: 1004, name: 'Later Phase' }],
                entrants: { nodes: structuredClone(entrants) } } } };
        case 'phase': {
            const phaseId = Number(query.match(/phase\(id: (\d+)\)/)[1]);
            const groupId = phaseGroupOf[phaseId];
            return { data: { phase: { id: phaseId, phaseGroups: { pageInfo: { total: 1 }, nodes: [
                { id: groupId, displayIdentifier: 'A', sets: { pageInfo: { total: setsOf[groupId].length } } }] } } } };
        }
        case 'sets': {
            const groupId = Number(query.match(/phaseGroup\(id: (\d+)\)/)[1]);
            const page = Number(query.match(/page: (\d+)/)[1]);
            const perPage = Number(query.match(/perPage: (\d+)/)[1]);
            const nodes = structuredClone(setsOf[groupId]).slice((page - 1) * perPage, page * perPage)
                .map(({ bye, unreachable, ...set }) => set);
            return { data: { phaseGroup: { sets: { nodes } } } };
        }
        default:
            return { errors: [{ message: 'unknown query' }] };
    }
}

// Opens a page against the fake start.gg. `respond(query, n)` may return { status, body } to override
// the n-th request (counting from 1); otherwise the normal answer goes back.
async function openPage(browser, respond = () => null, contextOptions = {}) {
    const context = await browser.newContext(contextOptions);
    await context.addInitScript(() => {
        localStorage.setItem('oauth_access_token', 'test-token');
        localStorage.setItem('oauth_refresh_token', 'test-refresh');
        localStorage.setItem('oauth_token_expiry', String(Date.now() + 7 * 86400000));
    });
    const page = await context.newPage();
    const log = [];
    let pending = 0;
    let lastActivity = Date.now();
    await page.route(/fonts\.(googleapis|gstatic)\.com/, route => route.abort());
    await page.route('https://api.start.gg/gql/alpha', async route => {
        if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
        pending++;
        const query = route.request().postDataJSON().query;
        const n = log.length + 1;
        const override = respond(query, n);
        log.push({ n, at: Date.now(), kind: kindOf(query), status: override?.status ?? 200 });
        await new Promise(r => setTimeout(r, 50));
        await route.fulfill({ status: override?.status ?? 200, headers: { ...cors, 'content-type': 'application/json' },
            body: JSON.stringify(override?.body ?? answer(query)) });
        pending--;
        lastActivity = Date.now();
    });
    const quiet = async (ms = 1500, timeout = 120000) => {
        const start = Date.now();
        while (Date.now() - start < timeout) {
            if (pending === 0 && Date.now() - lastActivity > ms) return true;
            await page.waitForTimeout(200);
        }
        return false;
    };
    return { context, page, log, quiet };
}

const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, OPTIONS' };
const count = (log, from = 0) => {
    const out = { total: 0 };
    for (const r of log.slice(from)) { out.total++; out[r.kind] = (out[r.kind] ?? 0) + 1; }
    return out;
};
const snackText = page => page.locator('app-snack-bar').innerText().catch(() => '');
const spinnerShown = page => page.locator('app-snack-bar mat-spinner').isVisible().catch(() => false);
const tags = page => page.locator('.set-tag').allInnerTexts().catch(() => []);

const report = { app: appUrl, checks: [] };
const check = (name, ok, detail) => report.checks.push({ name, ok: !!ok, detail });
const browser = await chromium.launch();

try {
    // 1. Load a bracket, switch phase, switch back
    {
        const { context, page, log, quiet } = await openPage(browser);
        await page.goto(appUrl + eventPath + '/1001');
        await quiet();
        report.firstLoad = count(log);
        check('first load draws the bracket', (await tags(page)).includes('Alpha'), await tags(page));

        let mark = log.length;
        await page.locator('button:has(mat-icon[fonticon="arrow_forward"])').click();
        await quiet();
        report.phaseSwitch = count(log, mark);
        check('phase switch draws the second phase', (await page.locator('text=Top 4').count()) > 0 && (await tags(page)).includes('Alpha'), await tags(page));
        check('phase switch skips tournament and entrants', !report.phaseSwitch.tournament && !report.phaseSwitch.entrants, report.phaseSwitch);

        mark = log.length;
        await page.locator('button:has(mat-icon[fonticon="arrow_back"])').click();
        await quiet();
        report.phaseSwitchBack = count(log, mark);
        await context.close();
    }

    // 2. start.gg rate-limits the first 2 requests, then recovers
    {
        const limited = { status: 429, body: { success: false, message: 'Rate limit exceeded - api-token' } };
        const { context, page, log, quiet } = await openPage(browser, (q, n) => n <= 2 ? limited : null);
        const start = Date.now();
        await page.goto(appUrl + eventPath + '/1001');
        let sawNotice = false;
        while (Date.now() - start < 60000) {
            if ((await snackText(page)).includes('busy')) sawNotice = true;
            if ((await tags(page)).includes('Alpha')) break;
            await page.waitForTimeout(250);
        }
        await quiet();
        report.rateLimitRecovery = { requests: count(log), seconds: Math.round((Date.now() - start) / 1000) };
        check('recovers from a short rate limit and draws the bracket', (await tags(page)).includes('Alpha'));
        check('tells the user it is waiting on start.gg', sawNotice);
        await context.close();
    }

    // 3. start.gg rate-limits everything: watch for 90 s
    {
        const limited = { status: 429, body: { success: false, message: 'Rate limit exceeded - api-token' } };
        const { context, page, log } = await openPage(browser, () => limited);
        await page.goto(appUrl + eventPath + '/1001');
        let gaveUpAt = null;
        const start = Date.now();
        while (Date.now() - start < 90000) {
            if (!gaveUpAt && (await snackText(page)).includes('rate limiting')) gaveUpAt = Math.round((Date.now() - start) / 1000);
            await page.waitForTimeout(500);
        }
        const perMinute = log.filter(r => r.at - log[0].at < 60000).length;
        report.rateLimitStorm = { requestsIn90s: log.length, requestsInFirstMinute: perMinute, gaveUpAfterSeconds: gaveUpAt, spinnerStillShown: await spinnerShown(page) };
        check('a lasting rate limit costs only a few retries', log.length <= 10, log.length);
        check('a lasting rate limit ends in a message, not a spinner', gaveUpAt !== null && !(await spinnerShown(page)), await snackText(page));
        await context.close();
    }

    // 4. A GraphQL error (like the 1000-object cap) on the phase query
    {
        const tooBig = { status: 200, body: { success: false, errors: [{ message: 'Query complexity too high. A maximum of 1000 objects may be returned by each request. (actual: 1235)' }] } };
        const { context, page, quiet } = await openPage(browser, q => kindOf(q) === 'phase' ? tooBig : null);
        await page.goto(appUrl + eventPath + '/1001');
        await quiet();
        await page.waitForTimeout(1000);
        const text = await snackText(page);
        report.graphqlError = { snackbar: text, spinnerStillShown: await spinnerShown(page) };
        check('a GraphQL error shows a message and stops the spinner', text.includes('complexity') && !(await spinnerShown(page)), text);
        await context.close();
    }

    // 5. The tournament page alone
    {
        const { context, page, log, quiet } = await openPage(browser);
        await page.goto(appUrl + '/tournament/test-tourney');
        await quiet();
        report.tournamentPage = count(log);
        await context.close();
    }

    // 6. Phone: tapping the Event Link box opens the keyboard, which shrinks the page height.
    //    The sidebar must stay open.
    {
        const { context, page } = await openPage(browser);
        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto(appUrl + '/');
        await page.locator('mat-toolbar button:has(mat-icon:text("menu"))').click();
        await page.waitForTimeout(500);
        const openBefore = await page.locator('mat-sidenav.mat-drawer-opened').count() > 0;
        await page.locator('mat-sidenav input').click();
        await page.setViewportSize({ width: 390, height: 500 });
        await page.waitForTimeout(800);
        const openAfter = await page.locator('mat-sidenav.mat-drawer-opened').count() > 0;
        report.mobileKeyboard = { openBefore, openAfter };
        check('phone: opening the keyboard keeps the sidebar open', openBefore && openAfter, report.mobileKeyboard);
        await context.close();
    }

    // 7. A pool that hasn't started yet, for each guess at the data
    report.unstartedPool = {};
    for (const [variant, sets] of Object.entries(unstartedVariants)) {
        setsOf[2003] = sets;
        const { context, page, quiet } = await openPage(browser);
        const errors = [];
        page.on('pageerror', e => errors.push(String(e.message).slice(0, 200)));
        // Font requests are blocked on purpose, so their load errors don't count
        page.on('console', m => { if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) errors.push(m.text().slice(0, 200)); });
        await page.goto(appUrl + eventPath + '/1003');
        await quiet();
        await page.waitForTimeout(1000);
        const drawn = await page.locator('.set').count();
        await page.screenshot({ path: `e2e-out/unstarted-${variant}.png`, fullPage: true }).catch(() => { });
        const text = await snackText(page);
        report.unstartedPool[variant] = { sets: sets.length, drawn, snackbar: text, errors: errors.slice(0, 5) };
        check(`unstarted pool (${variant}) draws`, drawn > 0 && !errors.length && !(await spinnerShown(page)), report.unstartedPool[variant]);
        await context.close();
    }

    // 8. Phones open in the phone layout: menu button shown, sidebar closed
    report.phoneStart = {};
    const safari = await webkit.launch();
    try {
        for (const [name, engine, device] of [['Pixel 7', browser, devices['Pixel 7']], ['iPhone 13', safari, devices['iPhone 13']]]) {
            const { context, page } = await openPage(engine, () => null, device);
            await page.goto(appUrl + eventPath + '/1001');
            await page.waitForTimeout(1500);
            const menuShown = await page.locator('mat-toolbar button:has(mat-icon:text("menu"))').isVisible();
            const sidebarOpen = await page.locator('mat-sidenav.mat-drawer-opened').count() > 0;
            report.phoneStart[name] = { menuShown, sidebarOpen };
            check(`${name}: opens in the phone layout`, menuShown && !sidebarOpen, report.phoneStart[name]);
            await context.close();
        }
    } finally {
        await safari.close();
    }

    // 9. Show Projected on a later phase: every projected set matches the hand-worked answer
    {
        const { context, page, quiet } = await openPage(browser);
        await context.addInitScript(() => localStorage.setItem('showProjected', 'true'));
        const errors = [];
        page.on('pageerror', e => errors.push(String(e.message).slice(0, 200)));
        await page.goto(appUrl + eventPath + '/1004');
        await quiet();
        await page.waitForTimeout(1000);
        const pairs = await page.locator('.set').evaluateAll(sets => sets.map(set =>
            [...set.querySelectorAll('.set-tag')].map(tag => tag.textContent.replace(/\u200e/g, '').trim()).filter(Boolean)));
        const key = pair => [...pair].sort().join(' vs ');
        const got = pairs.filter(p => p.length == 2).map(key).sort();
        const want = laterPhase.expectedProjectedPairs.map(key).sort();
        const missing = want.filter(w => { const i = got.indexOf(w); if (i == -1) return true; got.splice(i, 1); return false; });
        report.laterPhaseProjected = { sets: pairs.length, missing, extra: got, errors };
        check('later phase: projected sets match', !missing.length && !errors.length, report.laterPhaseProjected);
        await page.screenshot({ path: 'e2e-out/later-phase-projected.png' }).catch(() => { });
        await context.close();
    }

    // 10. Phone: searching an entrant scrolls the bracket to them, even as the keyboard closes
    report.phoneSearch = {};
    const safari2 = await webkit.launch();
    try {
        for (const [name, engine, device] of [['Pixel 7', browser, devices['Pixel 7']], ['iPhone 13', safari2, devices['iPhone 13']]]) {
            const { context, page, quiet } = await openPage(engine, () => null, device);
            const errors = [];
            page.on('pageerror', e => errors.push(String(e.message).slice(0, 200)));
            try {
                await page.goto(appUrl + eventPath + '/1004');
                await quiet();
                await page.waitForTimeout(1000);
                // The entrant whose first slot is farthest from the starting view
                const target = await page.evaluate(() => {
                    const seen = new Set();
                    let best = null;
                    for (const slot of document.querySelectorAll('[entrantid]')) {
                        const id = slot.getAttribute('entrantid');
                        if (!id || seen.has(id)) continue;
                        seen.add(id);
                        const r = slot.getBoundingClientRect();
                        const tag = slot.querySelector('.set-tag')?.textContent.replace(/\u200e/g, '').trim();
                        if (tag && (!best || r.top + r.left > best.far)) best = { id, tag, far: r.top + r.left };
                    }
                    return best;
                });
                const inView = () => page.evaluate(id => {
                    const box = document.querySelector('mat-sidenav-content').getBoundingClientRect();
                    const r = document.querySelector(`[entrantid="${id}"]`).getBoundingClientRect();
                    return r.top >= box.top && r.bottom <= box.bottom && r.left >= box.left && r.right <= box.right;
                }, target.id);
                const before = await inView();
                // iOS zooms in on a tapped text box under 16px unless the viewport has maximum-scale=1
                const viewport = await page.evaluate(() => document.querySelector('meta[name=viewport]').content);
                const size = page.viewportSize();
                await page.locator('.search-entrant-form input').tap();
                await page.setViewportSize({ width: size.width, height: Math.round(size.height * 0.55) }); // keyboard opens
                await page.locator('.search-entrant-form input').fill(target.tag);
                await page.waitForTimeout(400);
                await page.locator('mat-option', { hasText: target.tag }).first().tap();
                await page.waitForTimeout(100);
                // The keyboard stays open while the search box has focus
                const keyboardClosed = await page.evaluate(() => !document.activeElement?.matches('.search-entrant-form input'));
                await page.setViewportSize(size); // keyboard closes
                await page.waitForTimeout(2000);
                const after = await inView();
                report.phoneSearch[name] = { target: target.tag, before, keyboardClosed, after, viewport, errors };
                check(`${name}: searching an entrant closes the keyboard and scrolls to them`, !before && keyboardClosed && after && !errors.length, report.phoneSearch[name]);
                check(`${name}: maximum-scale=1 on iOS only, so tapping a text box doesn't zoom and Android keeps pinch zoom`, viewport.includes('maximum-scale=1') === (name === 'iPhone 13'), viewport);
                await page.screenshot({ path: `e2e-out/phone-search-${name.replace(/ /g, '-')}.png` }).catch(() => { });
            } catch (e) {
                report.phoneSearch[name] = { crashed: String(e.message).slice(0, 300) };
                check(`${name}: searching an entrant scrolls to them`, false, report.phoneSearch[name]);
            }
            await context.close();
        }
    } finally {
        await safari2.close();
    }

    // 11. Doubles: start.gg refuses pages that pass the 1000-object cap (here, more than 20 sets or
    //     50 entrants), so the pages get smaller
    {
        const normal = await openPage(browser);
        await normal.page.goto(appUrl + eventPath + '/1001');
        await normal.quiet();
        await normal.page.waitForTimeout(1000);
        const want = (await tags(normal.page)).length;
        await normal.context.close();

        const tooBig = { status: 200, body: { success: false, errors: [{ message: 'Your query complexity is too high. A maximum of 1000 objects may be returned by each request.' }] } };
        const perPage = q => Number(q.match(/perPage: (\d+)/)?.[1] ?? 0);
        const { context, page, log, quiet } = await openPage(browser, q =>
            (kindOf(q) === 'sets' && perPage(q) > 20) || (kindOf(q) === 'entrants' && perPage(q) > 50) ? tooBig : null);
        const errors = [];
        page.on('pageerror', e => errors.push(String(e.message).slice(0, 200)));
        await page.goto(appUrl + eventPath + '/1001');
        await quiet();
        await page.waitForTimeout(1000);
        const got = (await tags(page)).length;
        const text = await snackText(page);
        report.doublesComplexity = { want, got, snackbar: text, requests: count(log), errors };
        check('doubles: oversized pages are retried smaller and the bracket draws', want > 0 && got === want && !text.includes('complexity') && !errors.length, report.doublesComplexity);
        await context.close();
    }

    // 12. The back-to-top button: hidden at the top, shows at the bottom right after scrolling, takes you back
    report.backToTop = {};
    const safari3 = await webkit.launch();
    try {
        for (const [name, engine, device] of [['Desktop', browser, {}], ['Pixel 7', browser, devices['Pixel 7']], ['iPhone 13', safari3, devices['iPhone 13']]]) {
            const { context, page, quiet } = await openPage(engine, () => null, device);
            try {
                await page.goto(appUrl + eventPath + '/1004');
                await quiet();
                await page.waitForTimeout(1000);
                const button = page.locator('.scroll-to-top-button');
                const hiddenAtTop = !(await button.isVisible());
                await page.evaluate(() => document.querySelector('mat-sidenav-content').scrollTo(0, 600));
                await page.waitForTimeout(500);
                const shownAfterScroll = await button.isVisible();
                const box = await button.boundingBox();
                const view = page.viewportSize();
                const bottomRight = !!box && box.x > view.width / 2 && box.y > view.height / 2;
                if (shownAfterScroll) await button.click();
                await page.waitForTimeout(1500);
                const backAtTop = await page.evaluate(() => document.querySelector('mat-sidenav-content').scrollTop === 0);
                const hiddenAgain = !(await button.isVisible());
                report.backToTop[name] = { hiddenAtTop, shownAfterScroll, bottomRight, backAtTop, hiddenAgain };
                check(`${name}: back-to-top button shows after scrolling, sits bottom right, and goes back`, hiddenAtTop && shownAfterScroll && bottomRight && backAtTop && hiddenAgain, report.backToTop[name]);
            } catch (e) {
                report.backToTop[name] = { crashed: String(e.message).slice(0, 300) };
                check(`${name}: back-to-top button shows after scrolling, sits bottom right, and goes back`, false, report.backToTop[name]);
            }
            await context.close();
        }
    } finally {
        await safari3.close();
    }

    // 13. Character picks: matched to sides by entrant, two per side in doubles, and missing ones skipped
    {
        // Each team (entrant) has two players. Picks come shuffled; set 101 has a game where only the
        // bottom side reported, and one pick with no character.
        const icon = (entrantId, n) => ({ images: [{ type: 'stockIcon', url: `https://icons.test/${entrantId}-${n}.png` }] });
        const withGames = body => {
            for (const set of body.data.phaseGroup.sets.nodes) {
                const [a, b] = set.slots.map(slot => slot.entrant.id);
                const pick = (id, n) => ({ entrant: { id }, character: icon(id, n) });
                set.games = [{ winnerId: set.winnerId, stage: { name: 'Stage' }, selections: [pick(b, 1), pick(a, 1), pick(b, 2), pick(a, 2)] }];
                if (set.id === 101) set.games.push({ winnerId: b, stage: null, selections: [pick(b, 1), { entrant: { id: b }, character: null }] });
            }
            return body;
        };
        const { context, page, quiet } = await openPage(browser, q =>
            kindOf(q) === 'sets' && q.includes('phaseGroup(id: 2001)') ? { body: withGames(answer(q)) } : null);
        const errors = [];
        page.on('pageerror', e => errors.push(String(e.message).slice(0, 200)));
        await page.route('https://icons.test/**', route => route.fulfill({ status: 404 }));
        await page.goto(appUrl + eventPath + '/1001');
        await quiet();
        await page.waitForTimeout(1000);
        // In the bracket: each slot's icon belongs to that slot's entrant
        const bracket = await page.locator('.set').evaluateAll(sets => sets.map(set => ({
            ids: [...set.querySelectorAll('[entrantid]')].map(slot => slot.getAttribute('entrantid')),
            icons: [...set.querySelectorAll('img.set-image')].map(img => img.getAttribute('src')),
        })));
        const bracketOk = bracket.length > 0 && bracket.every(set => set.icons.length === 2 && set.icons.every((src, k) => src.includes(`/${set.ids[k]}-`)));
        // In the popup for set 101 (Alpha vs Delta): two icons per side in game 1, only Delta's in game 2
        await page.locator('.set', { hasText: 'Delta' }).filter({ hasText: 'Alpha' }).first().click();
        await page.waitForTimeout(800);
        const games = await page.locator('mat-dialog-content mat-card-content > div').evaluateAll(games => games.map(game =>
            [...game.querySelectorAll('.game-icon')].map(side => [...side.querySelectorAll('img')].map(img => img.getAttribute('src').match(/\/(\d+)-/)[1]))));
        report.characterPicks = { bracket: bracket.slice(0, 3), games, errors };
        const popupOk = JSON.stringify(games) === JSON.stringify([[['1', '1'], ['4', '4']], [[], ['4']]]);
        check('character picks: each side shows its own picks, doubles shows both, missing ones skipped', bracketOk && popupOk && !errors.length, report.characterPicks);
        await page.screenshot({ path: 'e2e-out/character-picks.png' }).catch(() => { });
        await context.close();
    }
} finally {
    await browser.close();
}

report.passed = report.checks.every(c => c.ok);
console.log(JSON.stringify(report, null, 2));
if (!reportOnly && !report.passed) process.exit(1);
