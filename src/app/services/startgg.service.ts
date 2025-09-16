import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { firstValueFrom, forkJoin, Observable } from 'rxjs';

@Injectable({
    providedIn: 'root'
})
export class StartggService {

    private baseUrl: string = 'https://api.start.gg/gql/alpha';
    private entrantsPerPage = 100;
    private setsWithoutGamesBo5PerPage = 66;
    private setsWithGamesBo3PerPage = 29;
    private setsWithGamesBo5PerPage = 21;

    constructor(private http: HttpClient) { }

    getHeaders() {
        return new HttpHeaders({
            'Authorization': `Bearer ${localStorage.getItem('token')}`,
            'Content-Type': 'application/json'
        });
    }

    getTournamentEvents(tourneySlug): Promise<any> {
        const body = {
            query: `query {
                tournament(slug: "${tourneySlug}") {
                    id
                    name
                    events {
                        name
                        slug
                        numEntrants
                    }
                }
            }`
        };

        return firstValueFrom(this.http.post<any>(this.baseUrl, body, { headers: this.getHeaders() }));
    }

    async getEventBySlug(eventSlug, totalEntrants): Promise<any> {
        let numberOfPages = Math.ceil(totalEntrants / this.entrantsPerPage);
        let entrantsSplit: Observable<HttpClient>[] = new Array(numberOfPages);
        for (let i = 0; i < numberOfPages; i++) entrantsSplit[i] = this.getEventBySlugPaginated(eventSlug, i + 1, this.entrantsPerPage);

        return firstValueFrom(new Observable(observer => {
            forkJoin(entrantsSplit).subscribe((data: any) => {
                let splitErrors = data.find(split => split.errors);
                if (splitErrors) { observer.next(splitErrors); return; }

                let entrants = data[0].data.event.entrants;
                for (let i = 1; i < numberOfPages; i++) entrants.nodes = [...entrants.nodes, ...data[i].data.event.entrants.nodes];
                let event = data[0].data.event;
                event.entrants = entrants;

                observer.next(event);
            })
        }));
    }

    getEventBySlugPaginated(eventSlug, page, entrantsPerPage): Observable<any> {
        const body = {
            query: `query {
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
            }`
        };

        return this.http.post<any>(this.baseUrl, body, { headers: this.getHeaders() });
    }

    getEventById(eventId): Promise<any> {
        const body = {
            query: `query {
                event(id: "${eventId}") {
                    id
                    name
                    phases {
                        id
                        name
                    }
                }
            }`
        };

        return firstValueFrom(this.http.post<any>(this.baseUrl, body, { headers: this.getHeaders() }));
    }

    getPhase(phaseId) {
        const body = {
            query: `query {
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
            }`
        };

        return firstValueFrom(this.http.post<any>(this.baseUrl, body, { headers: this.getHeaders() }));
    }

    async getPhaseProperties(phaseGroupId): Promise<any> {
        let firstPage = await firstValueFrom(this.getPhaseGroupSetsPaginated(phaseGroupId, 1, 10, true));
        let phaseHasGames = firstPage.data.phaseGroup.sets.nodes.some(set => set.games);

        let maxScore = 0;
        firstPage.data.phaseGroup.sets.nodes.forEach(set => {
            let firstValue = set.slots[0].standing?.stats.score.value ?? 0;
            let secondValue = set.slots[1].standing?.stats.score.value ?? 0;
            maxScore = Math.max(firstValue, secondValue, maxScore);
        });

        return { phaseHasGames: phaseHasGames, maxScore: maxScore }
    }

    async getPhaseGroupSets(phaseGroupId, totalSets, phaseProperties): Promise<any> {
        let setsPerPage;
        if (phaseProperties.phaseHasGames) {
            if (phaseProperties.maxScore == 2) setsPerPage = this.setsWithGamesBo3PerPage;
            else if (phaseProperties.maxScore == 3) setsPerPage = this.setsWithGamesBo5PerPage;
        }
        else setsPerPage = this.setsWithoutGamesBo5PerPage;
        let numberOfPages = Math.ceil(totalSets / setsPerPage);

        let phaseGroupSplit: Observable<HttpClient>[] = new Array(numberOfPages);
        for (let i = 0; i < numberOfPages; i++) phaseGroupSplit[i] = this.getPhaseGroupSetsPaginated(phaseGroupId, i + 1, setsPerPage, phaseProperties.phaseHasGames);

        return firstValueFrom(new Observable(observer => {
            forkJoin(phaseGroupSplit).subscribe((data: any) => {
                let splitErrors = data.find(split => split.errors);
                if (splitErrors) { observer.next(splitErrors); return; }

                let sets = data[0].data.phaseGroup.sets;
                for (let i = 1; i < numberOfPages; i++) sets.nodes = [...sets.nodes, ...data[i].data.phaseGroup.sets.nodes];

                observer.next(sets);
            })
        }));
    }

    getPhaseGroupSetsPaginated(phaseGroupId, page, setsPerPage, phaseHasGames): Observable<any> {
        let setGamesQuery = phaseHasGames ? this.getSetGamesQuery() : '';

        const body = {
            query: `query {
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
                                entrant {
                                    id
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
            }`
        };

        return this.http.post<any>(this.baseUrl, body, { headers: this.getHeaders() });
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