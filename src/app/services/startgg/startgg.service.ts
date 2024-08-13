import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';

@Injectable({
    providedIn: 'root'
})
export class StartggService {

    private baseUrl: string = 'https://api.start.gg/gql/alpha';
    private apiKey: string = 'ENTER API KEY';

    headers = new HttpHeaders({
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
    });


    constructor(private http: HttpClient) { }

    getEvent(tournamentSlug): Observable<any> {
        const body = {
            query: `query {
                event(slug: "${tournamentSlug}") {
                    id
                    name
                }
            }`
        };

        return this.http.post(this.baseUrl, body, { headers: this.headers });
    }

    getSets(eventId): Observable<any> {
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
                            displayScore
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