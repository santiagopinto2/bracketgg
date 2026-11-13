import { Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { LoadingService } from './loading.service';
import { RequestGate } from './request-gate';
import { scoresFromDisplayScore } from './display-score';
import { MAX_POOL_SLICES, MAX_SET_SCORES, SETS_PER_STANDING, entrantsQuery, eventOverviewQuery, phaseQuery, poolSetsQuery, poolSlicesQuery, setScoresQuery, tournamentQuery } from './startgg-queries';

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
    private entrantsPerPage = 100;
    // A single pool's page size. Measured on a whole phase, whose sets also named their pool: about 10
    // objects per set with no characters reported (95 sets 951, 100 sets 1001, cap 1000; 2026-11-09).
    // A pool's own sets cost 9. Sets with characters cost more, and a refused page shrinks to fit.
    private setsPerPage = 95;
    // Sets asked for per entrant in the landing page's top 8, to find who they lost to. An entrant
    // with this many may have more, and then shows no losses.
    readonly setsPerStanding = SETS_PER_STANDING;

    // Tournament info and entrant lists rarely change during an event, so they are reused for
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

    // The whole event's entrants, reused for a few minutes. A changed entrant count makes a new key,
    // so a late registration or a removed entrant shows up on the next tournament refresh.
    getEventBySlug(eventSlug, totalEntrants): Promise<any> {
        return this.cached(`event:${eventSlug}:${totalEntrants}`, async () => {
            let event;
            const nodes = await this.loadPages(`event:${eventSlug}`, totalEntrants, this.entrantsPerPage, async (page, perPage) => {
                const data = await this.getEventBySlugPaginated(eventSlug, page, perPage);
                if (!data?.event) throw new StartggError('Event not found on start.gg.');
                if (page == 1) event = data.event;
                return data.event.entrants.nodes;
            });
            event.entrants.nodes = nodes;
            return event;
        });
    }

    getEventBySlugPaginated(eventSlug, page, entrantsPerPage): Promise<any> {
        return this.query(entrantsQuery, { slug: String(eventSlug), page, perPage: entrantsPerPage });
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

    // One page of sets from a pool
    getPhaseGroupSetsPaginated(phaseGroupId, page, setsPerPage): Promise<any> {
        return this.query(poolSetsQuery, { id: Number(phaseGroupId), page, perPage: setsPerPage });
    }
}
