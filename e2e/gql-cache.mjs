// Tests server/gql-cache.js and server/site-gate.js against a fake start.gg, and the cache once against
// the real one when STARTGG_TOKEN is set.
// Usage: node e2e/gql-cache.mjs   Prints a JSON report and exits 1 if a check fails. Needs Node 22.18+.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const express = require('express');
const { createGqlCache, ttlMs } = require('../server/gql-cache.js');
const { loadAllowlist } = require('../server/gql-allowlist.js');
const { createSiteGate, SiteBusyError } = require('../server/site-gate.js');
const Q = await import('../src/app/services/startgg-queries.ts');

const report = { checks: [] };
const check = (name, ok, detail) => report.checks.push({ name, ok: !!ok, detail });

const allowed = await loadAllowlist();
check('the allowlist holds every query the app can send', allowed.size === 4 + 8 + 1 + 1 + Q.MAX_POOL_SLICES + Q.MAX_SET_SCORES + 1 && allowed.has(Q.tournamentQuery) && allowed.has(Q.setDetailsQuery) && allowed.has(Q.setScoresQuery(37)) && allowed.has(Q.poolSlicesQuery(Q.MAX_POOL_SLICES)), allowed.size);
// Pool slices are set results, which stay fresh for 15 s like any other
const sliceTtls = Array.from({ length: Q.MAX_POOL_SLICES }, (_, i) => ttlMs(Q.poolSlicesQuery(i + 1)));
// The set dialog's stream and accounts rarely change; set scores looked up by id stay live
check("a set's stream and accounts stay fresh for 5 minutes, its scores for 15 s", ttlMs(Q.setDetailsQuery) === 5 * 60_000 && ttlMs(Q.setScoresQuery(3)) === 15_000, [ttlMs(Q.setDetailsQuery), ttlMs(Q.setScoresQuery(3))]);
check('pool slices get the 15 s set results TTL', sliceTtls.every(ttl => ttl === 15_000) && ttlMs(Q.poolSetsQuery) === 15_000, [...new Set(sliceTtls)]);
check('the seeds a phase takes from an earlier one stay fresh for a minute, a phase\'s players for five', ttlMs(Q.phaseProgressionsQuery) === 60_000 && ttlMs(Q.phaseEntrantsQuery) === 5 * 60_000, [ttlMs(Q.phaseProgressionsQuery), ttlMs(Q.phaseEntrantsQuery)]);

// A fake start.gg: answers per query, counts calls and the tokens they came with, can be slow
let upstreamCalls = 0;
let tokensSeen = [];
let reply = () => ({ status: 200, body: { data: { ok: true } } });
const fakeFetch = async (url, init) => {
    upstreamCalls++;
    tokensSeen.push(init.headers.authorization);
    await new Promise(r => setTimeout(r, 50));
    const { query, variables } = JSON.parse(init.body);
    const { status, body, headers = {} } = reply(query, variables, init.headers.authorization);
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers });
};

// Who each request runs as, from a test header: "user:<token>", "user401:<token>" (start.gg will say
// 401 to it; the retry gets "<token>-new"), "site", or nothing (no one: neither a session nor a site token)
const SITE = { kind: 'site', authorization: 'Bearer site-token' };
const tokenFor = async req => {
    const as = req.get('x-test-as') ?? '';
    if (as === 'site') return SITE;
    if (as.startsWith('user:')) return { kind: 'user', authorization: `Bearer ${as.slice(5)}`, onUnauthorized: async () => SITE };
    if (as.startsWith('user401:')) return { kind: 'user', authorization: `Bearer ${as.slice(8)}`, onUnauthorized: async () => ({ kind: 'user', authorization: `Bearer ${as.slice(8)}-new` }) };
    return null;
};

let clock = 1_000_000;
const gate = createSiteGate({ perWindow: 5, windowMs: 60_000, maxWaitMs: 0 });
const cache = createGqlCache({ allowed, tokenFor, siteGate: gate, fetchImpl: fakeFetch, now: () => clock, maxBytes: 4000 });
const app = express();
app.use(express.json());
app.post('/api/gql', cache.handle);
const server = await new Promise(r => { const s = app.listen(0, () => r(s)); });
const base = `http://localhost:${server.address().port}/api/gql`;

const post = async (query, variables, as = 'user:viewer-a') => {
    const res = await fetch(base, { method: 'POST', headers: { 'content-type': 'application/json', ...(as ? { 'x-test-as': as } : {}) }, body: JSON.stringify({ query, variables }) });
    return { status: res.status, cache: res.headers.get('x-cache'), retryAfter: res.headers.get('retry-after'), body: await res.json() };
};
// A phase's players (any string works as the id here)
const players = id => [Q.phaseEntrantsQuery, { phaseId: id, page: 1, perPage: 300 }];
const sets = id => [Q.poolSetsQuery, { id, page: 1, perPage: 55 }];

try {
    // 1. The second viewer of the same thing gets the cached answer
    upstreamCalls = 0;
    const first = await post(...players('a'), 'user:viewer-a');
    const second = await post(...players('a'), 'user:viewer-b');
    check('a repeat query is served from the cache', first.cache === 'MISS' && second.cache === 'HIT' && upstreamCalls === 1 && second.body.data?.ok, { first, second, upstreamCalls });

    // 2. Identical requests at the same moment share one upstream call
    upstreamCalls = 0;
    const together = await Promise.all(Array.from({ length: 5 }, () => post(...players('b'))));
    check('identical requests in flight share one call', upstreamCalls === 1 && together.every(r => r.status === 200), { upstreamCalls });

    // 3. GraphQL errors (like the object cap) are passed on, not cached
    upstreamCalls = 0;
    reply = () => ({ status: 200, body: { errors: [{ message: 'Your query complexity is too high.' }] } });
    const e1 = await post(...players('c'));
    const e2 = await post(...players('c'));
    check('errors are passed on and not cached', upstreamCalls === 2 && e1.body.errors && e2.cache === 'MISS', { e1, upstreamCalls });

    // 4. Rate limits pass through with Retry-After, not cached
    upstreamCalls = 0;
    reply = () => ({ status: 429, body: { message: 'Rate limit exceeded' }, headers: { 'retry-after': '7' } });
    const r1 = await post(...players('d'));
    const r2 = await post(...players('d'));
    check('429 passes through with Retry-After and is not cached', r1.status === 429 && r1.retryAfter === '7' && upstreamCalls === 2, { r1, r2 });

    // 5. Another failure keeps start.gg's status but not its error page
    reply = () => ({ status: 500, body: '<html>secret stack trace</html>' });
    const r500 = await post(...players('d2'));
    check("a start.gg error page isn't passed on", r500.status === 502 && !JSON.stringify(r500.body).includes('secret'), r500);
    reply = () => ({ status: 200, body: { data: { ok: true } } });

    // 6. Only the app's own queries run; no one (no session and no site token) gets anything, not even a cached answer
    upstreamCalls = 0;
    const noOne = await post(...players('a'), null);
    const other = await post('query { event(slug: "x") { id name } }', {});
    const otherSite = await post('query { event(slug: "x") { id name } }', {}, 'site');
    const me = await post('query { currentUser { email } }', {}, 'site');
    const mutation = await post('mutation { updatePhaseSeeding(phaseId: 1) { id } }', {}, 'site');
    const changed = await post(Q.tournamentQuery + ' ', { slug: 'x' }, 'site');
    const nested = await post(Q.tournamentQuery, { slug: { a: 1 } }, 'site');
    check('a cached answer still needs a session or the site token (401)', noOne.status === 401 && !noOne.body.data, noOne);
    check('any query not in the app, currentUser, mutations, a changed text and odd variables are refused before start.gg',
        [other, otherSite, me, mutation, changed, nested].every(r => r.status === 400) && upstreamCalls === 0,
        { other: other.status, otherSite: otherSite.status, me: me.status, mutation: mutation.status, changed: changed.status, nested: nested.status, upstreamCalls });

    // 7. Variables are part of the key, in any order
    upstreamCalls = 0;
    const v1 = await post(Q.phaseEntrantsQuery, { phaseId: 7, page: 1, perPage: 300 });
    const v2 = await post(Q.phaseEntrantsQuery, { perPage: 300, page: 1, phaseId: 7 });
    const v3 = await post(Q.phaseEntrantsQuery, { phaseId: 7, page: 2, perPage: 300 });
    check('the cache keys on the query and its variables', v1.cache === 'MISS' && v2.cache === 'HIT' && v3.cache === 'MISS' && upstreamCalls === 2, { v1: v1.cache, v2: v2.cache, v3: v3.cache });

    // 8. Set results go stale after 15 s; a phase's players last 5 minutes
    upstreamCalls = 0;
    await post(...sets(1));
    await post(...players('e'));
    clock += 16_000;
    const setsLater = await post(...sets(1));
    const eventSoon = await post(...players('e'));
    clock += 5 * 60_000;
    const eventLater = await post(...players('e'));
    check('sets refresh after 15 s, players after 5 min', setsLater.cache === 'MISS' && eventSoon.cache === 'HIT' && eventLater.cache === 'MISS', { sets: setsLater.cache, event: eventSoon.cache, eventLater: eventLater.cache });

    // 9. A visitor's token that start.gg refuses (401) is retried once with the new token
    upstreamCalls = 0;
    tokensSeen = [];
    reply = (q, v, auth) => auth === 'Bearer old' ? { status: 401, body: { message: 'Invalid token' } } : { status: 200, body: { data: { ok: true } } };
    const retried = await post(...players('f'), 'user401:old');
    check('after a 401 the retry uses the new token', retried.status === 200 && JSON.stringify(tokensSeen) === JSON.stringify(['Bearer old', 'Bearer old-new']), { status: retried.status, tokensSeen });
    reply = () => ({ status: 200, body: { data: { ok: true } } });

    // 10. The site token passes through the gate (5 a minute here); past that the answer is "busy", and logged-in visitors don't wait
    upstreamCalls = 0;
    tokensSeen = [];
    const siteAnswers = [];
    for (let i = 0; i < 7; i++) siteAnswers.push(await post(...players(`g${i}`), 'site'));
    const busy = siteAnswers.filter(r => r.status === 503);
    const userAfter = await post(...players('h'), 'user:viewer-c');
    const hitAfter = await post(...players('g0'), 'site');
    check('the site token stops at its limit with a clear "busy" answer and Retry-After',
        siteAnswers.slice(0, 5).every(r => r.status === 200) && busy.length === 2 && busy.every(r => r.body.errors?.[0]?.extensions?.code === 'SITE_BUSY' && Number(r.retryAfter) > 0 && /log in/i.test(r.body.errors[0].message))
        && tokensSeen.filter(t => t === 'Bearer site-token').length === 5,
        { statuses: siteAnswers.map(r => r.status), busy: busy[0], siteCalls: tokensSeen.filter(t => t === 'Bearer site-token').length });
    check('logged-in visitors and cache hits skip the site gate', userAfter.status === 200 && hitAfter.cache === 'HIT', { user: userAfter.status, hit: hitAfter.cache });

    // 11. The cache stays under its byte cap, dropping the least recently used
    const big = 'x'.repeat(900);
    reply = q => ({ status: 200, body: { data: { big } } });
    for (let i = 0; i < 10; i++) await post(...players(`big${i}`));
    const { bytes, entries } = cache.size();
    const newest = await post(...players('big9'));
    const oldest = await post(...players('big0'));
    check('cache stays under its byte cap, dropping the oldest', bytes <= 4000 && newest.cache === 'HIT' && oldest.cache === 'MISS', { bytes, entries });
} finally {
    server.close();
    cache.stop();
}

// 12. The gate on its own, with a fake clock: 3 a second, waiting at most 1.5 s
{
    let t = 0;
    const g = createSiteGate({ perWindow: 3, windowMs: 1000, maxWaitMs: 1500, now: () => t });
    const started = [];
    const results = [];
    for (let i = 0; i < 9; i++) results.push(g.run(async () => { started.push(t); return i; }).catch(e => e));
    await new Promise(r => setTimeout(r, 20));
    const firstSecond = started.length;
    const busyAtOnce = (await Promise.all(results.slice(6))).every(r => r instanceof SiteBusyError && r.retryAfterS >= 1);
    t = 1000;
    g.pause(0);
    await new Promise(r => setTimeout(r, 20));
    const afterOneSecond = started.length;
    check('the gate starts 3 a second, queues the next 3, and turns away the rest', firstSecond === 3 && afterOneSecond === 6 && busyAtOnce, { firstSecond, afterOneSecond, busyAtOnce });
}

// 13. The real start.gg, through the cache: the app's own queries with variables answer, then a repeat is a hit
if (process.env.STARTGG_TOKEN) {
    const live = createGqlCache({ allowed, tokenFor: async () => ({ kind: 'site', authorization: `Bearer ${process.env.STARTGG_TOKEN}` }) });
    const liveApp = express();
    liveApp.use(express.json());
    liveApp.post('/api/gql', live.handle);
    const liveServer = await new Promise(r => { const s = liveApp.listen(0, () => r(s)); });
    try {
        const url = `http://localhost:${liveServer.address().port}/api/gql`;
        const ask = (query, variables) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query, variables }) })
            .then(async res => ({ status: res.status, cache: res.headers.get('x-cache'), body: await res.json() }));
        const slug = 'tournament/tussle-thru-time/event/brawl-doubles';
        const a = await ask(Q.eventOverviewQuery({ lostTo: true, rankings: true, socials: true }), { slug, videogameId: 1 });
        const b = await ask(Q.eventOverviewQuery({ lostTo: true, rankings: true, socials: true }), { slug, videogameId: 1 });
        const t = await ask(Q.tournamentQuery, { slug: 'tussle-thru-time' });
        check('live start.gg: the overview query with variables answers, then the repeat is a hit; the tournament query answers',
            a.status === 200 && a.body.data?.event?.id && b.cache === 'HIT' && t.body.data?.tournament?.id,
            { first: { status: a.status, cache: a.cache, event: a.body.data?.event?.name, errors: a.body.errors }, second: b.cache, tournament: t.body.data?.tournament?.name ?? t.body.errors });
    } finally {
        liveServer.close();
        live.stop();
    }
} else {
    report.live = 'skipped: no STARTGG_TOKEN';
}

report.passed = report.checks.every(c => c.ok);
console.log(JSON.stringify(report, null, 2));
process.exit(report.passed ? 0 : 1);
