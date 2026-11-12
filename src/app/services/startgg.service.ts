import { Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { LoadingService } from './loading.service';
import { RequestGate } from './request-gate';
import { scoresFromDisplayScore } from './display-score';
import { MAX_SET_SCORES, SETS_PER_STANDING, entrantsQuery, eventOverviewQuery, phaseQuery, setScoresQuery, setsQuery, tournamentQuery } from './startgg-queries';

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
    // start.gg counted about 10 objects per set with scores read from displayScore, the pool's id and
    // no characters reported (a whole phase: 95 sets 951, 100 sets 1001, cap 1000; measured 2026-11-09). Sets with characters cost more, and a
    // refused page shrinks to fit.
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

    // Every set in a phase, all pools at once, sorted into a Map from pool id to that pool's sets.
    // start.gg returns each pool's sets in the same order as asking pool by pool, so the bracket
    // draws the same; a phase with many small pools takes far fewer requests.
    async getPhaseSetsByPool(phaseId, totalSets): Promise<Map<any, any[]>> {
        const nodes = await this.loadPages(`phase-sets:${phaseId}`, totalSets, this.setsPerPage, async (page, perPage) => {
            const data = await this.getSetsPaginated('phase', phaseId, page, perPage);
            return data?.phase?.sets?.nodes ?? [];
        });
        await this.fillScores(nodes);
        const byPool = new Map<any, any[]>();
        for (const { phaseGroup, ...set } of nodes) {
            if (!byPool.has(phaseGroup?.id)) byPool.set(phaseGroup?.id, []);
            byPool.get(phaseGroup?.id).push(set);
        }
        return byPool;
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

    getPhaseGroupSetsPaginated(phaseGroupId, page, setsPerPage): Promise<any> {
        return this.getSetsPaginated('phaseGroup', phaseGroupId, page, setsPerPage);
    }

    // One page of sets from a pool or a whole phase
    private getSetsPaginated(parent: 'phase' | 'phaseGroup', id, page, setsPerPage): Promise<any> {
        return this.query(setsQuery(parent), { id: Number(id), page, perPage: setsPerPage });
    }
}
