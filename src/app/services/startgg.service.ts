import { Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { AuthService } from './auth.service';
import { LoadingService } from './loading.service';
import { RequestGate } from './request-gate';

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
    // start.gg counts 18 objects per set when no characters are reported (52 sets: 950, 55: 1004,
    // cap 1000; measured 2026-11-09). Sets with characters cost more, and a refused page shrinks to fit.
    private setsPerPage = 52;

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
        private authService: AuthService,
        private loadingService: LoadingService
    ) { }

    getHeaders() {
        const token = this.authService.getAccessToken();

        if (!token) {
            this.authService.redirectToOAuthWithReturn();
            return new HttpHeaders({ 'Content-Type': 'application/json' });
        }

        return new HttpHeaders({
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        });
    }

    // Sends a query and returns its `data`. Identical queries already on their way share one request.
    private query(query: string): Promise<any> {
        let pending = this.inFlight.get(query);
        if (!pending) {
            pending = this.send(query).finally(() => this.inFlight.delete(query));
            this.inFlight.set(query, pending);
        }
        return pending;
    }

    private async send(query: string): Promise<any> {
        for (let attempt = 0; ; attempt++) {
            let res: any;
            try {
                res = await this.gate.run(() => firstValueFrom(this.http.post<any>(this.baseUrl, { query }, { headers: this.getHeaders() })));
            } catch (error) {
                if (!(error instanceof HttpErrorResponse)) throw error;
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
        if (error.status === 401) return 'Your start.gg login expired. Log in again.';
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
        const query = `query {
                tournament(slug: "${tourneySlug}") {
                    images {
                        url
                        type
                        width
                        height
                    }
                    rules
                    id
                    name
                    slug
                    venueAddress
                    startAt
                    primaryContact
                    primaryContactType
                    events {
                        name
                        slug
                        numEntrants
                        startAt
                        type
                        videogame {
                            name
                            images {
                                url
                                type
                                width
                                height
                            }
                        }
                        standings(query: {
                            page: 1
                            perPage: 3
                        }) {
                            nodes {
                                placement
                                entrant {
                                    name
                                    participants {
                                        id
                                        user {
                                            images {
                                                url
                                                type
                                                width
                                                height
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }`;

        return this.cached(`tournament:${tourneySlug}`, async () => {
            const data = await this.query(query);
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
        const query = `query {
                event(slug: "${eventSlug}") {
                    id
                    name
                    phases {
                        id
                        name
                    }
                    entrants(query : {
                        page: ${page}
                        perPage: ${entrantsPerPage}
                    }) {
                        nodes {
                            id
                            name
                            initialSeedNum
                            participants {
                                gamerTag
                                user {
                                    images {
                                        url
                                        type
                                        width
                                        height
                                    }
                                }
                            }
                        }
                    }
                }
            }`;

        return this.query(query);
    }

    async getPhase(phaseId): Promise<any> {
        const query = `query {
                phase(id: ${phaseId}) {
                    id
                    sets(page: 1, perPage: 1, sortType: ROUND) {
                        pageInfo {
                            total
                        }
                    }
                    phaseGroups(query : {
                        page: 1
                        perPage: 100
                    }) {
                        pageInfo {
                            total
                        }
                        nodes {
                            id
                            displayIdentifier
                            sets(
                                page: 1
                                perPage: 1
                                sortType: ROUND
                            ) {
                                pageInfo {
                                    total
                                }
                            }
                        }
                    }
                }
            }`;

        const data = await this.query(query);
        if (!data?.phase) throw new StartggError('Bracket phase not found on start.gg.');
        return data.phase;
    }

    async getPhaseGroupSets(phaseGroupId, totalSets): Promise<any> {
        const nodes = await this.loadPages(`sets:${phaseGroupId}`, totalSets, this.setsPerPage, async (page, perPage) => {
            const data = await this.getPhaseGroupSetsPaginated(phaseGroupId, page, perPage);
            return data?.phaseGroup?.sets?.nodes ?? [];
        });
        return { nodes };
    }

    // Every set in a phase, all pools at once, sorted into a Map from pool id to that pool's sets.
    // start.gg returns each pool's sets in the same order as asking pool by pool, so the bracket
    // draws the same; a phase with many small pools takes far fewer requests.
    async getPhaseSetsByPool(phaseId, totalSets): Promise<Map<any, any[]>> {
        // Each set also names its pool, one more object per set (19 instead of 18)
        const perPage = Math.floor(this.setsPerPage * 18 / 19);
        const nodes = await this.loadPages(`phase-sets:${phaseId}`, totalSets, perPage, async (page, perPage) => {
            const data = await this.getSetsPaginated(`phase(id: ${phaseId})`, page, perPage, 'phaseGroup { id }');
            return data?.phase?.sets?.nodes ?? [];
        });
        const byPool = new Map<any, any[]>();
        for (const { phaseGroup, ...set } of nodes) {
            if (!byPool.has(phaseGroup?.id)) byPool.set(phaseGroup?.id, []);
            byPool.get(phaseGroup?.id).push(set);
        }
        return byPool;
    }

    getPhaseGroupSetsPaginated(phaseGroupId, page, setsPerPage): Promise<any> {
        return this.getSetsPaginated(`phaseGroup(id: ${phaseGroupId})`, page, setsPerPage);
    }

    // One page of sets from a pool (`phaseGroup(id: …)`) or a whole phase (`phase(id: …)`)
    // Always asks for games: where no characters were reported they come back empty and cost little.
    private getSetsPaginated(parent, page, setsPerPage, extraFields = ''): Promise<any> {
        let setGamesQuery = this.getSetGamesQuery();

        const query = `query {
                ${parent} {
                    sets(
                        page: ${page}
                        perPage: ${setsPerPage}
                        sortType: ROUND
                    ) {
                        nodes {
                            ${extraFields}
                            id
                            round
                            fullRoundText
                            winnerId
                            ${setGamesQuery}
                            slots {
                                prereqId
                                prereqType
                                prereqPlacement
                                entrant {
                                    id
                                    name
                                    initialSeedNum
                                }
                                standing {
                                    stats {
                                        score {
                                            value
                                        }
                                    }
                                }
                            }
                        }
                    }
                  }
            }`;

        return this.query(query);
    }

    getSetGamesQuery() {
        return `games {
            winnerId
                stage {
                name
            }
                selections {
                    entrant {
                    id
                }
                    character {
                    name
                        images {
                        url
                        type
                        width
                        height
                    }
                }
            }
        }`
    }
}