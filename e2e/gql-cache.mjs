// Tests server/gql-cache.js and server/site-gate.js against a fake start.gg, and the cache once against
// the real one when STARTGG_TOKEN is set.
// Usage: node e2e/gql-cache.mjs   Prints a JSON report and exits 1 if a check fails. Needs Node 22.18+.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const express = require('express');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createGqlCache, ttlMs, ttlFor, queryName, LONG_TTL_MS } = require('../server/gql-cache.js');
const { loadAllowlist } = require('../server/gql-allowlist.js');
const { createSiteGate, SiteBusyError } = require('../server/site-gate.js');
const Q = await import('../src/app/services/startgg-queries.ts');

const report = { checks: [] };
const check = (name, ok, detail) => report.checks.push({ name, ok: !!ok, detail });

const allowed = await loadAllowlist();
check('the allowlist holds every query the app can send', allowed.size === 4 + 4 + 8 + 1 + 1 + 1 + Q.MAX_POOL_SLICES + Q.MAX_SET_SCORES + 1 + 1 + Q.MAX_RESULT_EVENTS && allowed.has(Q.tournamentQuery) && allowed.has(Q.tournamentLiteQuery) && allowed.has(Q.tournamentResultsQuery(Q.MAX_RESULT_EVENTS)) && allowed.has(Q.attendeesQuery(true)) && allowed.has(Q.attendeeDetailsQuery) && allowed.has(Q.setDetailsQuery) && allowed.has(Q.poolSeedsQuery) && allowed.has(Q.setScoresQuery(37)) && allowed.has(Q.poolSlicesQuery(Q.MAX_POOL_SLICES)), allowed.size);
// Pool slices are set results, which stay fresh for 15 s like any other
const sliceTtls = Array.from({ length: Q.MAX_POOL_SLICES }, (_, i) => ttlMs(Q.poolSlicesQuery(i + 1)));
// The set dialog's stream and accounts rarely change; set scores looked up by id stay live
check("a set's stream and accounts stay fresh for 5 minutes, its scores for 15 s", ttlMs(Q.setDetailsQuery) === 5 * 60_000 && ttlMs(Q.setScoresQuery(3)) === 15_000, [ttlMs(Q.setDetailsQuery), ttlMs(Q.setScoresQuery(3))]);
check('pool slices get the 15 s set results TTL', sliceTtls.every(ttl => ttl === 15_000) && ttlMs(Q.poolSetsQuery) === 15_000, [...new Set(sliceTtls)]);
check('the seeds a phase takes from an earlier one stay fresh for a minute, a phase\'s players for five', ttlMs(Q.phaseProgressionsQuery) === 60_000 && ttlMs(Q.phaseEntrantsQuery) === 5 * 60_000, [ttlMs(Q.phaseProgressionsQuery), ttlMs(Q.phaseEntrantsQuery)]);

// Every query has its own operation name, which the stats count by
{
    const names = Q.allQueries().map(queryName);
    const distinct = new Set(['Tournament', 'TournamentLite', 'TournamentResults', 'EventPhases', 'PhaseEntrants', 'PhaseProgressions', 'PoolSeeds', 'Attendees', 'SeededAttendees', 'AttendeeDetails', 'EventOverview', 'Phase', 'PoolSets', 'PoolSlices', 'SetScores', 'SetDetails']);
    check('every query has an operation name', names.every(n => distinct.has(n)) && new Set(names).size === distinct.size && queryName(Q.tournamentLiteQuery) === 'TournamentLite', [...new Set(names)]);
}

// The TTL from the answer: 6 hours only when it says everything in it is finished
{
    const T = 1_800_000_000_000; // a fixed "now" for these checks
    const ttl = (query, data) => ttlFor(query, { data }, T);
    const pool = nodes => ({ phaseGroup: { sets: { nodes } } });
    const done = (id, extra = {}) => ({ id, state: 3, winnerId: 1, displayScore: '3 - 1', ...extra });
    const sec = ms => Math.floor(ms / 1000);
    const cases = {
        // Sets
        poolAllCompleted: [ttl(Q.poolSetsQuery, pool([done(1), done(2)])), LONG_TTL_MS],
        poolWithDQ: [ttl(Q.poolSetsQuery, pool([done(1), { id: 2, state: 2, winnerId: 5, displayScore: 'DQ' }])), LONG_TTL_MS],
        poolMixed: [ttl(Q.poolSetsQuery, pool([done(1), { id: 2, state: 2, winnerId: null }])), 15_000],
        poolNullState: [ttl(Q.poolSetsQuery, pool([done(1), { id: 2, state: null }])), 15_000],
        poolPreview: [ttl(Q.poolSetsQuery, pool([done('preview_9_1_1')])), 15_000],
        poolEmpty: [ttl(Q.poolSetsQuery, pool([])), 15_000],
        poolNull: [ttl(Q.poolSetsQuery, { phaseGroup: null }), 15_000],
        slicesAllCompleted: [ttl(Q.poolSlicesQuery(2), { s0: pool([done(1)]).phaseGroup, s1: pool([done(2)]).phaseGroup }), LONG_TTL_MS],
        slicesOneEmpty: [ttl(Q.poolSlicesQuery(2), { s0: pool([done(1)]).phaseGroup, s1: pool([]).phaseGroup }), 15_000],
        slicesOneLive: [ttl(Q.poolSlicesQuery(2), { s0: pool([done(1)]).phaseGroup, s1: pool([{ id: 3, state: 6 }]).phaseGroup }), 15_000],
        scoresCompleted: [ttl(Q.setScoresQuery(2), { s0: { state: 3, slots: [] }, s1: { state: 3, slots: [] } }), LONG_TTL_MS],
        scoresOneLive: [ttl(Q.setScoresQuery(2), { s0: { state: 3, slots: [] }, s1: { state: 2, slots: [] } }), 15_000],
        detailsCompleted: [ttl(Q.setDetailsQuery, { set: { state: 3, stream: null, slots: [] } }), LONG_TTL_MS],
        detailsLive: [ttl(Q.setDetailsQuery, { set: { state: 2, stream: null, slots: [] } }), 5 * 60_000],
        // Events and phases
        eventCompleted: [ttl(Q.eventPhasesQuery, { event: { id: 1, state: 'COMPLETED', phases: [] } }), LONG_TTL_MS],
        eventActive: [ttl(Q.eventPhasesQuery, { event: { id: 1, state: 'ACTIVE', phases: [] } }), 5 * 60_000],
        overviewCompleted: [ttl(Q.eventOverviewQuery({ lostTo: true }), { event: { id: 1, state: 'COMPLETED' } }), LONG_TTL_MS],
        resultsBoth: [ttl(Q.tournamentResultsQuery(2), { e0: { id: 1, state: 'COMPLETED' }, e1: { id: 2, state: 'COMPLETED' } }), LONG_TTL_MS],
        resultsOneActive: [ttl(Q.tournamentResultsQuery(2), { e0: { id: 1, state: 'COMPLETED' }, e1: { id: 2, state: 'ACTIVE' } }), 5 * 60_000],
        phaseCompleted: [ttl(Q.phaseEntrantsQuery, { phase: { state: 'COMPLETED', seeds: { nodes: [] } } }), LONG_TTL_MS],
        progressionsActive: [ttl(Q.phaseProgressionsQuery, { phase: { state: 'ACTIVE', seeds: { nodes: [] } } }), 60_000],
        phaseGroupsCompleted: [ttl(Q.phaseQuery, { phase: { id: 1, state: 'COMPLETED', phaseGroups: { nodes: [] } } }), LONG_TTL_MS],
        // Tournaments
        tournamentAllCompleted: [ttl(Q.tournamentQuery, { tournament: { endAt: sec(T) - 3600, events: [{ state: 'COMPLETED' }] } }), LONG_TTL_MS],
        tournamentDaysAgoOneCreated: [ttl(Q.tournamentLiteQuery, { tournament: { endAt: sec(T) - 3 * 86400, events: [{ state: 'COMPLETED' }, { state: 'CREATED' }] } }), LONG_TTL_MS],
        tournamentDaysAgoOneActive: [ttl(Q.tournamentQuery, { tournament: { endAt: sec(T) - 3 * 86400, events: [{ state: 'COMPLETED' }, { state: 'ACTIVE' }] } }), 5 * 60_000],
        tournamentHoursAgo: [ttl(Q.tournamentQuery, { tournament: { endAt: sec(T) - 3600, events: [{ state: 'COMPLETED' }, { state: 'CREATED' }] } }), 5 * 60_000],
        tournamentNotEnded: [ttl(Q.tournamentQuery, { tournament: { endAt: sec(T) + 3600, events: [{ state: 'COMPLETED' }] } }), 5 * 60_000],
        tournamentNoEndAt: [ttl(Q.tournamentQuery, { tournament: { endAt: null, events: [{ state: 'COMPLETED' }] } }), 5 * 60_000],
        attendeesDaysAgo: [ttl(Q.attendeesQuery(false), { tournament: { endAt: sec(T) - 2 * 86400, participants: { nodes: [] } } }), LONG_TTL_MS],
        attendeesUpcoming: [ttl(Q.attendeesQuery(true), { tournament: { endAt: sec(T) + 86400, participants: { nodes: [] } } }), 5 * 60_000],
        attendeeAllCompleted: [ttl(Q.attendeeDetailsQuery, { participant: { entrants: [{ event: { id: 1, state: 'COMPLETED' } }] } }), LONG_TTL_MS],
        attendeeOneActive: [ttl(Q.attendeeDetailsQuery, { participant: { entrants: [{ event: { id: 1, state: 'COMPLETED' } }, { event: { id: 2, state: 'ACTIVE' } }] } }), 5 * 60_000],
        // Queries without a rule, and odd answers, keep their own time
        poolSeeds: [ttl(Q.poolSeedsQuery, { phaseGroup: { state: 3, seeds: { nodes: [] } } }), 60_000],
        notAnObject: [ttlFor(Q.poolSetsQuery, { data: 'x' }, T), 15_000],
        noData: [ttlFor(Q.eventPhasesQuery, {}, T), 5 * 60_000],
    };
    const wrong = Object.fromEntries(Object.entries(cases).filter(([, [got, want]]) => got !== want));
    check('answers about finished sets, events, phases, and tournaments are kept 6 hours, anything else its usual time', Object.keys(wrong).length === 0, wrong);
}

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

// A cache of its own, served on its own port, for the checks below
async function serve(options) {
    const c = createGqlCache({ allowed, tokenFor, fetchImpl: fakeFetch, now: () => clock, ...options });
    const a = express();
    a.use(express.json());
    a.post('/api/gql', c.handle);
    const s = await new Promise(r => { const x = a.listen(0, () => r(x)); });
    const url = `http://localhost:${s.address().port}/api/gql`;
    const ask = async (query, variables) => {
        const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-test-as': 'user:viewer-a' }, body: JSON.stringify({ query, variables }) });
        return { status: res.status, cache: res.headers.get('x-cache'), body: await res.json() };
    };
    return { cache: c, ask, close: () => { s.close(); c.stop(); } };
}

// 12a. Finished answers stay; live ones go after their usual time. Stats count per query.
{
    const done = id => ({ id, state: 3, winnerId: 1, displayScore: '2 - 0' });
    const replies = {
        1: { phaseGroup: { sets: { nodes: [done(1), done(2)] } } },
        2: { phaseGroup: { sets: { nodes: [done(3), { id: 4, state: 2, winnerId: null, displayScore: null }] } } },
    };
    reply = (q, v) => queryName(q) === 'PoolSets' ? { status: 200, body: { data: replies[v.id] ?? { phaseGroup: null } } }
        : queryName(q) === 'EventPhases' ? { status: 200, body: { data: { event: { id: 9, state: v.slug === 'done' ? 'COMPLETED' : 'ACTIVE', phases: [] } } } }
        : { status: 200, body: { data: { ok: true } } };
    upstreamCalls = 0;
    const { cache: c, ask, close } = await serve({});
    try {
        await ask(...sets(1));
        await ask(...sets(2));
        await ask(Q.eventPhasesQuery, { slug: 'done' });
        await ask(Q.eventPhasesQuery, { slug: 'live' });
        const shared = await Promise.all([ask(...sets(3)), ask(...sets(3))]); // a pool with no answer (null): short, and shared
        clock += 16_000;
        const mixedLater = await ask(...sets(2));
        clock += 60_000 - 16_000;
        const doneMinute = await ask(...sets(1));
        clock += 9 * 60_000;
        const eventDone = await ask(Q.eventPhasesQuery, { slug: 'done' });
        const eventLive = await ask(Q.eventPhasesQuery, { slug: 'live' });
        clock += LONG_TTL_MS - 10 * 60_000 - 1000;
        const doneAlmost6h = await ask(...sets(1));
        clock += 2000;
        const done6h = await ask(...sets(1));
        check('an all-completed set answer is still a HIT after 1 minute and is asked again after 6 hours', doneMinute.cache === 'HIT' && doneAlmost6h.cache === 'HIT' && done6h.cache === 'MISS', { doneMinute: doneMinute.cache, doneAlmost6h: doneAlmost6h.cache, done6h: done6h.cache });
        check('a set answer with a set still being played is asked again after 15 s', mixedLater.cache === 'MISS', mixedLater.cache);
        check("a completed event's answer is kept past 5 minutes, a live one isn't", eventDone.cache === 'HIT' && eventLive.cache === 'MISS', { done: eventDone.cache, live: eventLive.cache });

        const got = c.report();
        const pools = got.byQuery.PoolSets;
        const events = got.byQuery.EventPhases;
        check('the stats count hits, misses, shared requests, start.gg calls, and long-kept answers per query, and the uptime',
            pools?.hits === 2 && pools.misses === 5 && pools.shared === 1 && pools.upstream === 5 && pools.long === 2
            && events?.hits === 1 && events.misses === 3 && events.upstream === 3 && events.long === 1
            && got.hits === 3 && got.misses === 8 && got.long === 3 && got.upstream === upstreamCalls && got.uptimeS > 6 * 3600 && got.entries >= 1
            && shared.every(r => r.status === 200),
            { pools, events, totals: { hits: got.hits, misses: got.misses, long: got.long, upstream: got.upstream, uptimeS: got.uptimeS }, upstreamCalls });
    } finally {
        close();
    }
}

// 12b. The cache survives a restart: saved on stop, loaded by a new cache without the expired answers.
// A corrupt file means starting empty.
{
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gql-cache-'));
    const file = path.join(dir, 'gql-cache.json');
    reply = (q, v) => queryName(q) === 'PoolSets' ? { status: 200, body: { data: { phaseGroup: { sets: { nodes: [{ id: v.id, state: v.id === 1 ? 3 : 2 }] } } } } }
        : { status: 200, body: { data: { ok: true } } };
    try {
        const first = await serve({ file });
        await first.ask(...sets(1));            // finished: 6 hours
        await first.ask(...sets(2));            // live: 15 s
        await first.ask(...players('saved'));   // 5 minutes
        first.close();                          // stop saves the file
        const savedOk = fs.existsSync(file) && JSON.parse(fs.readFileSync(file, 'utf8')).entries.length === 3;

        clock += 60_000;
        upstreamCalls = 0;
        const second = await serve({ file });
        const loaded = second.cache.report().persist.loaded;
        const finishedHit = await second.ask(...sets(1));
        const playersHit = await second.ask(...players('saved'));
        const liveMiss = await second.ask(...sets(2));
        second.close();
        check('a new cache loads the saved answers: still-fresh ones are HITs, expired ones dropped',
            savedOk && loaded === 2 && finishedHit.cache === 'HIT' && playersHit.cache === 'HIT' && liveMiss.cache === 'MISS' && upstreamCalls === 1,
            { savedOk, loaded, finished: finishedHit.cache, players: playersHit.cache, live: liveMiss.cache, upstreamCalls });

        fs.writeFileSync(file, '{"version":1,"entries":[["abc", 1, 2, "x", "y"],');
        const third = await serve({ file });
        const afterCorrupt = await third.ask(...sets(1));
        const thirdSize = third.cache.size().entries;
        third.close();
        const noFile = await serve({ file: path.join(dir, 'missing', 'gql-cache.json') });
        const fromNothing = await noFile.ask(...sets(1));
        noFile.close();
        const createdDir = fs.existsSync(path.join(dir, 'missing', 'gql-cache.json'));
        check('a corrupt or missing file starts an empty cache that works, and saving makes the folder',
            afterCorrupt.status === 200 && afterCorrupt.cache === 'MISS' && thirdSize === 1 && fromNothing.status === 200 && createdDir,
            { corrupt: afterCorrupt, thirdSize, missing: fromNothing.status, createdDir });
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
        reply = () => ({ status: 200, body: { data: { ok: true } } });
    }
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
