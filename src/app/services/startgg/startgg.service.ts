import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';

@Injectable({
    providedIn: 'root'
})
export class StartggService {

    private baseUrl: string = 'https://api.start.gg/gql/alpha';
    private apiKey: string = 'API KEY';

    headers = new HttpHeaders({
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
    });


    constructor(private http: HttpClient) { }

    getTournamentEvents(tourneySlug): Observable<any> {
        const body = {
            query: `query {
                tournament(slug: "${tourneySlug}") {
                    id
                    name
                    events {
                        id
                        name
                        slug
                    }
                }
            }`
        };

        return this.http.post(this.baseUrl, body, { headers: this.headers });
    }

    getPhase(phaseId): Observable<any> {
        const body = {
            query: `query {
                phase(id: ${phaseId}) {
                    id
                    name
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
                        }
                    }
                }
            }`
        };

        return this.http.post(this.baseUrl, body, { headers: this.headers });
    }

    getPhaseGroup(phaseGroupId): Observable<any> {
        const body = {
            query: `query {
                phaseGroup(id: ${phaseGroupId}) {
                    id
                    displayIdentifier
                    sets(
                        page: 1
                        perPage: 100
                        sortType: ROUND
                    ) {
                        pageInfo {
                            total
                        }
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
                            }
                        }
                    }
                  }
            }`
        };

        return this.http.post(this.baseUrl, body, { headers: this.headers });
    }

    getEventBySlug(tourneySlug): Observable<any> {
        const body = {
            query: `query {
                event(slug: "${tourneySlug}") {
                    id
                    name
                }
            }`
        };

        return this.http.post(this.baseUrl, body, { headers: this.headers });
    }

    getEventById(eventId): Observable<any> {
        const body = {
            query: `query {
                event(id: "${eventId}") {
                    id
                    name
                    phases(phaseId: 0) {
                        id
                        name
                    }
                }
            }`
        };

        return this.http.post(this.baseUrl, body, { headers: this.headers });
    }

    getEventSets(eventId): Observable<any> {
        const body = {
            query: `query {
                event(id: ${eventId}) {
                    id
                    name
                    sets(
                        page: 1
                        perPage: 100
                        sortType: ROUND
                    ) {
                        pageInfo {
                            total
                        }
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
                            }
                        }
                    }
                }
            }`
        };

        return this.http.post(this.baseUrl, body, { headers: this.headers })
    }
}