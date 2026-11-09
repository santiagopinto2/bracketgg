// Tests server/gql-cache.js against a fake start.gg, and once against the real one when STARTGG_TOKEN is set.
// Usage: node e2e/gql-cache.mjs   Prints a JSON report and exits 1 if a check fails.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const express = require('express');
const { createGqlCache } = require('../server/gql-cache.js');

const report = { checks: [] };
const check = (name, ok, detail) => report.checks.push({ name, ok: !!ok, detail });

// A fake start.gg: answers per query text, counts calls, can be slow
let upstreamCalls = 0;
let reply = () => ({ status: 200, body: { data: { ok: true } } });
const fakeFetch = async (url, init) => {
    upstreamCalls++;
    await new Promise(r => setTimeout(r, 50));
    const { status, body, headers = {} } = reply(JSON.parse(init.body).query, init.headers.authorization);
    return new Response(JSON.stringify(body), { status, headers });
};

let clock = 1_000_000;
const cache = createGqlCache({ fetchImpl: fakeFetch, now: () => clock, maxBytes: 4000 });
const app = express();
app.use(express.json());
app.post('/api/gql', cache.handle);
const server = await new Promise(r => { const s = app.listen(0, () => r(s)); });
const base = `http://localhost:${server.address().port}/api/gql`;

const post = async (query, token = 'Bearer viewer-a') => {
    const res = await fetch(base, { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: token } : {}) }, body: JSON.stringify({ query }) });
    return { status: res.status, cache: res.headers.get('x-cache'), retryAfter: res.headers.get('retry-after'), body: await res.json() };
};
const setsQuery = id => `query { phaseGroup(id: ${id}) { sets(page: 1 perPage: 55 sortType: ROUND) { nodes { id slots { entrant { id } } } } } }`;
const eventQuery = slug => `query { event(slug: "${slug}") { id name } }`;

try {
    // 1. The second viewer of the same thing gets the cached answer
    upstreamCalls = 0;
    const first = await post(eventQuery('a'), 'Bearer viewer-a');
    const second = await post(eventQuery('a'), 'Bearer viewer-b');
    check('a repeat query is served from the cache', first.cache === 'MISS' && second.cache === 'HIT' && upstreamCalls === 1 && second.body.data?.ok, { first, second, upstreamCalls });

    // 2. Identical requests at the same moment share one upstream call
    upstreamCalls = 0;
    const together = await Promise.all(Array.from({ length: 5 }, () => post(eventQuery('b'))));
    check('identical requests in flight share one call', upstreamCalls === 1 && together.every(r => r.status === 200), { upstreamCalls });

    // 3. GraphQL errors (like the object cap) are passed on, not cached
    upstreamCalls = 0;
    reply = () => ({ status: 200, body: { errors: [{ message: 'Your query complexity is too high.' }] } });
    const e1 = await post(eventQuery('c'));
    const e2 = await post(eventQuery('c'));
    check('errors are passed on and not cached', upstreamCalls === 2 && e1.body.errors && e2.cache === 'MISS', { e1, upstreamCalls });

    // 4. Rate limits pass through with Retry-After, not cached
    upstreamCalls = 0;
    reply = () => ({ status: 429, body: { message: 'Rate limit exceeded' }, headers: { 'retry-after': '7' } });
    const r1 = await post(eventQuery('d'));
    const r2 = await post(eventQuery('d'));
    check('429 passes through with Retry-After and is not cached', r1.status === 429 && r1.retryAfter === '7' && upstreamCalls === 2, { r1, r2 });
    reply = () => ({ status: 200, body: { data: { ok: true } } });

    // 5. No token, private data or mutations never reach start.gg
    upstreamCalls = 0;
    const noToken = await post(eventQuery('a'), null);
    const me = await post('query { currentUser { email } }');
    const mutation = await post('mutation { updatePhaseSeeding(phaseId: 1) { id } }');
    check('no token is 401; currentUser and mutations are refused', noToken.status === 401 && me.status === 400 && mutation.status === 400 && upstreamCalls === 0, { noToken: noToken.status, me: me.status, mutation: mutation.status });

    // 6. Set results go stale after 15 s; tournament info lasts 5 minutes
    upstreamCalls = 0;
    await post(setsQuery(1));
    await post(eventQuery('e'));
    clock += 16_000;
    const sets = await post(setsQuery(1));
    const event = await post(eventQuery('e'));
    clock += 5 * 60_000;
    const eventLater = await post(eventQuery('e'));
    check('sets refresh after 15 s, tournament info after 5 min', sets.cache === 'MISS' && event.cache === 'HIT' && eventLater.cache === 'MISS', { sets: sets.cache, event: event.cache, eventLater: eventLater.cache });

    // 7. The cache stays under its byte cap, dropping the least recently used
    const big = 'x'.repeat(900);
    reply = q => ({ status: 200, body: { data: { q, big } } });
    for (let i = 0; i < 10; i++) await post(eventQuery(`big${i}`));
    const { bytes, entries } = cache.size();
    const newest = await post(eventQuery('big9'));
    const oldest = await post(eventQuery('big0'));
    check('cache stays under its byte cap, dropping the oldest', bytes <= 4000 && newest.cache === 'HIT' && oldest.cache === 'MISS', { bytes, entries });
} finally {
    server.close();
    cache.stop();
}

// 8. The real start.gg, through the cache: one call, then a hit
if (process.env.STARTGG_TOKEN) {
    const live = createGqlCache();
    const liveApp = express();
    liveApp.use(express.json());
    liveApp.post('/api/gql', live.handle);
    const liveServer = await new Promise(r => { const s = liveApp.listen(0, () => r(s)); });
    try {
        const url = `http://localhost:${liveServer.address().port}/api/gql`;
        const ask = () => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.STARTGG_TOKEN}` },
            body: JSON.stringify({ query: 'query { event(slug: "tournament/tussle-thru-time/event/brawl-doubles") { id name } }' }) })
            .then(async res => ({ status: res.status, cache: res.headers.get('x-cache'), body: await res.json() }));
        const a = await ask();
        const b = await ask();
        check('live start.gg: answers, then serves the repeat from the cache', a.status === 200 && a.body.data?.event?.id && b.cache === 'HIT' && live.stats.upstream === 1,
            { first: { status: a.status, cache: a.cache, event: a.body.data?.event, errors: a.body.errors }, second: b.cache });
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
