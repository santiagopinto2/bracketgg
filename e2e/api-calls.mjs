// Browser test of how the app talks to start.gg, against a fake start.gg.
// Counts the requests a bracket view costs, and checks rate-limit and error handling.
//
//   node e2e/api-calls.mjs <app url> [--report-only]
//
// The app must be served (STATIC_DIR=dist/bracketgg/browser node proxy-server.js). Needs the
// playwright package and Chromium (npm install --no-save playwright && npx playwright install chromium).
// Prints a JSON report. Without --report-only it exits 1 if a check fails.
import { chromium } from 'playwright';

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

const phaseGroupOf = { 1001: 2001, 1002: 2002 };
const setsOf = { 2001: poolSets(100), 2002: poolSets(200) };

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
            return { data: { event: { id: 10, name: 'Test Event', phases: [{ id: 1001, name: 'Pools' }, { id: 1002, name: 'Top 4' }],
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
            const nodes = structuredClone(setsOf[groupId]).slice((page - 1) * perPage, page * perPage);
            return { data: { phaseGroup: { sets: { nodes } } } };
        }
        default:
            return { errors: [{ message: 'unknown query' }] };
    }
}

// Opens a page against the fake start.gg. `respond(query, n)` may return { status, body } to override
// the n-th request (counting from 1); otherwise the normal answer goes back.
async function openPage(browser, respond = () => null) {
    const context = await browser.newContext();
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
} finally {
    await browser.close();
}

report.passed = report.checks.every(c => c.ok);
console.log(JSON.stringify(report, null, 2));
if (!reportOnly && !report.passed) process.exit(1);
