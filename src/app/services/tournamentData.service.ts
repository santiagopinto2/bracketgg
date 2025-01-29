import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

@Injectable({
    providedIn: 'root'
})
export class TournamentDataService {

    urlSource$ = new BehaviorSubject<string>('Initial Data');
    eventSource$ = new BehaviorSubject<any>({});

    changeUrl(url: string) {
        this.urlSource$.next(url);
    }

    changeEvent(event) {
        this.eventSource$.next(event);
    }
}
