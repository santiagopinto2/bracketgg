import { AfterViewInit, ChangeDetectorRef, Component, HostListener, inject, OnInit } from '@angular/core';
import { ColorSchemeService } from './services/color-scheme/color-scheme.service';
import { StartggService } from './services/startgg/startgg.service';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs';
import { TournamentDataService } from './services/tournamentData/tournamentData.service';
import { MatDialog } from '@angular/material/dialog';
import { SettingsComponent } from './components/settings/settings.component';

@Component({
    selector: 'app-root',
    templateUrl: './app.component.html',
    styleUrls: ['./app.component.scss']
})
export class AppComponent implements OnInit, AfterViewInit {

    title = 'bracketgg';
    windowSize;
    events = [];

    constructor(public colorSchemeService: ColorSchemeService, private startggService: StartggService, private tournamentDataService: TournamentDataService, private dialog: MatDialog, private cdr: ChangeDetectorRef, private router: Router) {
        this.colorSchemeService.load();
    }

    ngOnInit(): void {
        this.router.events
            .pipe(filter(event => event instanceof NavigationEnd))
            .subscribe(() => {
                this.parseUrl(decodeURIComponent(decodeURIComponent(this.router.url)));
            });
    }

    ngAfterViewInit() {
        this.windowSize = window.screen.width;
        this.cdr.detectChanges();
    }

    parseUrl(url) {
        if (url.includes('/tournament')) {
            let tourneySlug = url.slice(12);

            if (tourneySlug.length > 0) {
                tourneySlug = tourneySlug.slice(0, tourneySlug.indexOf('/'))
                this.startggService.getTournamentEvents(tourneySlug).subscribe(data => {
                    this.events = data.data.tournament.events;
                })
            }

            if (url.includes('/event/')) {
                let eventData: any = {};

                if (url.includes('/brackets?filter=')) eventData.phaseId = Number(url.slice(url.indexOf('"phaseId":') + '"phaseId":'.length, url.indexOf(',')));
                else if (url.includes('/brackets/')) {
                    let bracketEndIndex = url.indexOf('/brackets/') + '/brackets/'.length;
                    if (url.indexOf('/', bracketEndIndex) == -1) eventData.phaseId = Number(url.slice(bracketEndIndex));
                    else eventData.phaseId = Number(url.slice(bracketEndIndex, url.indexOf('/', bracketEndIndex)));
                }

                let eventSlug = '';
                if (url.indexOf('/', url.indexOf('/event/') + '/event/'.length) == -1) eventSlug = url.slice(1);
                else eventSlug = url.slice(1, url.indexOf('/', url.indexOf('/event/') + '/event/'.length));

                this.startggService.getEventBySlug(eventSlug).subscribe(data => {
                    eventData.eventId = data.data.event.id;

                    if (url.slice(url.indexOf('/event/') + 7).indexOf('/') == -1) {
                        this.startggService.getEventById(eventData.eventId).subscribe(eventByIdData => {
                            eventData.phaseId = eventByIdData.data.event.phases[0].id;
                            this.tournamentDataService.changeEvent(eventData);
                        })
                    }
                    else this.tournamentDataService.changeEvent(eventData);
                })
            }
            else this.tournamentDataService.changeEvent({});
        }
        else {
            this.tournamentDataService.changeEvent({});
            this.events = [];
        }
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

    openSettings() {
        const dialogRef = this.dialog.open(SettingsComponent, {});
    }
}
