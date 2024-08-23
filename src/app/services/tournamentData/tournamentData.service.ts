import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class TournamentDataService {

  private urlSource = new BehaviorSubject<string>('Initial Data');
  currentUrl = this.urlSource.asObservable();

  private eventSource = new BehaviorSubject<number>(-1);
  currentEvent = this.eventSource.asObservable();

  changeUrl(url: string) {
    this.urlSource.next(url);
  }

  changeEvent(event: number) {
    this.eventSource.next(event);
  }
}
