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

// A played slot, and an empty one waiting on another set's winner (placement 1) or loser (2)
const slot = (entrantId, score) => {
    const e = entrants[entrantId - 1];
    return { entrant: { id: e.id, name: e.name, initialSeedNum: e.initialSeedNum }, standing: { stats: { score: { value: score } } } };
};
const from = (setId, placement) => ({ prereqType: 'set', prereqId: String(setId), prereqPlacement: placement, entrant: null, standing: null });

// A finished 4-player double elimination pool, in start.gg's ROUND order (losers first)
function poolSets(idBase) {
    return [
        { id: idBase + 5, round: -2, fullRoundText: 'Losers Final', winnerId: 2, slots: [slot(2, 2), slot(3, 1)] },
        { id: idBase + 4, round: -1, fullRoundText: 'Losers Round 1', winnerId: 3, slots: [slot(4, 0), slot(3, 2)] },
        { id: idBase + 1, round: 1, fullRoundText: 'Winners Semi-Final', winnerId: 1, slots: [slot(1, 2), slot(4, 0)] },
        { id: idBase + 2, round: 1, fullRoundText: 'Winners Semi-Final', winnerId: 2, slots: [slot(2, 2), slot(3, 1)] },
        { id: idBase + 3, round: 2, fullRoundText: 'Winners Final', winnerId: 1, slots: [slot(1, 2), slot(2, 0)] },
        { id: idBase + 6, round: 3, fullRoundText: 'Grand Final', winnerId: 1, slots: [slot(1, 3), slot(2, 1)] },
    ];
}

// A 4-player single elimination pool with the semi-finals played and the final still empty. start.gg
// puts a 3rd place match ("3rd Place Tiebreak") in the round after the final, fed by the semi-finals' losers.
function singleElimSets(idBase, withThirdPlace) {
    const sets = [
        { id: idBase + 1, round: 1, fullRoundText: 'Semi-Final', winnerId: 1, slots: [slot(1, 2), slot(4, 0)] },
        { id: idBase + 2, round: 1, fullRoundText: 'Semi-Final', winnerId: 2, slots: [slot(2, 2), slot(3, 1)] },
        { id: idBase + 3, round: 2, fullRoundText: 'Final', winnerId: null, slots: [from(idBase + 1, 1), from(idBase + 2, 1)] },
    ];
    if (withThirdPlace) sets.push({ id: idBase + 4, round: 3, fullRoundText: '3rd Place Tiebreak', winnerId: null, slots: [from(idBase + 2, 2), from(idBase + 1, 2)] });
    return sets;
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
const phaseGroupOf = { 1001: 2001, 1002: 2002, 1003: 2003, 1004: 2004, 1006: 2008, 1007: 2009, 1008: 2010 };
// Phase 1005 has three pools, which the app fetches as one phase
const poolsOf = { 1005: [2005, 2006, 2007] };
// Phases are double elimination unless listed here. 1008's sets are never asked for: the type is refused first.
const bracketTypeOf = { 1006: 'SINGLE_ELIMINATION', 1007: 'SINGLE_ELIMINATION', 1008: 'ROUND_ROBIN' };
const setsOf = { 2001: poolSets(100), 2002: poolSets(200), 2003: unstartedVariants.noByes, 2004: laterPhase.sets, 2005: poolSets(500), 2006: poolSets(600), 2007: poolSets(700),
    2008: singleElimSets(800, true), 2009: singleElimSets(900, false), 2010: singleElimSets(1000, false) };

function kindOf(query) {
    if (query.includes('tournament(slug')) return 'tournament';
    if (query.includes('entrants(query')) return 'entrants';
    if (query.includes('phase(id') && query.includes('slots')) return 'phaseSets';
    if (query.includes('phase(id')) return 'phase';
    if (query.includes('phaseGroup(id')) return 'sets';
    if (query.includes('set(id')) return 'setScores';
    return 'other';
}

// A set as start.gg would answer the query: displayScore ("Alpha 2 - Delta 0", or "DQ") when it's
// asked for, and the slots' standing only when that is asked for
function asQueried(set, query) {
    const scores = set.slots.map(slot => slot.standing?.stats?.score?.value);
    if (query.includes('displayScore')) {
        set.displayScore = scores.some(v => v == null) ? null
            : scores.includes(-1) ? 'DQ'
            : set.slots.map((slot, i) => `${slot.entrant.name} ${scores[i]}`).join(' - ');
    }
    if (!query.includes('standing')) for (const slot of set.slots) delete slot.standing;
    return set;
}
const allSets = () => Object.values(setsOf).flat();

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
            return { data: { event: { id: 10, name: 'Test Event', phases: [{ id: 1001, name: 'Pools' }, { id: 1002, name: 'Top 4' }, { id: 1003, name: 'Unstarted Pool' }, { id: 1004, name: 'Later Phase' }, { id: 1005, name: 'Three Pools' },
                { id: 1006, name: 'Single Elim' }, { id: 1007, name: 'Single Elim, No 3rd Place' }, { id: 1008, name: 'Round Robin' }],
                entrants: { nodes: structuredClone(entrants) } } } };
        case 'phase': {
            const phaseId = Number(query.match(/phase\(id: (\d+)\)/)[1]);
            const groupIds = poolsOf[phaseId] ?? [phaseGroupOf[phaseId]];
            const total = groupIds.reduce((n, id) => n + setsOf[id].length, 0);
            return { data: { phase: { id: phaseId, bracketType: bracketTypeOf[phaseId] ?? 'DOUBLE_ELIMINATION', sets: { pageInfo: { total } }, phaseGroups: { pageInfo: { total: groupIds.length }, nodes: groupIds.map((id, i) =>
                ({ id, displayIdentifier: String.fromCharCode(65 + i), sets: { pageInfo: { total: setsOf[id].length } } })) } } } };
        }
        case 'phaseSets': {
            // start.gg sorts a phase's sets by round across all its pools
            const phaseId = Number(query.match(/phase\(id: (\d+)\)/)[1]);
            const page = Number(query.match(/page: (\d+)/)[1]);
            const perPage = Number(query.match(/perPage: (\d+)/)[1]);
            const all = (poolsOf[phaseId] ?? [phaseGroupOf[phaseId]]).flatMap(id => structuredClone(setsOf[id]).map(({ bye, unreachable, ...set }) => ({ ...set, phaseGroup: { id } })));
            const order = r => r < 0 ? r : 1000 + r;
            const nodes = all.map((set, i) => ({ set, i })).sort((a, b) => order(a.set.round) - order(b.set.round) || a.i - b.i).map(x => x.set);
            return { data: { phase: { sets: { nodes: nodes.slice((page - 1) * perPage, page * perPage).map(set => asQueried(set, query)) } } } };
        }
        case 'sets': {
            const groupId = Number(query.match(/phaseGroup\(id: (\d+)\)/)[1]);
            const page = Number(query.match(/page: (\d+)/)[1]);
            const perPage = Number(query.match(/perPage: (\d+)/)[1]);
            const nodes = structuredClone(setsOf[groupId]).slice((page - 1) * perPage, page * perPage)
                .map(({ bye, unreachable, ...set }) => asQueried(set, query));
            return { data: { phaseGroup: { sets: { nodes } } } };
        }
        case 'setScores': {
            // Aliased lookups: s0: set(id: "101") { slots { standing { ... } } }
            const data = {};
            for (const [, alias, id] of query.matchAll(/(\w+): set\(id: "?([^")]+)"?\)/g)) {
                const set = allSets().find(set => String(set.id) === id);
                data[alias] = set ? { slots: set.slots.map(slot => ({ standing: structuredClone(slot.standing ?? null) })) } : null;
            }
            return { data };
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
    // start.gg directly (before the shared cache) or through the site's /api/gql
    await page.route(/api\.start\.gg\/gql\/alpha|\/api\/gql$/, async route => {
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
        check('a small pool takes one sets request (no sample first)', report.firstLoad.sets === 1, report.firstLoad);

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

    // 11. Doubles: start.gg refuses pages that pass the 1000-object cap. Here a set costs 50 objects and
    //     the refusal gives the count, so one retry fits; entrant refusals give no count (more than 50),
    //     so those pages halve
    {
        const normal = await openPage(browser);
        await normal.page.goto(appUrl + eventPath + '/1001');
        await normal.quiet();
        await normal.page.waitForTimeout(1000);
        const want = (await tags(normal.page)).length;
        await normal.context.close();

        const tooBig = actual => ({ status: 200, body: { success: false, errors: [{ message: `Your query complexity is too high. A maximum of 1000 objects may be returned by each request.${actual ? ` (actual: ${actual})` : ''}` }] } });
        const perPage = q => Number(q.match(/perPage: (\d+)/)?.[1] ?? 0);
        const { context, page, log, quiet } = await openPage(browser, q =>
            kindOf(q) === 'sets' && perPage(q) * 50 > 1000 ? tooBig(perPage(q) * 50)
                : kindOf(q) === 'entrants' && perPage(q) > 50 ? tooBig(null) : null);
        const errors = [];
        page.on('pageerror', e => errors.push(String(e.message).slice(0, 200)));
        await page.goto(appUrl + eventPath + '/1001');
        await quiet();
        await page.waitForTimeout(1000);
        const got = (await tags(page)).length;
        const text = await snackText(page);
        report.doublesComplexity = { want, got, snackbar: text, requests: count(log), errors };
        check('doubles: oversized pages are retried smaller (sets in one retry) and the bracket draws',
            want > 0 && got === want && report.doublesComplexity.requests.sets === 2 && !text.includes('complexity') && !errors.length, report.doublesComplexity);
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

    // 14. A phase with three pools: one whole-phase fetch, every pool drawn like a pool fetched alone
    {
        const { context, page, log, quiet } = await openPage(browser, q =>
            kindOf(q) === 'phaseSets' && Number(q.match(/perPage: (\d+)/)[1]) > 7 ? { body: { errors: [{ message: 'Your query complexity is too high.' }] } } : null);
        const errors = [];
        page.on('pageerror', e => errors.push(String(e.message).slice(0, 200)));
        await page.goto(appUrl + eventPath + '/1005');
        await quiet();
        await page.waitForTimeout(1000);
        // Each pool's tags, in drawing order, should match pool 1001 (the same 4-player pool) exactly
        const pools = await page.getByText(/^\s*Pool [A-C]\s*$/).count();
        const drawn = await tags(page);
        const single = await openPage(browser);
        await single.page.goto(appUrl + eventPath + '/1001');
        await single.quiet();
        await single.page.waitForTimeout(1000);
        const one = await tags(single.page);
        await single.context.close();
        const requests = count(log);
        const want = [...one, ...one, ...one];
        report.phaseSets = { requests, drawn: drawn.length, want: want.length, sameOrder: JSON.stringify(drawn) === JSON.stringify(want), pools, errors };
        check('three-pool phase: fetched as one phase (smaller pages after a refusal), every pool drawn the same',
            report.phaseSets.sameOrder && want.length > 0 && pools === 3 && (requests.phaseSets ?? 0) >= 1 && !requests.sets && !errors.length, report.phaseSets);
        await page.screenshot({ path: 'e2e-out/three-pools.png', fullPage: true }).catch(() => { });
        await context.close();
    }

    // 15. Scores come from displayScore; a line the app can't read is looked up separately, and DQ works
    {
        // Set 101 (Alpha 2 - Delta 0) gets text no name matches; set 102 (Bravo beats Charlie) becomes a DQ
        const twist = body => {
            for (const set of body.data.phaseGroup.sets.nodes) {
                if (set.id === 101) set.displayScore = 'Alpha?? 2 - ??? 0';
                if (set.id === 102) set.displayScore = 'DQ';
            }
            return body;
        };
        const { context, page, log, quiet } = await openPage(browser, q =>
            kindOf(q) === 'sets' && q.includes('phaseGroup(id: 2001)') ? { body: twist(answer(q)) } : null);
        const errors = [];
        page.on('pageerror', e => errors.push(String(e.message).slice(0, 200)));
        await page.goto(appUrl + eventPath + '/1001');
        await quiet();
        await page.waitForTimeout(1000);
        const shown = await page.locator('.set').evaluateAll(sets => sets.map(set => {
            const names = [...set.querySelectorAll('.set-tag')].map(tag => tag.textContent.trim());
            const scores = [...set.querySelectorAll('.set-scores .set-row')].map(row => row.textContent.trim());
            return names.map((name, i) => `${name} ${scores[i] ?? ''}`).join(' - ');
        }));
        const want = ['Alpha 2 - Delta 0', 'Bravo 0 - Charlie DQ', 'Alpha 2 - Bravo 0', 'Bravo 2 - Charlie 1', 'Delta 0 - Charlie 2', 'Alpha 3 - Bravo 1'];
        const requests = count(log);
        report.displayScore = { shown, requests, errors };
        check('scores read from displayScore; an unreadable one is looked up once; DQ shows',
            want.every(w => shown.includes(w)) && requests.setScores === 1 && requests.sets === 1 && !errors.length, report.displayScore);
        await context.close();
    }

    // 16. Single elimination: only the winners side is drawn, the 3rd place match comes after the final
    //     with no line from it, and Show Projected fills the final and 3rd place match from the semis.
    //     A round robin phase gets a message instead of a spinner, and double elimination keeps both sides.
    report.singleElim = {};
    const pairsOf = page => page.locator('.set').evaluateAll(sets => sets.map(set =>
        [...set.querySelectorAll('.set-tag')].map(tag => tag.textContent.replace(/\u200e/g, '').trim()).filter(Boolean).join(' vs ')));
    const sidesOf = page => page.locator('#full-round-text-row').count();
    for (const [name, phaseId, rounds, later] of [
        ['with 3rd place', 1006, ['Semi-Final', 'Final', '3rd Place Tiebreak'], ['Alpha vs Bravo', 'Charlie vs Delta']],
        ['without 3rd place', 1007, ['Semi-Final', 'Final'], ['Alpha vs Bravo']],
    ]) {
        for (const projected of [false, true]) {
            const { context, page, quiet } = await openPage(browser);
            if (projected) await context.addInitScript(() => localStorage.setItem('showProjected', 'true'));
            const errors = [];
            page.on('pageerror', e => errors.push(String(e.message).slice(0, 200)));
            await page.goto(appUrl + eventPath + '/' + phaseId);
            await quiet();
            await page.waitForTimeout(1000);
            const got = {
                sides: await sidesOf(page),
                rounds: (await page.locator('.full-round-text').allInnerTexts()).map(t => t.trim()),
                pairs: await pairsOf(page),
                // Lines in the block columns right of the final: none should join it to the 3rd place match
                linesAfterFinal: await page.locator('#set-block-column-container').evaluateAll(cols => cols.slice(4).reduce((n, col) =>
                    n + col.querySelectorAll('.straight-block, .first-block-column-first-row, .first-block-column-second-row').length, 0)),
                spinner: await spinnerShown(page), errors,
            };
            const want = { sides: 1, rounds, pairs: ['Alpha vs Delta', 'Bravo vs Charlie', ...(projected ? later : later.map(() => ''))], linesAfterFinal: 0, spinner: false, errors: [] };
            const key = `${name}${projected ? ', projected' : ''}`;
            report.singleElim[key] = got;
            check(`single elim ${key}: one side, rounds in order, every set drawn, no line into the 3rd place match`, JSON.stringify(got) === JSON.stringify(want), got);
            await page.screenshot({ path: `e2e-out/single-elim-${key.replace(/[^a-z0-9]+/gi, '-')}.png`, fullPage: true }).catch(() => { });
            await context.close();
        }
    }
    {
        const { context, page, quiet } = await openPage(browser);
        await page.goto(appUrl + eventPath + '/1008');
        await quiet();
        await page.waitForTimeout(1000);
        const text = await snackText(page);
        report.roundRobin = { snackbar: text, spinnerStillShown: await spinnerShown(page) };
        check('round robin: a message, not a spinner', text.includes('round robin') && !(await spinnerShown(page)), report.roundRobin);
        await context.close();
    }
    {
        const { context, page, quiet } = await openPage(browser);
        await page.goto(appUrl + eventPath + '/1001');
        await quiet();
        await page.waitForTimeout(1000);
        report.doubleElimSides = { sides: await sidesOf(page), sets: await page.locator('.set').count() };
        check('double elim: still draws both sides and every set', report.doubleElimSides.sides === 2 && report.doubleElimSides.sets === 6, report.doubleElimSides);
        await context.close();
    }
} finally {
    await browser.close();
}

report.passed = report.checks.every(c => c.ok);
console.log(JSON.stringify(report, null, 2));
if (!reportOnly && !report.passed) process.exit(1);
