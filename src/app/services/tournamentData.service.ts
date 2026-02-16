import { Injectable, signal } from '@angular/core';

@Injectable({
    providedIn: 'root'
})
export class TournamentDataService {

    urlSource = signal<string>('Initial Data');
    eventSource = signal<any>({});

    changeUrl(url: string) {
        this.urlSource.set(url);
    }

    changeEvent(event) {
        this.eventSource.set(event);
    }
}
