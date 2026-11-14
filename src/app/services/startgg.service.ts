import { Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { LoadingService } from './loading.service';
import { RequestGate } from './request-gate';
import { scoresFromDisplayScore } from './display-score';
import { MAX_POOL_SLICES, MAX_SET_SCORES, SETS_PER_STANDING, attendeeDetailsQuery, attendeesQuery, eventOverviewQuery, eventPhasesQuery, phaseEntrantsQuery, phaseProgressionsQuery, phaseQuery, poolSetsQuery, poolSlicesQuery, seededAttendeesQuery, setDetailsQuery, setScoresQuery, tournamentQuery } from './startgg-queries';

// A failed start.gg request, with a message fit to show the user.
export class StartggError extends Error { }

// start.gg refused a query for asking for more than 1000 objects. `actual` is the count it gave, if any.
export class TooComplexError extends StartggError {
    constructor(message: string, public actual: number | null) { super(message); }
}

@Injectable({
    providedIn: 'root'
})
export class StartggService {

    // start.gg's GraphQL API, through this site's server, which shares answers between viewers
    private baseUrl: string = '/api/gql';
    // A phase's players cost about 3 objects each and two-player teams 5 (measured 2026-11-13), so 300
    // players or 190 teams fit under the 1000-object cap. Bigger teams cost more: a refused page shrinks to fit.
    private playersPerPage = 300;
    private teamsPerPage = 190;
    // A single pool's page size. Measured on a whole phase, whose sets also named their pool: about 10
    // objects per set with no characters reported (95 sets 951, 100 sets 1001, cap 1000; 2026-11-09).
    // A pool's own sets cost 9. Sets with characters cost more, and a refused page shrinks to fit.
    private setsPerPage = 95;
    // Sets asked for per entrant in the landing page's top 8, to find who they lost to. An entrant
    // with this many may have more, and then shows no losses.
    readonly setsPerStanding = SETS_PER_STANDING;

    // Tournament info and player lists rarely change during an event, so they are reused for
    // a few minutes. Sets are never cached, so brackets stay live.
    private cacheMs = 5 * 60_000;
    private cache = new Map<string, { at: number, value: any }>();
    private inFlight = new Map<string, Promise<any>>();
    private gate = new RequestGate();
    private maxRateLimitRetries = 4;
    private rateLimitBackoffMs = 5_000;
    // Page sizes that start.gg accepted after a smaller retry, by event or pool
    private pageSizes = new Map<string, number>();
    // A multi-pool phase loads in pool slices (getPhaseSetsByPool): `sliceSize` sets a slice, requests of
    // up to `requestCost` objects. From a pool, start.gg counted 9 objects per set with no characters
    // reported and 1 per slice (Genesis X Melee R1 Pools: 40 sets in one slice cost 361, in eight
    // slices of 5 cost 368; measured 2026-11-13). Sets with characters cost more: a refused request
    // raises the cost per set, remembered by phase in `sliceCosts`.
    private sliceSize = 5;
    private objectsPerPoolSet = 9;
    private requestCost = 980;
    private sliceCosts = new Map<string, { perSet: number, size: number }>();

    constructor(
        private http: HttpClient,
        private loadingService: LoadingService
    ) { }

    // Sends a query (one of startgg-queries.ts's texts) and returns its `data`. Identical requests already
    // on their way share one request. The server adds the start.gg token: the visitor's own if they
    // logged in, otherwise the site's.
    private query(query: string, variables: Record<string, any>): Promise<any> {
        const key = query + JSON.stringify(variables);
        let pending = this.inFlight.get(key);
        if (!pending) {
            pending = this.send(query, variables).finally(() => this.inFlight.delete(key));
            this.inFlight.set(key, pending);
        }
        return pending;
    }

    private async send(query: string, variables: Record<string, any>): Promise<any> {
        for (let attempt = 0; ; attempt++) {
            let res: any;
            try {
                res = await this.gate.run(() => firstValueFrom(this.http.post<any>(this.baseUrl, { query, variables })));
            } catch (error) {
                if (!(error instanceof HttpErrorResponse)) throw error;
                if (this.isSiteBusy(error.status, error.error)) {
                    this.waitOutSiteBusy(attempt, error.headers?.get('Retry-After'));
                    continue;
                }
                if (!this.isRateLimited(error.status, error.error)) throw new StartggError(this.describeHttpError(error));
                this.waitOutRateLimit(attempt, error.headers?.get('Retry-After'));
                continue;
            }

            if (this.isRateLimited(200, res)) {
                this.waitOutRateLimit(attempt, null);
                continue;
            }
            if (res?.errors?.length) {
                const message = `start.gg error: ${res.errors[0].message}`;
                if (!/complexity|1000 objects/i.test(message)) throw new StartggError(message);
                const actual = Number(message.match(/actual: (\d+)/)?.[1]);
                throw new TooComplexError(message, actual > 0 ? actual : null);
            }
            return res.data;
        }
    }

    // The site's own start.gg token, which visitors who aren't logged in share, is at its limit (server/site-gate.js)
    private isSiteBusy(status: number, body: any): boolean {
        return status === 503 && body?.errors?.[0]?.extensions?.code === 'SITE_BUSY';
    }

    private waitOutSiteBusy(attempt: number, retryAfter: string | null) {
        if (attempt >= this.maxRateLimitRetries) throw new StartggError('BracketGG is busy. Try again in a few seconds, or log in with start.gg to skip the wait.');
        const delayMs = Math.min(30, Math.max(1, Number(retryAfter) || 5)) * 1000 + Math.random() * 1000;
        this.gate.pause(delayMs);
        this.loadingService.notice(`BracketGG is busy, retrying in ${Math.ceil(delayMs / 1000)} s. Log in with start.gg to skip the wait.`);
    }

    private isRateLimited(status: number, body: any): boolean {
        if (status === 429) return true;
        const messages = [body?.message, ...(body?.errors ?? []).map((e: any) => e?.message)];
        return messages.some(m => typeof m === 'string' && /rate limit/i.test(m));
    }

    // Pauses every start.gg request (not only this one) for a growing delay, then lets the caller retry.
    private waitOutRateLimit(attempt: number, retryAfter: string | null) {
        if (attempt >= this.maxRateLimitRetries) throw new StartggError('start.gg is rate limiting this page. Wait a minute, then reload.');
        const retryAfterMs = Number(retryAfter) * 1000;
        const delayMs = retryAfterMs > 0 ? retryAfterMs : this.rateLimitBackoffMs * 2 ** attempt + Math.random() * 1000;
        this.gate.pause(delayMs);
        this.loadingService.notice(`start.gg is busy, retrying in ${Math.ceil(delayMs / 1000)} s...`);
    }

    private describeHttpError(error: HttpErrorResponse): string {
        if (error.status === 0) return 'Could not reach start.gg. Check your connection and reload.';
        if (error.status === 401) return 'Log in with start.gg to load this page.';
        return `start.gg returned an error (${error.status}). Try again in a moment.`;
    }

    // Loads `total` items in pages of `perPage`. Sets with characters reported (more so best of 5 and
    // doubles) can pass start.gg's 1000-object cap. When a page does, this shrinks the page size to fit
    // the count start.gg gave (or halves it), tries again, and remembers the size that worked under `key`.
    private async loadPages(key: string, total: number, perPage: number, loadPage: (page: number, perPage: number) => Promise<any[]>): Promise<any[]> {
        perPage = Math.min(perPage, this.pageSizes.get(key) ?? perPage);
        for (; ;) {
            try {
                // The first page alone tests the size, so a refused size wastes one request, not a whole batch
                const first = await loadPage(1, perPage);
                const numberOfPages = Math.max(1, Math.ceil(total / perPage));
                const rest = await Promise.all(Array.from({ length: numberOfPages - 1 }, (_, i) => loadPage(i + 2, perPage)));
                this.pageSizes.set(key, perPage);
                return [first, ...rest].flat();
            } catch (error) {
                if (!(error instanceof TooComplexError) || perPage <= 1) throw error;
                perPage = error.actual
                    ? Math.max(1, Math.min(perPage - 1, Math.floor(perPage * 980 / error.actual)))
                    : Math.floor(perPage / 2);
            }
        }
    }

    // Returns a copy of a cached value, loading it if it's missing or older than cacheMs.
    // Callers change the objects they get, so they never share them.
    private async cached<T>(key: string, load: () => Promise<T>): Promise<T> {
        const hit = this.cache.get(key);
        if (hit && Date.now() - hit.at < this.cacheMs) return structuredClone(hit.value);
        const value = await load();
        this.cache.set(key, { at: Date.now(), value });
        return structuredClone(value);
    }

    getTournamentEvents(tourneySlug): Promise<any> {
        return this.cached(`tournament:${tourneySlug}`, async () => {
            const data = await this.query(tournamentQuery, { slug: String(tourneySlug) });
            if (!data?.tournament) throw new StartggError('Tournament not found on start.gg.');
            return data.tournament;
        });
    }

    // The event's id, name and phases, each with its seed count, reused for a few minutes. A changed
    // entrant count (from the tournament) makes a new key, so new seed counts show up with it.
    getEventPhases(eventSlug, numEntrants): Promise<any> {
        return this.cached(`event:${eventSlug}:${numEntrants}`, async () => {
            const data = await this.query(eventPhasesQuery, { slug: String(eventSlug) });
            if (!data?.event) throw new StartggError('Event not found on start.gg.');
            return data.event;
        });
    }

    // A bracket phase's players (each seed's entrant, with their profile pictures), reused for a few
    // minutes. A changed seed count makes a new key, so a late registration or a removed entrant shows
    // up on the next refresh. `singles` picks the page size.
    getPhaseEntrants(phaseId, numSeeds, singles = true): Promise<any[]> {
        return this.cached(`players:${phaseId}:${numSeeds}`, async () => {
            const perPage = singles ? this.playersPerPage : this.teamsPerPage;
            const seeds = await this.loadPages(`players:${phaseId}`, Number(numSeeds) || 0, perPage, async (page, perPage) => {
                const data = await this.query(phaseEntrantsQuery, { phaseId: Number(phaseId), page, perPage });
                return data?.phase?.seeds?.nodes ?? [];
            });
            return seeds.map(seed => seed?.entrant).filter(entrant => entrant?.id != null);
        });
    }

    // The seeds of a phase that takes players from an earlier one, each with the pool and placement it
    // comes from, the pool it plays in and its entrant once placed. Never cached here, so a player
    // shows up soon after start.gg places them. `expected` is how many seeds the phase should have;
    // start.gg can have more, so pages are asked for until one comes back short.
    private seedsPerPage = 240;
    async getPhaseProgressions(phaseId, expected): Promise<any[]> {
        const loadPage = async (page: number, perPage: number) => {
            const data = await this.query(phaseProgressionsQuery, { phaseId: Number(phaseId), page, perPage });
            return data?.phase?.seeds?.nodes ?? [];
        };
        const key = `progressions:${phaseId}`;
        const seeds = await this.loadPages(key, Number(expected) || 0, this.seedsPerPage, loadPage);
        const perPage = this.pageSizes.get(key) ?? this.seedsPerPage;
        // More seeds than expected: keep going, up to 20 pages more
        for (let page = Math.max(1, Math.ceil((Number(expected) || 0) / perPage)) + 1, extra = 0; seeds.length >= (page - 1) * perPage && extra < 20; page++, extra++) {
            const more = await loadPage(page, perPage);
            seeds.push(...more);
            if (more.length < perPage) break;
        }
        return seeds;
    }

    // The Attendees page loads this many rows at a time as the visitor scrolls. An attendee costs about
    // 11 objects from the tournament's list and a singles seed up to 18, so 50 fit in one request
    // (startgg-queries.ts has the measurements). A team's seed costs about 16 per player: teams load 25
    // seeds at a time, 50 rows of a doubles event. A page start.gg refuses for its size shrinks to fit.
    readonly attendeesPerPage = 50;
    private teamSeedsPerPage = 25;

    // The next slice of a list that loads as the visitor scrolls: the items from `offset` on, about
    // `size` of them. `loadPage` asks for one page. A page start.gg refuses for its size is asked for
    // again smaller, and the smaller size is remembered under `key`; the page that holds `offset` at
    // that size starts earlier, so the items already loaded are dropped from it.
    private async loadSlice(key: string, offset: number, size: number, loadPage: (page: number, perPage: number) => Promise<any>): Promise<{ nodes: any[], total: number, done: boolean }> {
        let perPage = Math.min(size, this.pageSizes.get(key) ?? size);
        for (; ;) {
            try {
                const connection = await loadPage(Math.floor(offset / perPage) + 1, perPage);
                const all: any[] = connection?.nodes ?? [];
                const nodes = all.slice(offset % perPage);
                const total = Number(connection?.pageInfo?.total) || 0;
                this.pageSizes.set(key, perPage);
                return { nodes, total, done: all.length < perPage || offset + nodes.length >= total };
            } catch (error) {
                if (!(error instanceof TooComplexError) || perPage <= 1) throw error;
                perPage = error.actual
                    ? Math.max(1, Math.min(perPage - 1, Math.floor(perPage * 980 / error.actual)))
                    : Math.floor(perPage / 2);
            }
        }
    }

    // A tournament's attendees from `offset` on, in player id order: everyone, or only those whose tag
    // matches `search`, or only those in the event `eventId`. `total` counts all that match.
    getAttendees(tourneySlug, offset: number, { search = '', eventId = null }: { search?: string, eventId?: any } = {}): Promise<{ nodes: any[], total: number, done: boolean }> {
        const slug = String(tourneySlug);
        const variables = { slug, ...this.searchVariable(search), ...(eventId ? { eventId: Number(eventId) } : {}) };
        return this.loadSlice(`attendees:${slug}:${eventId ?? ''}`, offset, this.attendeesPerPage, async (page, perPage) => {
            const data = await this.query(attendeesQuery(!!eventId), { ...variables, page, perPage });
            if (!data?.tournament) throw new StartggError('Tournament not found on start.gg.');
            return data.tournament.participants;
        });
    }

    // A phase's seeds from `offset` on, in seed order, each with its entrant's players. With `search`,
    // only the seeds of players whose tag matches, in start.gg's own order. `total` counts seeds, so
    // teams in a teams event.
    getSeededAttendees(phaseId, offset: number, { search = '', teams = false }: { search?: string, teams?: boolean } = {}): Promise<{ nodes: any[], total: number, done: boolean }> {
        const variables = { phaseId: Number(phaseId), ...this.searchVariable(search) };
        return this.loadSlice(`seeded-attendees:${phaseId}`, offset, teams ? this.teamSeedsPerPage : this.attendeesPerPage, async (page, perPage) => {
            const data = await this.query(seededAttendeesQuery, { ...variables, page, perPage });
            if (!data?.phase) throw new StartggError('Bracket phase not found on start.gg.');
            return data.phase.seeds;
        });
    }

    // The server takes only plain values as variables, so no search leaves the variable out
    private searchVariable(search: string): { search?: string } {
        const text = String(search ?? '').trim().slice(0, 100);
        return text ? { search: text } : {};
    }

    // An attendee's event entries, each with its seed, placement, teammates, and phases (the attendee
    // dialog), reused for a few minutes.
    getAttendeeDetails(participantId): Promise<any[]> {
        return this.cached(`attendee:${participantId}`, async () => {
            const data = await this.query(attendeeDetailsQuery, { id: Number(participantId) });
            if (!data?.participant) throw new StartggError('Attendee not found on start.gg.');
            return data.participant.entrants ?? [];
        });
    }

    // What the event's landing page shows, in one request: the header, every phase with its pool count,
    // and the top 8 with who each lost to and, for a singles event, each player's socials and rankings.
    // `videogameId` (from the tournament's event list) picks the rankings for the event's game. A huge
    // event can pass the 1000-object cap, so a refused query is asked again with less: first without
    // socials and rankings, then also without the sets that tell the losses.
    getEventOverview(eventSlug, videogameId: any = null, singles = true): Promise<any> {
        return this.cached(`overview:${eventSlug}`, async () => {
            const slug = String(eventSlug);
            const rankings = singles && Number(videogameId) > 0;
            const variants = [
                { lostTo: true, rankings, socials: singles },
                { lostTo: true, rankings: false, socials: false },
                { lostTo: false, rankings: false, socials: false },
            ].filter((v, i, all) => all.findIndex(w => JSON.stringify(w) === JSON.stringify(v)) === i);
            let data;
            for (const [i, variant] of variants.entries()) {
                try {
                    data = await this.query(eventOverviewQuery(variant), variant.rankings ? { slug, videogameId: Number(videogameId) } : { slug });
                    break;
                } catch (error) {
                    if (!(error instanceof TooComplexError) || i == variants.length - 1) throw error;
                }
            }
            if (!data?.event) throw new StartggError('Event not found on start.gg.');
            return data.event;
        });
    }

    async getPhase(phaseId): Promise<any> {
        const data = await this.query(phaseQuery, { phaseId: Number(phaseId) });
        if (!data?.phase) throw new StartggError('Bracket phase not found on start.gg.');
        return data.phase;
    }

    async getPhaseGroupSets(phaseGroupId, totalSets): Promise<any> {
        const nodes = await this.loadPages(`sets:${phaseGroupId}`, totalSets, this.setsPerPage, async (page, perPage) => {
            const data = await this.getPhaseGroupSetsPaginated(phaseGroupId, page, perPage);
            return data?.phaseGroup?.sets?.nodes ?? [];
        });
        await this.fillScores(nodes);
        return { nodes };
    }

    // Every set of a multi-pool phase, pool after pool, for drawing each pool as soon as its sets are in.
    // `expected` is each pool's set count (from the phase query), in the order the pools are shown.
    //
    // Each request carries a run of pool slices (poolSlicesQuery): pages of `sliceSize` sets from one
    // pool, filled up to about `requestCost` of start.gg's objects. So a request holds, say, the end of
    // pool 2, all of pool 3 and the start of pool 4, and every pool is complete after one or two
    // requests. start.gg counts only the objects it returns, so the half-empty last slice of a pool costs
    // nothing extra. Each pool gets one slice past its expected count: if that slice comes back full, the
    // pool has gained sets since the phase query, and its next page is asked for too, so none are missed.
    //
    // Pools go to `onPool` in order, each once, with its sets in the same order as asking the pool alone.
    // The first request goes alone and tests the cost. A request start.gg refuses for its size raises
    // the cost per set to what start.gg counted, and its slices are asked for again in smaller requests;
    // slices that already arrived are kept, so no pool is passed on twice.
    async getPhaseSetsByPool(phaseId, expected: Map<any, number>, onPool: (poolId: any, sets: any[]) => void): Promise<void> {
        const key = `pool-slices:${phaseId}`;
        let { perSet, size } = this.sliceCosts.get(key) ?? { perSet: this.objectsPerPoolSet, size: this.sliceSize };
        const pools = [...expected.keys()];
        const total = (pool: any) => Math.max(0, Number(expected.get(pool)) || 0);
        // Each pool's slices that came in, by page, and how many pages it needs
        const slices = new Map<any, Map<number, any[]>>();
        const pages = new Map<any, number>();
        const restart = (pool: any) => {
            slices.set(pool, new Map());
            pages.set(pool, Math.floor(total(pool) / size) + 1);
        };
        pools.forEach(restart);
        // The sets a slice should hold: a full slice past the pool's expected count, since it is only
        // asked for when the pool has gained sets
        const setsIn = (pool: any, page: number) => (page - 1) * size > total(pool) ? size : Math.min(size, total(pool) - (page - 1) * size);
        // Pools before `next` have been passed on
        let next = 0;
        const passOn = () => {
            while (next < pools.length) {
                const pool = pools[next];
                const got = slices.get(pool), needed = pages.get(pool);
                if (got.size < needed) return;
                if (got.get(needed).length >= size) {
                    pages.set(pool, needed + 1);
                    return;
                }
                onPool(pool, structuredClone(Array.from({ length: needed }, (_, i) => got.get(i + 1)).flat()));
                next++;
            }
        };

        while (next < pools.length) {
            // The slices still to ask for, pool by pool, with the sets each should hold
            const missing = pools.slice(next).flatMap(pool => Array.from({ length: pages.get(pool) }, (_, i) => i + 1)
                .filter(page => !slices.get(pool).has(page))
                .map(page => ({ pool, page, sets: setsIn(pool, page) })));
            if (!missing.length) {
                passOn();
                continue;
            }
            const requests = this.packSlices(missing, perSet);
            const send = async (request: { pool: any, page: number, sets: number }[]) => {
                const variables: Record<string, any> = { perPage: size };
                request.forEach((slice, k) => {
                    variables[`g${k}`] = Number(slice.pool);
                    variables[`p${k}`] = slice.page;
                });
                const data = await this.query(poolSlicesQuery(request.length), variables);
                const nodes = request.map((_, k) => data?.[`s${k}`]?.sets?.nodes ?? []);
                await this.fillScores(nodes.flat());
                request.forEach((slice, k) => slices.get(slice.pool)?.set(slice.page, nodes[k]));
                passOn();
            };
            const settle = (request: any[]) => send(request).then(() => null, error => ({ error, request }));
            const first = await settle(requests[0]);
            const refused = first ? [first] : (await Promise.all(requests.slice(1).map(settle))).filter(r => r);
            if (!refused.length) continue;

            const failed = refused.find(r => !(r.error instanceof TooComplexError));
            if (failed) throw failed.error;
            const oldSize = size;
            for (const { error, request } of refused) {
                const sets = request.reduce((n, slice) => n + slice.sets, 0);
                if (request.length === 1 && size === 1) throw error;
                // start.gg's count, less one object per slice, spread over the sets asked for
                const counted = error.actual && sets ? Math.ceil((error.actual - request.length) / sets) : perSet * 2;
                perSet = Math.max(perSet + 1, counted);
            }
            // A slice must fit in a request on its own. A smaller slice moves every page boundary, so the
            // pools not passed on yet start over.
            size = Math.max(1, Math.min(size, Math.floor((this.requestCost - 1) / perSet)));
            if (size !== oldSize) pools.slice(next).forEach(restart);
        }
        this.sliceCosts.set(key, { perSet, size });
    }

    // Groups slices, in order, into requests of at most `requestCost` estimated objects (each slice
    // costs one, each set `perSet`) and MAX_POOL_SLICES slices. A request always takes at least one slice.
    private packSlices<T extends { sets: number }>(slices: T[], perSet: number): T[][] {
        const requests: T[][] = [];
        let request: T[] = [], cost = 0;
        for (const slice of slices) {
            const sliceCost = 1 + perSet * slice.sets;
            if (request.length && (cost + sliceCost > this.requestCost || request.length >= MAX_POOL_SLICES)) {
                requests.push(request);
                request = [];
                cost = 0;
            }
            request.push(slice);
            cost += sliceCost;
        }
        if (request.length) requests.push(request);
        return requests;
    }

    // Gives each slot the `standing.stats.score.value` the rest of the app reads, from the set's
    // displayScore. Sets whose text can't be read (an odd name, say) get their scores asked for the
    // old way, all in one request per 100 sets, so a score is never guessed.
    private async fillScores(sets: any[]) {
        const unread = [];
        for (const set of sets) {
            const scores = scoresFromDisplayScore(set);
            if (scores) set.slots.forEach((slot, i) => slot.standing = { stats: { score: { value: scores[i] } } });
            else if (set.displayScore == null && !set.winnerId) set.slots.forEach(slot => slot.standing = null); // not played yet
            else unread.push(set);
        }
        for (let i = 0; i < unread.length; i += MAX_SET_SCORES) {
            const chunk = unread.slice(i, i + MAX_SET_SCORES);
            const variables = Object.fromEntries(chunk.map((set, k) => [`id${k}`, String(set.id)]));
            // A failure here only costs those sets their numbers; the winner still shows
            const data = await this.query(setScoresQuery(chunk.length), variables).catch(error => { console.warn('Could not load scores', error); return null; });
            chunk.forEach((set, k) => set.slots.forEach((slot, j) => slot.standing = data?.[`s${k}`]?.slots?.[j]?.standing ?? null));
        }
    }

    // What the set dialog adds when it opens: the stream the set was on and its players' X and Twitch
    // accounts, as start.gg's set (or null if it has none). Reused for a few minutes.
    getSetDetails(setId): Promise<any> {
        return this.cached(`set-details:${setId}`, async () => (await this.query(setDetailsQuery, { id: String(setId) }))?.set ?? null);
    }

    // One page of sets from a pool
    getPhaseGroupSetsPaginated(phaseGroupId, page, setsPerPage): Promise<any> {
        return this.query(poolSetsQuery, { id: Number(phaseGroupId), page, perPage: setsPerPage });
    }
}
