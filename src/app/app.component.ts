import { AfterViewInit, ChangeDetectorRef, Component, ViewChild, effect, ChangeDetectionStrategy } from '@angular/core';
import { ThemeService } from './services/theme.service';
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
import { isBracketPath } from './app-routing.module';

@Component({
    selector: 'app-root',
    templateUrl: './app.component.html',
    styleUrls: ['./app.component.scss'],
    changeDetection: ChangeDetectionStrategy.Eager,
    imports: [MatToolbar, MatIconButton, MatIcon, RouterLink, MatSidenavContainer, MatSidenav, SearchComponent, MatNavList, MatListItem, MatSidenavContent, RouterOutlet]
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
        public themeService: ThemeService,
        private startggService: StartggService,
        private tournamentDataService: TournamentDataService,
        private loadingService: LoadingService,
        private cdr: ChangeDetectorRef,
        private router: Router,
        public authService: AuthService
    ) {
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
                        const path = url.split('?')[0];

                        let eventSlug = '';
                        let eventEndIndex = path.indexOf('/event/') + '/event/'.length;
                        if (path.indexOf('/', eventEndIndex) == -1) eventSlug = path.slice(1);
                        else eventSlug = path.slice(1, path.indexOf('/', eventEndIndex));
                        tournamentData.event.slug = eventSlug;

                        let eventInfo = this.tournament.events?.find(event => event.slug == eventSlug);
                        if (!eventInfo) throw new StartggError('Event not found in this tournament.');

                        if (isBracketPath(path)) {
                            if (url.includes('/brackets?filter=')) tournamentData.event.phaseId = Number(url.slice(url.indexOf('"phaseId":') + '"phaseId":'.length, url.indexOf(',')));
                            else if (path.includes('/brackets/')) {
                                // start.gg's form: /brackets/<phase id>/<pool id>. The pool is where the bracket view scrolls to.
                                const [phaseId, poolId] = path.slice(path.indexOf('/brackets/') + '/brackets/'.length).split('/');
                                tournamentData.event.phaseId = Number(phaseId);
                                if (Number(poolId)) tournamentData.event.poolId = Number(poolId);
                            }
                            // A link from a set's progression tag names the player to scroll to (?player=<entrant id>);
                            // the entry it leaves behind in the history names the set it was clicked on (?set=<set id>)
                            const params = this.router.parseUrl(this.router.url).queryParams;
                            const player = params['player'], set = params['set'];
                            if (Number(player)) tournamentData.event.playerId = Number(player);
                            if (typeof set === 'string' && /^[\w-]{1,80}$/.test(set)) tournamentData.event.setId = set;

                            // The event's id, name and phases, in one small request. The bracket view then loads
                            // only the shown phase's players, not the whole event's. Cached, and fetched again
                            // when the tournament shows a new entrant count.
                            const eventRes = await this.startggService.getEventPhases(eventSlug, eventInfo.numEntrants);
                            if (loadId !== this.loadId) return;

                            eventRes.phases = eventRes.phases ?? [];
                            if (!tournamentData.event.phaseId) tournamentData.event.phaseId = eventRes.phases[0]?.id;
                            if (!tournamentData.event.phaseId) throw new StartggError('This event has no brackets yet.');
                            tournamentData.event.event = eventRes;
                        }
                        else {
                            // The event's landing page: one small request, and no entrant list
                            tournamentData.event.overview = await this.startggService.getEventOverview(eventSlug, eventInfo.videogame?.id, eventInfo.type === 1);
                            if (loadId !== this.loadId) return;
                            this.loadingService.updateValue(false);
                        }
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
