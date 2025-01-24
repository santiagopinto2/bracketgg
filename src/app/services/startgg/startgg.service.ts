import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { firstValueFrom, forkJoin, Observable } from 'rxjs';

@Injectable({
    providedIn: 'root'
})
export class StartggService {

    private baseUrl: string = 'https://api.start.gg/gql/alpha';

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
        const entrantsPerPage = 100;
        let numberOfPages = Math.ceil(totalEntrants / entrantsPerPage);
        let entrantsSplit: Observable<HttpClient>[] = new Array(numberOfPages);
        for (let i = 0; i < numberOfPages; i++) entrantsSplit[i] = this.getEventBySlugPaginated(eventSlug, i + 1, entrantsPerPage);

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
                            seeds {
                                seedNum
                                phase {
                                    id
                                }
                            }
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

    getPhaseGroupSets(phaseGroupId, totalSets): Promise<any> {
        const setsPerPage = 29;
        let numberOfPages = Math.ceil(totalSets / setsPerPage);
        let phaseGroupSplit: Observable<HttpClient>[] = new Array(numberOfPages);
        for (let i = 0; i < numberOfPages; i++) phaseGroupSplit[i] = this.getPhaseGroupSetsPaginated(phaseGroupId, i + 1, setsPerPage);

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

    getPhaseGroupSetsPaginated(phaseGroupId, page, setsPerPage): Observable<any> {
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
                            games {
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
                            }
                            slots {
                                id
                                entrant {
                                    id
                                    name
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
}