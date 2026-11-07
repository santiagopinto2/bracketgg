import { AfterViewInit, ChangeDetectorRef, Component, ViewChild, effect } from '@angular/core';
import { ColorSchemeService } from './services/color-scheme.service';
import { StartggError, StartggService } from './services/startgg.service';
import { NavigationEnd, Router, RouterLink, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';
import { TournamentDataService } from './services/tournamentData.service';
import { MatToolbar } from '@angular/material/toolbar';
import { MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatSidenavContainer, MatSidenav, MatSidenavContent } from '@angular/material/sidenav';
import { SearchComponent } from './components/search/search.component';
import { MatNavList, MatListItem } from '@angular/material/list';
import { LoadingService } from './services/loading.service';
import { toSignal } from '@angular/core/rxjs-interop';
import { AuthService } from './services/auth.service';
import { MatTooltip } from '@angular/material/tooltip';

@Component({
    selector: 'app-root',
    templateUrl: './app.component.html',
    styleUrls: ['./app.component.scss'],
    imports: [MatToolbar, MatIconButton, MatIcon, RouterLink, MatSidenavContainer, MatSidenav, SearchComponent, MatNavList, MatListItem, MatSidenavContent, RouterOutlet, MatTooltip]
})
export class AppComponent implements AfterViewInit {

    @ViewChild(MatSidenavContent) sidenavContent: MatSidenavContent;

    title = 'bracketgg';
    largeWindowSize = 769;
    // Phone or desktop layout, from a media query: it tells us whenever the answer changes, even when
    // a phone reports a desktop width while the page is still loading and sends no resize afterwards.
    // It only changes when the width crosses the breakpoint, so the phone keyboard opening doesn't count.
    private largeQuery = window.matchMedia(`(min-width: ${this.largeWindowSize}px)`);
    isLarge = this.largeQuery.matches;
    sidenavOpen = this.isLarge;
    tournament: any = {};
    private loadId = 0;

    private navigationEnd = toSignal(
        this.router.events.pipe(filter(event => event instanceof NavigationEnd))
    );

    constructor(
        public colorSchemeService: ColorSchemeService,
        private startggService: StartggService,
        private tournamentDataService: TournamentDataService,
        private loadingService: LoadingService,
        private cdr: ChangeDetectorRef,
        private router: Router,
        public authService: AuthService
    ) {
        this.colorSchemeService.load();
        this.largeQuery.addEventListener('change', () => this.syncLayout());
        window.addEventListener('pageshow', () => this.syncLayout());

        effect(() => {
            if (this.navigationEnd()) {
                this.parseUrl(decodeURIComponent(decodeURIComponent(this.router.url)));
                this.sidenavContent?.scrollTo({ top: 0 });
            }
        });
    }

    ngAfterViewInit() {
        this.syncLayout();
        this.cdr.detectChanges();
    }

    async parseUrl(url) {
        // A newer navigation makes this load stale; a stale load must not overwrite the newer page
        const loadId = ++this.loadId;

        if (url.includes('/tournament')) {
            let tourneySlug = url.slice(12);

            if (tourneySlug.length > 0 && (this.tournament.event || tourneySlug.includes('/event/') || !`tournament/${tourneySlug}`.includes(this.tournament.slug))) {
                this.loadingService.updateValue(true);
                try {
                    if (tourneySlug.indexOf('/') !== -1) tourneySlug = tourneySlug.slice(0, tourneySlug.indexOf('/'));
                    // Cached for a few minutes, so a phase switch doesn't download the tournament again
                    let tournament = await this.startggService.getTournamentEvents(tourneySlug);
                    if (loadId !== this.loadId) return;
                    this.tournament = tournament;
                    let tournamentData: any = this.tournament;

                    if (url.includes('/event/')) {
                        tournamentData.event = {};

                        if (url.includes('/brackets?filter=')) tournamentData.event.phaseId = Number(url.slice(url.indexOf('"phaseId":') + '"phaseId":'.length, url.indexOf(',')));
                        else if (url.includes('/brackets/')) {
                            let bracketEndIndex = url.indexOf('/brackets/') + '/brackets/'.length;
                            if (url.indexOf('/', bracketEndIndex) == -1) tournamentData.event.phaseId = Number(url.slice(bracketEndIndex));
                            else tournamentData.event.phaseId = Number(url.slice(bracketEndIndex, url.indexOf('/', bracketEndIndex)));
                        }

                        let eventSlug = '';
                        let eventEndIndex = url.indexOf('/event/') + '/event/'.length;
                        if (url.indexOf('/', eventEndIndex) == -1) eventSlug = url.slice(1);
                        else eventSlug = url.slice(1, url.indexOf('/', eventEndIndex));

                        let eventInfo = this.tournament.events?.find(event => event.slug == eventSlug);
                        if (!eventInfo) throw new StartggError('Event not found in this tournament.');

                        // Also cached, and fetched again when the tournament shows a new entrant count
                        let eventRes = await this.startggService.getEventBySlug(eventSlug, eventInfo.numEntrants);
                        if (loadId !== this.loadId) return;

                        if (!tournamentData.event.phaseId) tournamentData.event.phaseId = eventRes.phases[0]?.id;
                        if (!tournamentData.event.phaseId) throw new StartggError('This event has no brackets yet.');
                        tournamentData.event.event = eventRes;
                    }
                    else {
                        this.loadingService.updateValue(false);
                    }

                    this.tournamentDataService.changeTournament(tournamentData);
                } catch (error) {
                    if (loadId !== this.loadId) return;
                    console.error(error);
                    this.loadingService.error(error instanceof StartggError ? error.message : 'Something went wrong loading this page. Try reloading.');
                }
            }
        }
        else {
            this.tournamentDataService.changeTournament({});
            this.tournament = {};
        }

    }

    // Opens the sidenav on desktop and closes it on phones, if the layout changed since the last check
    syncLayout() {
        if (this.largeQuery.matches === this.isLarge) return;
        this.isLarge = this.largeQuery.matches;
        this.sidenavOpen = this.isLarge;
    }

    getTournamentImage(): string {
        const images = this.tournament.images;
        if (!images?.length) return '';
        return (images.find((i: any) => i.type === 'profile') ?? images[0]).url ?? '';
    }

    goToAboutPage() {
        this.router.navigate(['/']);
    }

    goToDiscord() {

    }

    toggleDarkMode() {
        this.colorSchemeService.update(this.colorSchemeService.currentActive() === 'dark' ? 'light' : 'dark');
    }

    closeSidenav() {
        if (!this.isLarge) this.sidenavOpen = false;
    }

    login() {
        this.authService.initiateOAuthFlow();
    }

    logout() {
        this.authService.logout();
    }
}
