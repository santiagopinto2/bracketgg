import { AfterViewInit, ChangeDetectorRef, Component, HostListener, OnInit } from '@angular/core';
import { ColorSchemeService } from './services/color-scheme/color-scheme.service';
import { StartggService } from './services/startgg/startgg.service';
import { NavigationEnd, Router, RouterLink, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';
import { TournamentDataService } from './services/tournamentData/tournamentData.service';
import { MatDialog } from '@angular/material/dialog';
import { SettingsComponent } from './components/settings/settings.component';
import { MatToolbar } from '@angular/material/toolbar';
import { NgIf, NgFor } from '@angular/common';
import { MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatSidenavContainer, MatSidenav, MatSidenavContent } from '@angular/material/sidenav';
import { SearchComponent } from './components/search/search.component';
import { MatNavList, MatListItem } from '@angular/material/list';

@Component({
    selector: 'app-root',
    templateUrl: './app.component.html',
    styleUrls: ['./app.component.scss'],
    imports: [MatToolbar, NgIf, MatIconButton, MatIcon, RouterLink, MatSidenavContainer, MatSidenav, SearchComponent, MatNavList, NgFor, MatListItem, MatSidenavContent, RouterOutlet]
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

    async parseUrl(url) {
        if (url.includes('/tournament')) {
            let tourneySlug = url.slice(12);

            if (tourneySlug.length > 0) {
                tourneySlug = tourneySlug.slice(0, tourneySlug.indexOf('/'))
                let tourneyEventsRes = await this.startggService.getTournamentEvents(tourneySlug);
                this.events = tourneyEventsRes.data.tournament.events;

                if (url.includes('/event/')) {
                    let eventData: any = {};

                    if (url.includes('/brackets?filter=')) eventData.phaseId = Number(url.slice(url.indexOf('"phaseId":') + '"phaseId":'.length, url.indexOf(',')));
                    else if (url.includes('/brackets/')) {
                        let bracketEndIndex = url.indexOf('/brackets/') + '/brackets/'.length;
                        if (url.indexOf('/', bracketEndIndex) == -1) eventData.phaseId = Number(url.slice(bracketEndIndex));
                        else eventData.phaseId = Number(url.slice(bracketEndIndex, url.indexOf('/', bracketEndIndex)));
                    }

                    let eventSlug = '';
                    let eventEndIndex = url.indexOf('/event/') + '/event/'.length;
                    if (url.indexOf('/', eventEndIndex) == -1) eventSlug = url.slice(1);
                    else eventSlug = url.slice(1, url.indexOf('/', eventEndIndex));

                    let eventRes = await this.startggService.getEventBySlug(eventSlug, this.events.find(event => event.slug == eventSlug).numEntrants);
                    if (eventRes.errors) { console.log('error', eventRes.errors[0].message); return; }

                    if (!eventData.phaseId) eventData.phaseId = eventRes.phases[0].id;
                    eventData.event = eventRes;
                    this.tournamentDataService.changeEvent(eventData);
                }
                else this.tournamentDataService.changeEvent({});
            }
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

    goToAboutPage() {
        this.router.navigate(['/']);
    }

    goToDiscord() {

    }

    toggleDarkMode() {
        this.colorSchemeService.update(this.colorSchemeService.currentActive() === 'dark' ? 'light' : 'dark');
    }

    openSettings() {
        const dialogRef = this.dialog.open(SettingsComponent, {
            autoFocus: false
        });
    }
}
