import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { forkJoin, Observable } from 'rxjs';

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

    getTournamentEvents(tourneySlug): Observable<any> {
        const body = {
            query: `query {
                tournament(slug: "${tourneySlug}") {
                    id
                    name
                    events {
                        name
                        slug
                    }
                }
            }`
        };

        return this.http.post(this.baseUrl, body, { headers: this.getHeaders() });
    }

    getEventBySlug(eventSlug): Observable<any> {
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
                        page: 1
                        perPage: 100
                    }) {
                        nodes {
                            id
                            name
                            participants {
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

        return this.http.post(this.baseUrl, body, { headers: this.getHeaders() });
    }

    getEventById(eventId): Observable<any> {
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

        return this.http.post(this.baseUrl, body, { headers: this.getHeaders() });
    }

    getPhase(phaseId): Observable<any> {
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

        return this.http.post(this.baseUrl, body, { headers: this.getHeaders() });
    }

    getPhaseGroupSets(phaseGroupId, totalSets): Observable<any> {
        const setsPerPage = 58;
        let numberOfPages = Math.ceil(totalSets / setsPerPage);
        let phaseGroupSplit: Observable<HttpClient>[] = new Array(numberOfPages);

        return new Observable(observer => {
            for (let i = 0; i < numberOfPages; i++) phaseGroupSplit[i] = this.getPhaseGroupSetsPaginated(phaseGroupId, i + 1, setsPerPage);

            forkJoin(phaseGroupSplit).subscribe((data: any) => {
                let sets = data[0].data.phaseGroup.sets;
                for (let i = 1; i < numberOfPages; i++) sets.nodes = [...sets.nodes, ...data[i].data.phaseGroup.sets.nodes];
                observer.next(sets);
            })
        });
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
                                seed {
                                    seedNum
                                }
                            }
                        }
                    }
                  }
            }`
        };

        return this.http.post(this.baseUrl, body, { headers: this.getHeaders() });
    }
}