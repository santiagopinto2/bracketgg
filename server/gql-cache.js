// A shared cache in front of start.gg's GraphQL API, so viewers of the same bracket share one fetch.
//
// The browser posts { query, variables } to /api/gql. Only the app's own query texts are run
// (`allowed`, from src/app/services/startgg-queries.ts), so nobody can use this server to ask start.gg
// for anything else. `tokenFor` picks the token: a logged-in visitor's own, or the site's for everyone
// else, whose requests also pass through `siteGate` to stay under start.gg's rate limit. A fresh cached
// answer goes back at once, to logged-in visitors and others alike, since it's public data and costs
// start.gg nothing. Otherwise the server asks start.gg, and identical requests already on their way
// wait for that one answer. Only successful answers are kept, and the whole cache is capped in bytes,
// dropping the least recently used answers first.
//
// How long an answer is kept depends on what was asked (`ttlMs`: sets change during an event, entrant
// lists and tournament info rarely) and on the answer itself (`finished`): an answer that says it's
// about something finished is kept 6 hours (LONG_TTL_MS). Anything the rule doesn't recognize, a
// missing field, or an odd value counts as not finished and keeps the short time.
//
// With a `file` (GQL_CACHE_FILE, see proxy-server.js), the answers are saved to one JSON file every
// 5 minutes when something changed and when the server stops, and loaded at start without the expired
// ones, so a deploy doesn't empty the cache. A missing or unreadable file only means starting empty.
//
// `report()` gives the counts for /api/gql/stats: totals, and the same per query (by its operation name).

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const UPSTREAM = process.env.STARTGG_GQL_URL || 'https://api.start.gg/gql/alpha';
const MAX_BYTES = Number(process.env.GQL_CACHE_MAX_BYTES) || 64 * 1024 * 1024;
const MAX_ENTRY_BYTES = 4 * 1024 * 1024;
const MAX_QUERY_LENGTH = 20_000;
const MAX_VARIABLES = 120;
const MAX_STRING_LENGTH = 300;
const SAVE_EVERY_MS = 5 * 60_000;
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

// A query's GraphQL operation name ("query PoolSlices(...)" -> "PoolSlices"), for the stats and `finished`
function queryName(query) {
    return /^\s*query\s+(\w+)/.exec(query)?.[1] ?? 'unnamed';
}

const LONG_TTL_MS = 6 * 60 * 60_000;
const DAY_MS = 86_400_000;
// An event's ActivityState while it's being played
const IN_PLAY = new Set(['ACTIVE', 'READY', 'CALLED', 'QUEUED']);

// A set is finished when start.gg says completed (state 3), or it was a DQ with a winner. Preview
// sets (ids "preview_...", before a pool starts) never are.
const setFinished = set => !!set && typeof set === 'object' && !String(set.id ?? '').startsWith('preview')
    && (set.state === 3 || (set.displayScore === 'DQ' && set.winnerId != null));
// At least one set, and every one finished. A missing list (null) is not finished.
const allSetsFinished = sets => Array.isArray(sets) && sets.length > 0 && sets.every(setFinished);
const nodesOf = connection => (Array.isArray(connection?.nodes) ? connection.nodes : null);
// Aliased fields (s0, s1, … or e0, e1, …): their values, or null if there are none
const aliased = data => { const values = Object.values(data); return values.length ? values : null; };

// A tournament is over when its end (endAt, in seconds) has passed and every event it lists is
// completed, or when its end is more than a day past and none of its events is being played
// (an event can stay CREATED in a finished tournament).
function tournamentOver(tournament, nowMs) {
    if (!tournament || typeof tournament.endAt !== 'number') return false;
    const ended = nowMs - tournament.endAt * 1000;
    if (ended <= 0) return false;
    const events = tournament.events;
    if (events !== undefined && !Array.isArray(events)) return false;
    if (events?.length && events.every(event => event?.state === 'COMPLETED')) return true;
    return ended > DAY_MS && !(events ?? []).some(event => !event || IN_PLAY.has(event.state));
}

// Per query (by operation name): does this answer say everything in it is finished? Queries not
// listed here (PoolSeeds) keep their short time.
const FINISHED = {
    // Sets: every set in the answer completed
    PoolSets: data => allSetsFinished(nodesOf(data.phaseGroup?.sets)),
    // Every slice has sets, all finished: an empty slice may be a pool whose sets don't exist yet
    PoolSlices: data => { const slices = aliased(data); return !!slices && slices.every(slice => allSetsFinished(nodesOf(slice?.sets))); },
    SetScores: data => allSetsFinished(aliased(data)),
    SetDetails: data => setFinished(data.set),
    // Events: the event (every event asked for) completed
    EventPhases: data => data.event?.state === 'COMPLETED',
    EventOverview: data => data.event?.state === 'COMPLETED',
    TournamentResults: data => { const events = aliased(data); return !!events && events.every(event => event?.state === 'COMPLETED'); },
    // Phases: the phase completed
    Phase: data => data.phase?.state === 'COMPLETED',
    PhaseEntrants: data => data.phase?.state === 'COMPLETED',
    PhaseProgressions: data => data.phase?.state === 'COMPLETED',
    SeededAttendees: data => data.phase?.state === 'COMPLETED',
    // Tournaments: over (tournamentOver)
    Tournament: (data, nowMs) => tournamentOver(data.tournament, nowMs),
    TournamentLite: (data, nowMs) => tournamentOver(data.tournament, nowMs),
    Attendees: (data, nowMs) => tournamentOver(data.tournament, nowMs),
    // One attendee: every event they entered completed
    AttendeeDetails: data => { const entrants = data.participant?.entrants; return Array.isArray(entrants) && entrants.length > 0 && entrants.every(entrant => entrant?.event?.state === 'COMPLETED'); },
};

function finished(query, json, nowMs) {
    try {
        const name = queryName(query);
        const rule = Object.hasOwn(FINISHED, name) ? FINISHED[name] : null;
        return !!(rule && json?.data && typeof json.data === 'object' && rule(json.data, nowMs));
    } catch {
        return false;
    }
}

// How long an answer stays fresh: 6 hours when it's about something finished, otherwise by the query
function ttlFor(query, json, nowMs) {
    const ttl = ttlMs(query);
    return finished(query, json, nowMs) ? Math.max(ttl, LONG_TTL_MS) : ttl;
}

function createGqlCache({ allowed, tokenFor, siteGate = null, upstream = UPSTREAM, maxBytes = MAX_BYTES, now = () => Date.now(), fetchImpl = fetch, file = null, saveEveryMs = SAVE_EVERY_MS }) {
    const entries = new Map(); // key -> { at, ttl, name, body, bytes }; Map order is least recently used first
    const inFlight = new Map(); // key -> Promise<{ status, headers, body }>
    let bytes = 0;
    const stats = { hits: 0, misses: 0, shared: 0, upstream: 0, site: 0, busy: 0, refused: 0, long: 0 };
    const byQuery = {}; // operation name -> { hits, misses, shared, upstream, long }
    const startedAt = now();
    const persist = { enabled: !!file, loaded: 0, savedAt: null, saveErrors: 0 };
    let changes = 0; // answers stored since start; the file holds those up to `savedChanges`
    let savedChanges = 0;
    let stopped = false;

    const count = (name, field) => {
        const row = byQuery[name] ??= { hits: 0, misses: 0, shared: 0, upstream: 0, long: 0 };
        row[field]++;
    };

    const drop = key => {
        const entry = entries.get(key);
        if (!entry) return;
        bytes -= entry.bytes;
        entries.delete(key);
    };

    const store = (key, body, ttl, name, at = now()) => {
        const size = Buffer.byteLength(body);
        if (size > MAX_ENTRY_BYTES) return false;
        drop(key);
        entries.set(key, { at, ttl, name, body, bytes: size });
        bytes += size;
        changes++;
        for (const oldest of entries.keys()) {
            if (bytes <= maxBytes) break;
            drop(oldest);
        }
        return true;
    };

    const fresh = entry => now() - entry.at < entry.ttl;

    // The saved file: { version: 1, savedAt, entries: [[key, at, ttl, name, body], …] }, least recently
    // used first, written in pieces so a full cache isn't copied into one string
    function* fileChunks() {
        const snapshot = [...entries];
        let chunk = `{"version":1,"savedAt":${now()},"entries":[`;
        let first = true;
        for (const [key, entry] of snapshot) {
            if (!fresh(entry)) continue;
            chunk += (first ? '' : ',') + JSON.stringify([key, entry.at, entry.ttl, entry.name, entry.body]);
            first = false;
            if (chunk.length > 1 << 20) { yield chunk; chunk = ''; }
        }
        yield chunk + ']}\n';
    }

    let tmpCount = 0;
    const tmpName = () => `${file}.${process.pid}.${++tmpCount}.tmp`;
    const saveFailed = (tmp, error) => {
        if (!persist.saveErrors++) console.error(`gql-cache: could not save to ${file}: ${error.message}`);
        try { fs.unlinkSync(tmp); } catch { }
    };

    // Writes the file now, to a temporary file renamed over the old one (for stop)
    function saveSync() {
        if (!file || changes === savedChanges) return;
        const upTo = changes;
        const tmp = tmpName();
        try {
            fs.mkdirSync(path.dirname(file), { recursive: true });
            const fd = fs.openSync(tmp, 'w', 0o600);
            try { for (const chunk of fileChunks()) fs.writeSync(fd, chunk); } finally { fs.closeSync(fd); }
            fs.renameSync(tmp, file);
            savedChanges = upTo;
            persist.savedAt = now();
        } catch (error) {
            saveFailed(tmp, error);
        }
    }

    // The same without blocking requests (every `saveEveryMs`). A save that's still writing when the
    // server stops is abandoned: stop's own save is newer.
    let saving = null;
    async function save() {
        if (!file || saving || stopped || changes === savedChanges) return saving;
        const upTo = changes;
        const tmp = tmpName();
        saving = (async () => {
            let handle;
            try {
                await fs.promises.mkdir(path.dirname(file), { recursive: true });
                handle = await fs.promises.open(tmp, 'w', 0o600);
                for (const chunk of fileChunks()) await handle.write(chunk);
                await handle.close();
                handle = null;
                if (stopped) {
                    await fs.promises.unlink(tmp).catch(() => { });
                    return;
                }
                await fs.promises.rename(tmp, file);
                savedChanges = upTo;
                persist.savedAt = now();
            } catch (error) {
                await handle?.close().catch(() => { });
                saveFailed(tmp, error);
            }
        })().finally(() => { saving = null; });
        return saving;
    }

    // Loads a saved file, leaving out expired answers; anything wrong with it means starting empty
    function load() {
        if (!file) return;
        let saved;
        try {
            saved = JSON.parse(fs.readFileSync(file, 'utf8'));
            if (saved?.version !== 1 || !Array.isArray(saved.entries)) throw new Error('not a cache file');
        } catch (error) {
            console.log(`gql-cache: starting empty (${error.code === 'ENOENT' ? `no ${file} yet` : `could not read ${file}: ${error.message}`})`);
            return;
        }
        for (const row of saved.entries) {
            if (!Array.isArray(row)) continue;
            const [key, at, ttl, name, body] = row;
            if (typeof key !== 'string' || !/^[0-9a-f]{64}$/.test(key) || typeof body !== 'string') continue;
            if (!Number.isFinite(at) || !Number.isFinite(ttl) || ttl <= 0 || ttl > LONG_TTL_MS || at > now()) continue;
            if (fresh({ at, ttl })) store(key, body, ttl, typeof name === 'string' ? name : 'unnamed', at);
        }
        persist.loaded = entries.size;
        savedChanges = changes;
        console.log(`gql-cache: loaded ${persist.loaded} answers from ${file}`);
    }
    load();

    async function askOnce(query, variables, who) {
        stats.upstream++;
        count(queryName(query), 'upstream');
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

        const name = queryName(query);
        const key = crypto.createHash('sha256').update(query).update('\0').update(JSON.stringify(variables)).digest('hex');
        const cached = entries.get(key);
        if (cached && fresh(cached)) {
            entries.delete(key);
            entries.set(key, cached); // most recently used
            stats.hits++;
            count(name, 'hits');
            return res.set('x-cache', 'HIT').type('application/json').send(cached.body);
        }

        let pending = inFlight.get(key);
        if (pending) {
            stats.shared++;
            count(name, 'shared');
        } else {
            stats.misses++;
            count(name, 'misses');
            pending = askAs(query, variables, who).then(answer => {
                if (answer.status === 200) {
                    let json = null;
                    try { json = JSON.parse(answer.body); } catch { }
                    if (json && json.data && !json.errors?.length) {
                        const ttl = ttlFor(query, json, now());
                        if (store(key, answer.body, ttl, name) && ttl >= LONG_TTL_MS) {
                            stats.long++;
                            count(name, 'long');
                        }
                    }
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
        for (const [key, entry] of entries) if (!fresh(entry)) drop(key);
    }, 60_000);
    sweep.unref();

    const saver = file ? setInterval(save, saveEveryMs) : null;
    saver?.unref();

    const size = () => ({ entries: entries.size, bytes });

    // What /api/gql/stats shows: the totals as before, the time since start, and the counts per query
    const report = () => ({
        ...stats,
        ...size(),
        startedAt: new Date(startedAt).toISOString(),
        uptimeS: Math.round((now() - startedAt) / 1000),
        persist: { ...persist, savedAt: persist.savedAt && new Date(persist.savedAt).toISOString() },
        byQuery: structuredClone(byQuery),
    });

    // Stops the timers and saves the cache (when the server stops)
    function stop() {
        clearInterval(sweep);
        clearInterval(saver);
        stopped = true;
        saveSync();
    }

    return { handle, stats, report, size, save, stop };
}

module.exports = { createGqlCache, ttlMs, ttlFor, finished, queryName, checkVariables, LONG_TTL_MS };
