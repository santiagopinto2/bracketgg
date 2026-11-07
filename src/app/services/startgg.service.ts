import { Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { AuthService } from './auth.service';
import { LoadingService } from './loading.service';
import { RequestGate } from './request-gate';

// A failed start.gg request, with a message fit to show the user.
export class StartggError extends Error { }

@Injectable({
    providedIn: 'root'
})
export class StartggService {

    private baseUrl: string = 'https://api.start.gg/gql/alpha';
    private entrantsPerPage = 100;
    private setsWithoutGamesPerPage = 66;
    private setsWithGamesBo3PerPage = 29;
    private setsWithGamesBo5PerPage = 19;

    // Tournament info and entrant lists rarely change during an event, so they are reused for
    // a few minutes. Sets are never cached, so brackets stay live.
    private cacheMs = 5 * 60_000;
    private cache = new Map<string, { at: number, value: any }>();
    private inFlight = new Map<string, Promise<any>>();
    private gate = new RequestGate();
    private maxRateLimitRetries = 4;
    private rateLimitBackoffMs = 5_000;

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
            if (res?.errors?.length) throw new StartggError(`start.gg error: ${res.errors[0].message}`);
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
            const numberOfPages = Math.max(1, Math.ceil(totalEntrants / this.entrantsPerPage));
            const pages = await Promise.all(Array.from({ length: numberOfPages }, (_, i) => this.getEventBySlugPaginated(eventSlug, i + 1, this.entrantsPerPage)));
            if (pages.some(page => !page?.event)) throw new StartggError('Event not found on start.gg.');

            const event = pages[0].event;
            event.entrants.nodes = pages.flatMap(page => page.event.entrants.nodes);
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

    async getPhaseProperties(phaseGroupId): Promise<any> {
        if (!phaseGroupId) return { phaseHasGames: false, maxScore: 0 };
        let firstPage = await this.getPhaseGroupSetsPaginated(phaseGroupId, 1, 10, true);
        let sets = firstPage?.phaseGroup?.sets?.nodes ?? [];
        let phaseHasGames = sets.some(set => set.games);

        let maxScore = 0;
        sets.forEach(set => {
            let firstValue = set.slots[0]?.standing?.stats.score.value ?? 0;
            let secondValue = set.slots[1]?.standing?.stats.score.value ?? 0;
            maxScore = Math.max(firstValue, secondValue, maxScore);
        });

        return { phaseHasGames: phaseHasGames, maxScore: maxScore }
    }

    async getPhaseGroupSets(phaseGroupId, totalSets, phaseProperties): Promise<any> {
        let setsPerPage = this.setsWithoutGamesPerPage;
        if (phaseProperties.phaseHasGames) {
            // Anything but a clear best of 3 gets the smallest page, so a page never passes start.gg's 1000-object cap
            setsPerPage = phaseProperties.maxScore == 2 ? this.setsWithGamesBo3PerPage : this.setsWithGamesBo5PerPage;
        }
        let numberOfPages = Math.ceil(totalSets / setsPerPage);

        const pages = await Promise.all(Array.from({ length: numberOfPages }, (_, i) => this.getPhaseGroupSetsPaginated(phaseGroupId, i + 1, setsPerPage, phaseProperties.phaseHasGames)));
        return { nodes: pages.flatMap(page => page?.phaseGroup?.sets?.nodes ?? []) };
    }

    getPhaseGroupSetsPaginated(phaseGroupId, page, setsPerPage, phaseHasGames): Promise<any> {
        let setGamesQuery = phaseHasGames ? this.getSetGamesQuery() : '';

        const query = `query {
                phaseGroup(id: ${phaseGroupId}) {
                    sets(
                        page: ${page}
                        perPage: ${setsPerPage}
                        sortType: ROUND
                    ) {
                        nodes {
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