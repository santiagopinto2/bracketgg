// A shared cache in front of start.gg's GraphQL API, so viewers of the same bracket share one fetch.
//
// The browser posts { query } to /api/gql with its own start.gg token. A fresh cached answer goes
// back at once. Otherwise the server asks start.gg with that viewer's token, and identical requests
// already on their way wait for that one answer. Only successful answers are kept, for a time that
// depends on what was asked (sets change during an event, entrant lists and tournament info rarely),
// and the whole cache is capped in bytes, dropping the least recently used answers first.
// Everything lives in memory; a restart empties it.

const crypto = require('crypto');

const UPSTREAM = process.env.STARTGG_GQL_URL || 'https://api.start.gg/gql/alpha';
const MAX_BYTES = Number(process.env.GQL_CACHE_MAX_BYTES) || 64 * 1024 * 1024;
const MAX_ENTRY_BYTES = 4 * 1024 * 1024;
const MAX_QUERY_LENGTH = 20_000;

// How long an answer stays fresh, by what the query asks for
function ttlMs(query) {
    if (/\bsets?\s*\(/.test(query) && /\bslots\b/.test(query)) return 15_000; // set results: live
    if (/\bphaseGroups\s*\(/.test(query)) return 60_000;                       // a phase's pools
    return 5 * 60_000;                                                           // tournament, entrants
}

function createGqlCache({ upstream = UPSTREAM, maxBytes = MAX_BYTES, now = () => Date.now(), fetchImpl = fetch } = {}) {
    const entries = new Map(); // key -> { at, ttl, body, bytes }; Map order is least recently used first
    const inFlight = new Map(); // key -> Promise<{ status, headers, body }>
    let bytes = 0;
    const stats = { hits: 0, misses: 0, shared: 0, upstream: 0 };

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

    async function ask(query, authorization) {
        stats.upstream++;
        const res = await fetchImpl(upstream, {
            method: 'POST',
            headers: { 'content-type': 'application/json', authorization },
            body: JSON.stringify({ query }),
        });
        const body = await res.text();
        const headers = {};
        const retryAfter = res.headers.get('retry-after');
        if (retryAfter) headers['retry-after'] = retryAfter;
        return { status: res.status, headers, body };
    }

    // Express handler for POST /api/gql
    async function handle(req, res) {
        const query = req.body?.query;
        const authorization = req.get('authorization');
        if (typeof query !== 'string' || !query.trim() || query.length > MAX_QUERY_LENGTH)
            return res.status(400).json({ errors: [{ message: 'Send a GraphQL query string.' }] });
        if (/^\s*mutation\b/.test(query) || /\bcurrentUser\b/.test(query))
            return res.status(400).json({ errors: [{ message: 'Only public tournament data goes through this cache.' }] });
        if (!authorization || !/^Bearer \S+$/.test(authorization))
            return res.status(401).json({ errors: [{ message: 'Log in with start.gg first.' }] });

        const key = crypto.createHash('sha256').update(query).digest('hex');
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
            pending = ask(query, authorization).then(answer => {
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
            res.status(answer.status).set(answer.headers).set('x-cache', 'MISS').type('application/json').send(answer.body);
        } catch (error) {
            console.error('start.gg request failed:', error.message);
            res.status(502).json({ errors: [{ message: 'Could not reach start.gg.' }] });
        }
    }

    // Drops expired answers now and then, so memory follows what people are looking at
    const sweep = setInterval(() => {
        for (const [key, entry] of entries) if (now() - entry.at >= entry.ttl) drop(key);
    }, 60_000);
    sweep.unref();

    return { handle, stats, size: () => ({ entries: entries.size, bytes }), stop: () => clearInterval(sweep) };
}

module.exports = { createGqlCache, ttlMs };
