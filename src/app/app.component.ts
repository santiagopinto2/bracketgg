import { AfterViewInit, ChangeDetectorRef, Component, HostListener, OnInit } from '@angular/core';
import { ColorSchemeService } from './services/color-scheme/color-scheme.service';
import { StartggService } from './services/startgg/startgg.service';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs';
import { TournamentDataService } from './services/tournamentData/tournamentData.service';

@Component({
    selector: 'app-root',
    templateUrl: './app.component.html',
    styleUrls: ['./app.component.scss']
})
export class AppComponent implements OnInit, AfterViewInit {

    title = 'bracketgg';
    windowSize;
    events = [];

    constructor(public colorSchemeService: ColorSchemeService, private startggService: StartggService, private tournamentDataService: TournamentDataService, private cdr: ChangeDetectorRef, private router: Router) {
        this.colorSchemeService.load();
    }

    ngOnInit(): void {
        this.router.events
            .pipe(
                filter(event => event instanceof NavigationEnd)
            )
            .subscribe(() => {
                if (this.router.url.includes('/tournament')) {
                    this.tournamentDataService.changeUrl(this.router.url.slice(1));

                    let tourneySlug = this.router.url.slice(12);
                    tourneySlug = tourneySlug.slice(0, tourneySlug.indexOf('/'))
                    this.startggService.getTournamentEvents(tourneySlug).subscribe(data => {
                        this.events = data.data.tournament.events;
                    })

                    if (this.router.url.includes('/event/')) {
                        let eventSlug = this.router.url.slice(1);
                        this.startggService.getEventBySlug(eventSlug).subscribe(data => {
                            this.tournamentDataService.changeEvent(data.data.event.id);
                        })
                    }
                }
            });
    }

    ngAfterViewInit() {
        this.windowSize = window.screen.width;
        this.cdr.detectChanges();
    }

    @HostListener('window:resize', ['$event'])
    onResize(event) {
        this.windowSize = event.target.innerWidth;
    }

    goToDiscord() {

    }

    toggleDarkMode() {
        this.colorSchemeService.update(this.colorSchemeService.currentActive() === 'dark' ? 'light' : 'dark');
    }
}
