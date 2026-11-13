// Tests the server's login, sessions, site token and security headers end to end: runs proxy-server.js
// with the built app against a fake start.gg (GraphQL and OAuth), and drives Chromium through it.
//
//   node e2e/auth.mjs <built app dir> [port]
//
// Needs the playwright package and Chromium, and Node 22.18+. Prints a JSON report, exits 1 if a check fails.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const Q = await import('../src/app/services/startgg-queries.ts');
const repo = path.resolve(import.meta.dirname, '..');
const staticDir = path.resolve(process.argv[2] ?? 'dist/bracketgg/browser');
const port = Number(process.argv[3] ?? 4303);
const app = `http://localhost:${port}`;
const SITE_TOKEN = 'fake-site-token';
const SITE_PER_MINUTE = 40;

const report = { checks: [] };
const check = (name, ok, detail) => report.checks.push({ name, ok: !!ok, detail });

// ---- A fake start.gg ----
const fake = {
    gql: [],          // { authorization, query, variables }
    exchanges: [],    // codes asked for
    refreshes: [],    // refresh tokens asked for
    issued: 0,
    expiresIn: 7 * 86400,
    refreshMode: 'ok', // 'ok' | 'reject' | 'down'
    validRefresh: new Set(),
    revoked: new Set(), // access tokens start.gg answers 401 to
};
const tokens = () => {
    const n = ++fake.issued;
    fake.validRefresh.add(`user-refresh-${n}`);
    return { access_token: `user-access-${n}`, token_type: 'Bearer', expires_in: fake.expiresIn, refresh_token: `user-refresh-${n}` };
};
const readBody = req => new Promise(resolve => { let data = ''; req.on('data', c => data += c); req.on('end', () => resolve(data ? JSON.parse(data) : {})); });
const send = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
const fakeServer = createServer(async (req, res) => {
    const body = await readBody(req);
    if (req.url === '/gql/alpha') {
        fake.gql.push({ authorization: req.headers.authorization, query: body.query, variables: body.variables });
        if (fake.revoked.has(req.headers.authorization)) return send(res, 401, { message: 'Invalid authentication token' });
        if (body.query.includes('tournament(slug')) return send(res, 200, { data: { tournament: {
            images: [], rules: null, id: 1, name: 'Test Tourney', slug: `tournament/${body.variables?.slug}`, venueAddress: null,
            startAt: 1794000000, primaryContact: null, primaryContactType: null, events: [] } } });
        return send(res, 200, { data: {} });
    }
    if (req.url === '/oauth/access_token') {
        fake.exchanges.push(body.code);
        const ok = body.code === 'good-code' && body.grant_type === 'authorization_code' && body.client_secret === 'test-secret' && body.scope === 'user.identity';
        return ok ? send(res, 200, tokens()) : send(res, 400, { error: 'invalid_grant', message: 'secret details from start.gg' });
    }
    if (req.url === '/oauth/refresh') {
        fake.refreshes.push(body.refresh_token);
        await new Promise(r => setTimeout(r, 100));
        if (fake.refreshMode === 'down') return send(res, 503, { message: 'down' });
        if (fake.refreshMode === 'reject' || !fake.validRefresh.has(body.refresh_token)) return send(res, 400, { error: 'invalid_request' });
        fake.validRefresh.delete(body.refresh_token); // single use
        return send(res, 200, tokens());
    }
    send(res, 404, {});
});
await new Promise(r => fakeServer.listen(0, '127.0.0.1', r));
const fakeUrl = `http://127.0.0.1:${fakeServer.address().port}`;

// ---- The site's server ----
const sessionsFile = path.join(mkdtempSync(path.join(tmpdir(), 'bgg-sessions-')), 'sessions.json');
let server = null;
let serverLog = '';
async function startServer() {
    server = spawn(process.execPath, ['proxy-server.js'], {
        cwd: repo,
        env: {
            ...process.env, PORT: String(port), STATIC_DIR: staticDir, SESSIONS_FILE: sessionsFile,
            STARTGG_CLIENT_ID: 'test', STARTGG_CLIENT_SECRET: 'test-secret', STARTGG_REDIRECT_URI: `${app}/callback`,
            STARTGG_SITE_TOKEN: SITE_TOKEN, SITE_TOKEN_PER_MINUTE: String(SITE_PER_MINUTE), SITE_TOKEN_MAX_WAIT_MS: '0',
            STARTGG_GQL_URL: `${fakeUrl}/gql/alpha`, STARTGG_TOKEN_URL: `${fakeUrl}/oauth/access_token`, STARTGG_REFRESH_URL: `${fakeUrl}/oauth/refresh`,
        },
    });
    server.stdout.on('data', d => serverLog += d);
    server.stderr.on('data', d => serverLog += d);
    for (let i = 0; i < 100; i++) {
        if (await fetch(`${app}/api/gql/stats`).then(r => r.ok, () => false)) return;
        await new Promise(r => setTimeout(r, 100));
    }
    throw new Error(`server did not start: ${serverLog.slice(-1000)}`);
}
async function stopServer() {
    const exited = new Promise(r => server.once('exit', r));
    server.kill('SIGTERM');
    await exited;
}

// A request to the server from outside a browser. `cookie` is "bgg_session=..."
async function api(urlPath, { method = 'GET', body, cookie, headers = {} } = {}) {
    const res = await fetch(app + urlPath, {
        method, redirect: 'manual',
        headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}), ...headers },
        body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { }
    return { status: res.status, headers: res.headers, json, text, setCookie: res.headers.getSetCookie() };
}
const gqlFrom = since => fake.gql.slice(since);

const browser = await chromium.launch();
const newPage = async () => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await context.route(/fonts\.(googleapis|gstatic)\.com/, route => route.abort());
    // start.gg's login page: logs in at once and goes back to the callback with the same state
    const authorizeRequests = [];
    await context.route(/start\.gg\/oauth\/authorize/, route => {
        const url = new URL(route.request().url());
        authorizeRequests.push(url);
        const back = new URL(`${app}/callback`);
        back.searchParams.set('code', 'good-code');
        if (url.searchParams.has('state')) back.searchParams.set('state', url.searchParams.get('state'));
        return route.fulfill({ status: 302, headers: { location: back.href } });
    });
    const page = await context.newPage();
    const violations = [];
    page.on('console', m => { if (/Content Security Policy|Refused to/i.test(m.text())) violations.push(m.text().slice(0, 200)); });
    return { context, page, authorizeRequests, violations };
};
const loginIcon = page => page.locator('mat-toolbar button:has(mat-icon:text-is("login"))');
const logoutIcon = page => page.locator('mat-toolbar button:has(mat-icon:text-is("logout"))');
const sessionCookie = async context => (await context.cookies(app)).find(c => c.name === 'bgg_session');
const storageText = page => page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }));

try {
    await startServer();

    // 1. Security headers and static files
    {
        const index = await api('/');
        const deep = await api('/tournament/test-tourney');
        const script = index.text.match(/src="(main-[A-Z0-9]+\.js)"/)?.[1];
        const asset = script ? await api('/' + script) : null;
        const missing = await api('/no-such-file.js');
        const csp = index.headers.get('content-security-policy') ?? '';
        const headers = Object.fromEntries(['x-content-type-options', 'referrer-policy', 'cache-control', 'x-powered-by', 'access-control-allow-origin'].map(h => [h, index.headers.get(h)]));
        report.headers = { csp, ...headers, asset: asset?.headers.get('cache-control'), missing: missing.status };
        check('the page has a CSP (scripts by hash, frame-ancestors none) and nosniff, a referrer policy, no x-powered-by and no CORS',
            /script-src 'self'/.test(csp) && /frame-ancestors 'none'/.test(csp) && /style-src [^;]*'unsafe-inline'/.test(csp) && !/script-src[^;]*'unsafe-inline'/.test(csp)
            && headers['x-content-type-options'] === 'nosniff' && headers['referrer-policy'] && !headers['x-powered-by'] && !headers['access-control-allow-origin'], report.headers);
        check('index.html is no-cache, hashed files are immutable, a missing file is 404 and an app route gets the page',
            headers['cache-control'] === 'no-cache' && /immutable/.test(asset?.headers.get('cache-control') ?? '') && missing.status === 404 && deep.status === 200 && deep.text.includes('<app-root'), report.headers);
    }

    // 2. A visitor who isn't logged in sees the tournament without being sent to start.gg, through the site token
    let visitor;
    {
        visitor = await newPage();
        const { page, authorizeRequests, violations } = visitor;
        const mark = fake.gql.length;
        await page.goto(app + '/tournament/test-tourney');
        const shown = await page.locator('.tournament-name').innerText({ timeout: 15000 }).catch(() => null);
        await page.waitForTimeout(500);
        const asked = gqlFrom(mark);
        const styled = await page.locator('mat-toolbar').evaluate(el => getComputedStyle(el).backgroundColor);
        report.anonymous = { shown, url: page.url(), authorize: authorizeRequests.length, asked: asked.map(r => ({ authorization: r.authorization, variables: r.variables })), loginButton: await loginIcon(page).count(), styled, violations };
        check('a visitor sees the tournament without logging in, and is not sent to start.gg', shown === 'Test Tourney' && authorizeRequests.length === 0 && page.url() === app + '/tournament/test-tourney' && await loginIcon(page).count() === 1, report.anonymous);
        check("the server asked start.gg with the site's token, using GraphQL variables", asked.length === 1 && asked[0].authorization === `Bearer ${SITE_TOKEN}`
            && asked[0].query.includes('tournament(slug: $slug)') && asked[0].variables?.slug === 'test-tourney', report.anonymous.asked);
        check('the page breaks no Content Security Policy rule, and its styles load', violations.length === 0 && styled !== 'rgba(0, 0, 0, 0)', { violations, styled });
    }

    // 3. Only the app's own queries run with the site token
    {
        const mark = fake.gql.length;
        const other = await api('/api/gql', { method: 'POST', body: { query: 'query { currentUser { id email } }' } });
        const nearly = await api('/api/gql', { method: 'POST', body: { query: 'query { tournament(slug: "x") { id name } }' } });
        const mutation = await api('/api/gql', { method: 'POST', body: { query: 'mutation { deletePhase(phaseId: 1) }' } });
        const own = await api('/api/gql', { method: 'POST', body: { query: Q.tournamentQuery, variables: { slug: 'own-query' } } });
        check("a query that isn't the app's own, or a mutation, is refused without reaching start.gg; the app's own answers",
            other.status === 400 && nearly.status === 400 && mutation.status === 400 && own.status === 200 && gqlFrom(mark).length === 1,
            { other: other.status, nearly: nearly.status, mutation: mutation.status, own: own.status, upstream: gqlFrom(mark).length });
        const badCode = await api('/api/auth/token', { method: 'POST', body: { code: { $ne: 1 } } });
        const longCode = await api('/api/auth/token', { method: 'POST', body: { code: 'x'.repeat(5000) } });
        const crossSite = await api('/api/auth/logout', { method: 'POST', body: {}, headers: { origin: 'https://evil.example' } });
        const refused = await api('/api/auth/token', { method: 'POST', body: { code: 'wrong-code' }, headers: { 'x-forwarded-for': '203.0.113.9' } });
        check('the login endpoint checks its input, refuses other sites, and passes a refusal on without start.gg\'s words',
            badCode.status === 400 && longCode.status === 400 && crossSite.status === 403 && refused.status === 400 && !refused.text.includes('secret details'),
            { badCode: badCode.status, longCode: longCode.status, crossSite: crossSite.status, refused: refused.json });
    }

    // 4. A callback this browser didn't start (no or another state) is refused, and no code is traded
    {
        const { context, page } = await newPage();
        const mark = fake.exchanges.length;
        await page.goto(app + '/callback?code=good-code&state=someone-elses');
        const text = await page.locator('.callback-container.error').innerText({ timeout: 10000 }).catch(() => '');
        check('a login callback with a state this browser did not make is refused', /not started from this browser/.test(text) && fake.exchanges.length === mark && !(await sessionCookie(context)),
            { text: text.replace(/\s+/g, ' ').slice(0, 200), exchanges: fake.exchanges.length - mark });
        await context.close();
    }

    // 5. Logging in: state goes to start.gg and comes back, the server keeps the tokens, the browser only a cookie
    let cookie;
    {
        const { context, page, authorizeRequests } = visitor;
        await loginIcon(page).click();
        await page.waitForURL(app + '/tournament/test-tourney', { timeout: 15000 }).catch(() => { });
        await logoutIcon(page).waitFor({ timeout: 10000 }).catch(() => { });
        const asked = authorizeRequests[0];
        const session = await sessionCookie(context);
        cookie = session && `bgg_session=${session.value}`;
        const stored = await storageText(page);
        report.login = { authorize: asked && Object.fromEntries(asked.searchParams), url: page.url(), cookie: session && { httpOnly: session.httpOnly, sameSite: session.sameSite, secure: session.secure }, stored };
        check('login sends a random state and asks only user.identity, then comes back to the page logged in',
            asked?.searchParams.get('state')?.length >= 32 && asked.searchParams.get('scope') === 'user.identity' && page.url() === app + '/tournament/test-tourney' && await logoutIcon(page).count() === 1, report.login);
        check('the browser holds an HttpOnly, SameSite=Lax cookie and no token in localStorage or sessionStorage',
            session?.httpOnly && session.sameSite === 'Lax' && !/user-access|user-refresh|oauth_access_token|oauth_refresh_token/.test(stored), report.login);
        await new Promise(r => setTimeout(r, 1500)); // the store saves half a second after a change
        const file = existsSync(sessionsFile) ? readFileSync(sessionsFile, 'utf8') : '';
        check('the session is saved to the sessions file, by a hash of its id', file.includes('user-refresh-1') && !file.includes(session?.value), { saved: !!file });
    }

    // 6. A return visit a week later, after a server restart, with the access token expired: one refresh
    //    shared by every request, and no trip to start.gg's login
    {
        await stopServer();
        const saved = JSON.parse(readFileSync(sessionsFile, 'utf8'));
        for (const session of Object.values(saved.sessions)) session.expiresAt = Date.now() - 1000;
        writeFileSync(sessionsFile, JSON.stringify(saved));
        await startServer();
        const refreshesBefore = fake.refreshes.length;
        const { context, page, authorizeRequests } = await newPage();
        await context.addCookies([{ name: 'bgg_session', value: cookie.split('=')[1], url: app, httpOnly: true, sameSite: 'Lax' }]);
        const mark = fake.gql.length;
        const [answers] = await Promise.all([
            Promise.all(Array.from({ length: 4 }, (_, i) => api('/api/gql', { method: 'POST', cookie, body: { query: Q.tournamentQuery, variables: { slug: `parallel-${i}` } } }))),
            page.goto(app + '/tournament/return-visit'),
        ]);
        await page.locator('.tournament-name').waitFor({ timeout: 15000 }).catch(() => { });
        await logoutIcon(page).waitFor({ timeout: 5000 }).catch(() => { });
        const used = gqlFrom(mark).map(r => r.authorization);
        report.silentRefresh = { refreshes: fake.refreshes.slice(refreshesBefore), used, authorize: authorizeRequests.length, statuses: answers.map(a => a.status) };
        check('an expiring token is refreshed once for all parallel requests, and the page stays logged in without going to start.gg',
            fake.refreshes.length - refreshesBefore === 1 && fake.refreshes.at(-1) === 'user-refresh-1' && used.length >= 5 && used.every(a => a === 'Bearer user-access-2')
            && answers.every(a => a.status === 200) && authorizeRequests.length === 0 && await logoutIcon(page).count() === 1, report.silentRefresh);
        await context.close();
    }

    // 7. start.gg says 401 to the visitor's token: the server refreshes and retries with the new one
    {
        fake.revoked.add('Bearer user-access-2');
        const mark = fake.gql.length;
        const res = await api('/api/gql', { method: 'POST', cookie, body: { query: Q.tournamentQuery, variables: { slug: 'after-401' } } });
        const used = gqlFrom(mark).map(r => r.authorization);
        check('after a 401 the server retries with a new token', res.status === 200 && res.json?.data?.tournament && JSON.stringify(used) === JSON.stringify(['Bearer user-access-2', 'Bearer user-access-3']), { status: res.status, used });
    }

    // 8. start.gg is down when a refresh is due, and the server restarts: still logged in
    {
        fake.expiresIn = 60;
        fake.revoked.add('Bearer user-access-3');
        const mark = fake.gql.length;
        await api('/api/gql', { method: 'POST', cookie, body: { query: Q.tournamentQuery, variables: { slug: 'expiring' } } }); // 401, refresh to access-4 (60 s)
        fake.refreshMode = 'down';
        const during = await api('/api/auth/session', { cookie });
        await stopServer();
        await startServer();
        const after = await api('/api/auth/session', { cookie });
        fake.refreshMode = 'ok';
        fake.expiresIn = 7 * 86400;
        const recovered = await api('/api/gql', { method: 'POST', cookie, body: { query: Q.tournamentQuery, variables: { slug: 'recovered' } } });
        const lastUsed = gqlFrom(mark).at(-1)?.authorization;
        check('a refresh that fails because start.gg is down keeps the login, which also survives a server restart',
            during.json?.loggedIn === true && after.json?.loggedIn === true && recovered.status === 200 && lastUsed === 'Bearer user-access-5',
            { during: during.json, after: after.json, recovered: recovered.status, lastUsed });
    }

    // 8b. A logged-in visitor's light or dark theme is kept with the session, and survives a restart
    {
        const saved = await api('/api/auth/theme', { method: 'POST', cookie, body: { theme: 'light' } });
        const session = await api('/api/auth/session', { cookie });
        const invalid = await api('/api/auth/theme', { method: 'POST', cookie, body: { theme: 'pink' } });
        const anonymous = await api('/api/auth/theme', { method: 'POST', body: { theme: 'light' } });
        const crossSite = await api('/api/auth/theme', { method: 'POST', cookie, body: { theme: 'dark' }, headers: { origin: 'https://evil.example' } });
        await stopServer();
        await startServer();
        const afterRestart = await api('/api/auth/session', { cookie });
        report.theme = { saved: saved.json, session: session.json, invalid: invalid.status, anonymous: anonymous.status, crossSite: crossSite.status, afterRestart: afterRestart.json };
        check("the server keeps a logged-in visitor's theme with their session, through a restart, and refuses other values, visitors and other sites",
            saved.status === 200 && session.json?.loggedIn === true && session.json?.theme === 'light' && invalid.status === 400 && anonymous.status === 401
            && crossSite.status === 403 && afterRestart.json?.theme === 'light', report.theme);
    }

    // 9. start.gg refuses the refresh token: the session ends cleanly and the page keeps working as a visitor
    {
        const { context, page, authorizeRequests } = await newPage();
        await context.addCookies([{ name: 'bgg_session', value: cookie.split('=')[1], url: app, httpOnly: true, sameSite: 'Lax' }]);
        await page.goto(app + '/tournament/still-logged-in');
        await logoutIcon(page).waitFor({ timeout: 10000 }).catch(() => { });
        const wasLoggedIn = await logoutIcon(page).count() === 1;
        fake.refreshMode = 'reject';
        fake.revoked.add('Bearer user-access-5');
        const mark = fake.gql.length;
        await page.goto(app + '/tournament/after-reject');
        await page.locator('.tournament-name').waitFor({ timeout: 15000 }).catch(() => { });
        await loginIcon(page).waitFor({ timeout: 5000 }).catch(() => { });
        const shown = await page.locator('.tournament-name').innerText().catch(() => null);
        const used = gqlFrom(mark).map(r => r.authorization);
        const session = await api('/api/auth/session', { cookie });
        report.refreshRejected = { wasLoggedIn, shown, used, cookieLeft: !!(await sessionCookie(context)), session: session.json, authorize: authorizeRequests.length, url: page.url() };
        check('a refused refresh logs out cleanly: the page still loads with the site token, shows "log in", and is not sent to start.gg',
            wasLoggedIn && shown === 'Test Tourney' && used.at(-1) === `Bearer ${SITE_TOKEN}` && !report.refreshRejected.cookieLeft && session.json?.loggedIn === false
            && await loginIcon(page).count() === 1 && authorizeRequests.length === 0 && page.url() === app + '/tournament/after-reject', report.refreshRejected);
        fake.refreshMode = 'ok';
        fake.expiresIn = 7 * 86400;
        await context.close();
    }

    // 10. Logging out deletes the session on the server
    {
        const { context, page } = visitor;
        await page.goto(app + '/tournament/test-tourney');
        await loginIcon(page).click();
        await logoutIcon(page).waitFor({ timeout: 15000 }).catch(() => { });
        const before = await sessionCookie(context);
        await logoutIcon(page).click();
        await loginIcon(page).waitFor({ timeout: 5000 }).catch(() => { });
        const after = await sessionCookie(context);
        const replay = before ? await api('/api/auth/session', { cookie: `bgg_session=${before.value}` }) : null;
        check('logging out clears the cookie, and the old cookie no longer works', before && !after && replay?.json?.loggedIn === false && await loginIcon(page).count() === 1,
            { before: !!before, after: !!after, replay: replay?.json });
        await context.close();
    }

    // 11. The login endpoint's rate limit
    {
        const statuses = [];
        for (let i = 0; i < 12; i++) statuses.push((await api('/api/auth/token', { method: 'POST', body: { code: 'wrong' }, headers: { 'x-forwarded-for': '198.51.100.7' } })).status);
        check('the login endpoint allows 10 tries a minute from one address', statuses.slice(0, 10).every(s => s === 400) && statuses.slice(10).every(s => s === 429), statuses);
    }

    // 12. The site token's gate: past its limit visitors get "busy" (503 with Retry-After), and start.gg never sees more
    {
        const mark = fake.gql.length;
        const answers = await Promise.all(Array.from({ length: SITE_PER_MINUTE + 10 }, (_, i) =>
            api('/api/gql', { method: 'POST', body: { query: Q.tournamentQuery, variables: { slug: `gate-${i}` } } })));
        const siteCalls = gqlFrom(mark).filter(r => r.authorization === `Bearer ${SITE_TOKEN}`).length;
        const busy = answers.filter(a => a.status === 503);
        check(`the site token is held to ${SITE_PER_MINUTE} a minute here, with a clear busy answer past that`,
            siteCalls <= SITE_PER_MINUTE && busy.length >= 10 && busy.every(a => a.json?.errors?.[0]?.extensions?.code === 'SITE_BUSY' && Number(a.headers.get('retry-after')) > 0),
            { siteCalls, newCalls: fake.gql.length - mark, busy: busy.length, sample: busy[0]?.json });
    }
} catch (error) {
    check('the run finished', false, String(error.stack ?? error).slice(0, 1000));
} finally {
    await browser.close();
    if (server && server.exitCode === null) await stopServer();
    fakeServer.close();
}

report.passed = report.checks.length > 0 && report.checks.every(c => c.ok);
if (!report.passed) report.serverLog = serverLog.slice(-3000);
console.log(JSON.stringify(report, null, 2));
process.exit(report.passed ? 0 : 1);
