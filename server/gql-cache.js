// A shared cache in front of start.gg's GraphQL API, so viewers of the same bracket share one fetch.
//
// The browser posts { query, variables } to /api/gql. Only the app's own query texts are run
// (`allowed`, from src/app/services/startgg-queries.ts), so nobody can use this server to ask start.gg
// for anything else. `tokenFor` picks the token: a logged-in visitor's own, or the site's for everyone
// else, whose requests also pass through `siteGate` to stay under start.gg's rate limit. A fresh cached
// answer goes back at once, to logged-in visitors and others alike, since it's public data and costs
// start.gg nothing. Otherwise the server asks start.gg, and identical requests already on their way
// wait for that one answer. Only successful answers are kept, for a time that
// depends on what was asked (sets change during an event, entrant lists and tournament info rarely),
// and the whole cache is capped in bytes, dropping the least recently used answers first.
// Everything lives in memory; a restart empties it.

const crypto = require('crypto');

const UPSTREAM = process.env.STARTGG_GQL_URL || 'https://api.start.gg/gql/alpha';
const MAX_BYTES = Number(process.env.GQL_CACHE_MAX_BYTES) || 64 * 1024 * 1024;
const MAX_ENTRY_BYTES = 4 * 1024 * 1024;
const MAX_QUERY_LENGTH = 20_000;
const MAX_VARIABLES = 120;
const MAX_STRING_LENGTH = 300;
const { SiteBusyError } = require('./site-gate');

// Variables are only plain values: strings, numbers and booleans
function checkVariables(variables) {
    if (variables === undefined || variables === null) return {};
    if (typeof variables !== 'object' || Array.isArray(variables)) return null;
    const entries = Object.entries(variables);
    if (entries.length > MAX_VARIABLES) return null;
    for (const [name, value] of entries) {
        if (!/^\w{1,40}$/.test(name)) return null;
        if (typeof value === 'string' ? value.length > MAX_STRING_LENGTH : typeof value === 'number' ? !Number.isFinite(value) : typeof value !== 'boolean') return null;
    }
    return Object.fromEntries(entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

// How long an answer stays fresh, by what the query asks for
function ttlMs(query) {
    if (/\bset\s*\(/.test(query) && /\bauthorizations\b/.test(query)) return 5 * 60_000; // a set's stream and its players' accounts
    if (/\bsets?\s*\(/.test(query) && /\bslots\b/.test(query)) return 15_000; // set results: live
    if (/\bphaseGroups\s*\(/.test(query)) return 60_000;                       // a phase's pools
    if (/\bprogressionSource\b/.test(query)) return 60_000;                    // who start.gg has placed in the next phase
    return 5 * 60_000;                                                           // tournament, entrants
}

function createGqlCache({ allowed, tokenFor, siteGate = null, upstream = UPSTREAM, maxBytes = MAX_BYTES, now = () => Date.now(), fetchImpl = fetch }) {
    const entries = new Map(); // key -> { at, ttl, body, bytes }; Map order is least recently used first
    const inFlight = new Map(); // key -> Promise<{ status, headers, body }>
    let bytes = 0;
    const stats = { hits: 0, misses: 0, shared: 0, upstream: 0, site: 0, busy: 0, refused: 0 };

    const drop = key => {
        const entry = entries.get(key);
        if (!entry) return;
        bytes -= entry.bytes;
        entries.delete(key);
    };

    const store = (key, body, ttl) => {
        const size = Buffer.byteLength(body);
        if (size > MAX_ENTRY_BYTES) return;
        drop(key);
        entries.set(key, { at: now(), ttl, body, bytes: size });
        bytes += size;
        for (const oldest of entries.keys()) {
            if (bytes <= maxBytes) break;
            drop(oldest);
        }
    };

    async function askOnce(query, variables, who) {
        stats.upstream++;
        if (who.kind === 'site') stats.site++;
        const res = await fetchImpl(upstream, {
            method: 'POST',
            headers: { 'content-type': 'application/json', authorization: who.authorization },
            body: JSON.stringify({ query, variables }),
            signal: AbortSignal.timeout(30_000),
        });
        const body = await res.text();
        const headers = {};
        const retryAfter = res.headers.get('retry-after');
        if (retryAfter) headers['retry-after'] = retryAfter;
        if (res.status === 429 && who.kind === 'site') siteGate?.pause((Number(retryAfter) || 10) * 1000);
        return { status: res.status, headers, body };
    }

    // Requests with the site's token wait their turn at the gate
    const ask = (query, variables, who) =>
        who.kind === 'site' && siteGate ? siteGate.run(() => askOnce(query, variables, who)) : askOnce(query, variables, who);

    // Asks start.gg; when it says the visitor's token is no good (401), retries once with the token
    // `onUnauthorized` gives (refreshed, or the site's when the session ended)
    async function askAs(query, variables, who) {
        const answer = await ask(query, variables, who);
        if (answer.status !== 401 || !who.onUnauthorized) return answer;
        const next = await who.onUnauthorized();
        return next ? ask(query, variables, next) : answer;
    }

    const fail = (res, status, message, extra = {}) => res.status(status).json({ errors: [{ message, ...extra }] });

    // Express handler for POST /api/gql
    async function handle(req, res) {
        const query = req.body?.query;
        if (typeof query !== 'string' || !query.trim() || query.length > MAX_QUERY_LENGTH)
            return fail(res, 400, 'Send a GraphQL query string.');
        if (/^\s*mutation\b/.test(query) || /\bcurrentUser\b/.test(query) || !allowed.has(query)) {
            stats.refused++;
            return fail(res, 400, "Only BracketGG's own queries go through this server.");
        }
        const variables = checkVariables(req.body?.variables);
        if (!variables) return fail(res, 400, 'Variables must be an object of plain values.');

        let who;
        try {
            who = await tokenFor(req, res);
        } catch (error) {
            console.error('session lookup failed:', error.message);
            return fail(res, 500, 'Something went wrong. Try again.');
        }
        if (!who) return fail(res, 401, 'Log in with start.gg to load this page.');

        const key = crypto.createHash('sha256').update(query).update('\0').update(JSON.stringify(variables)).digest('hex');
        const cached = entries.get(key);
        if (cached && now() - cached.at < cached.ttl) {
            entries.delete(key);
            entries.set(key, cached); // most recently used
            stats.hits++;
            return res.set('x-cache', 'HIT').type('application/json').send(cached.body);
        }

        let pending = inFlight.get(key);
        if (pending) stats.shared++;
        else {
            stats.misses++;
            pending = askAs(query, variables, who).then(answer => {
                if (answer.status === 200) {
                    let ok = false;
                    try { const json = JSON.parse(answer.body); ok = json && json.data && !json.errors?.length; } catch { }
                    if (ok) store(key, answer.body, ttlMs(query));
                }
                return answer;
            }).finally(() => inFlight.delete(key));
            inFlight.set(key, pending);
        }

        try {
            const answer = await pending;
            if (answer.status === 200 || answer.status === 429) {
                res.status(answer.status).set(answer.headers).set('x-cache', 'MISS').type('application/json').send(answer.body);
            } else {
                // start.gg's status, without its error page
                console.error(`start.gg answered HTTP ${answer.status}`);
                fail(res, answer.status === 401 ? 401 : answer.status >= 500 ? 502 : answer.status,
                    answer.status === 401 ? 'start.gg did not accept the login. Log in again.' : `start.gg returned an error (${answer.status}).`);
            }
        } catch (error) {
            if (error instanceof SiteBusyError) {
                stats.busy++;
                return res.set('retry-after', String(error.retryAfterS)).status(503)
                    .json({ errors: [{ message: error.message, extensions: { code: 'SITE_BUSY' } }] });
            }
            console.error('start.gg request failed:', error.message);
            fail(res, 502, 'Could not reach start.gg.');
        }
    }

    // Drops expired answers now and then, so memory follows what people are looking at
    const sweep = setInterval(() => {
        for (const [key, entry] of entries) if (now() - entry.at >= entry.ttl) drop(key);
    }, 60_000);
    sweep.unref();

    return { handle, stats, size: () => ({ entries: entries.size, bytes }), stop: () => clearInterval(sweep) };
}

module.exports = { createGqlCache, ttlMs, checkVariables };
