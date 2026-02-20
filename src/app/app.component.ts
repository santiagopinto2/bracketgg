import { AfterViewInit, ChangeDetectorRef, Component, HostListener, ViewChild, effect } from '@angular/core';
import { ColorSchemeService } from './services/color-scheme.service';
import { StartggService } from './services/startgg.service';
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

    title = 'bracketgg';
    windowSize;
    tournament: any = {};

    @ViewChild('sidenav') sidenav: MatSidenav;

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
        this.windowSize = window.innerWidth;

        effect(() => {
            if (this.navigationEnd()) this.parseUrl(decodeURIComponent(decodeURIComponent(this.router.url)));
        });
    }

    ngAfterViewInit() {
        this.cdr.detectChanges();
    }

    async parseUrl(url) {
        if (url.includes('/tournament')) {
            let tourneySlug = url.slice(12);

            if (tourneySlug.length > 0 && (this.tournament.event || tourneySlug.includes('/event/') || !`tournament/${tourneySlug}`.includes(this.tournament.slug))) {
                this.loadingService.updateValue(true);
                if (tourneySlug.indexOf('/') !== -1) tourneySlug = tourneySlug.slice(0, tourneySlug.indexOf('/'));
                let tourneyEventsRes = await this.startggService.getTournamentEvents(tourneySlug);
                this.tournament = tourneyEventsRes.data.tournament;
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

                    let eventRes = await this.startggService.getEventBySlug(eventSlug, this.tournament.events.find(event => event.slug == eventSlug).numEntrants);
                    if (eventRes.errors) { console.log('error', eventRes.errors[0].message); return; }

                    if (!tournamentData.event.phaseId) tournamentData.event.phaseId = eventRes.phases[0].id;
                    tournamentData.event.event = eventRes;
                }
                else {
                    this.loadingService.updateValue(false);
                }

                this.tournamentDataService.changeTournament(tournamentData);
            }
        }
        else {
            this.tournamentDataService.changeTournament({});
            this.tournament = {};
        }

        if (this.windowSize < 500) this.sidenav.close();
    }

    @HostListener('window:resize', ['$event'])
    onResize(event) {
        this.windowSize = event.target.innerWidth;
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

    login() {
        this.authService.initiateOAuthFlow();
    }

    logout() {
        this.authService.logout();
    }
}
