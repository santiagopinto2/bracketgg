import { Injectable, signal } from '@angular/core';

@Injectable({
    providedIn: 'root'
})
export class TournamentDataService {

    urlSource = signal<string>('Initial Data');
    tournamentSource = signal<any>({});

    changeUrl(url: string) {
        this.urlSource.set(url);
    }

    changeTournament(tournament) {
        this.tournamentSource.set(tournament);
    }
}
