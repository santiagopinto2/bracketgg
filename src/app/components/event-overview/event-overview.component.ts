import { Component, computed, effect, signal } from '@angular/core';
import { NgClass, NgStyle } from '@angular/common';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { StartggError, StartggService } from 'src/app/services/startgg.service';
import { TournamentDataService } from 'src/app/services/tournamentData.service';
import { LoadingService } from 'src/app/services/loading.service';

// An event's landing page: header, top standings, and its phases with their pools, each linked to its bracket
@Component({
    selector: 'app-event-overview',
    imports: [MatIconModule, MatButtonModule, RouterLink, NgClass, NgStyle],
    templateUrl: './event-overview.component.html',
    styleUrl: './event-overview.component.scss',
})
export class EventOverviewComponent {

    tournament = signal<any>(null);
    event = signal<any>(null);
    standings = signal<any[]>([]);
    standingsTotal = signal(0);
    loadingStandings = signal(false);
    // "Show more" loads the standings in pages of this size, starting over from the top
    private standingsPerPage = 50;
    private standingsPagesLoaded = 0;
    private colors = new Map<any, string>();

    formattedDate = computed(() => {
        const startAt = this.event()?.startAt;
        if (!startAt) return '';
        return new Date(startAt * 1000).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    });

    gameImage = computed(() => {
        const images = this.event()?.videogame?.images;
        if (!images?.length) return '';
        return (images.find((i: any) => i.type === 'primary') ?? images[0]).url ?? '';
    });

    // Payouts show only when the organizer turned prizing on; start.gg fills in a 60/30/10 split otherwise
    prizing = computed(() => {
        const info = this.event()?.prizingInfo;
        if (!info?.enablePrizing) return null;
        const payouts = (info.prizing ?? []).filter((p: any) => p.placement && p.percent);
        return payouts.length || info.markdown ? { payouts, text: info.markdown } : null;
    });

    constructor(
        private tournamentDataService: TournamentDataService,
        private startggService: StartggService,
        private loadingService: LoadingService
    ) {
        effect(() => {
            const data = this.tournamentDataService.tournamentSource();
            const event = data?.event?.overview ?? null;
            if (event) {
                event.phases = event.phases ?? [];
                event.phases.forEach((phase: any) => {
                    phase.pools = (phase.phaseGroups?.nodes ?? []).slice()
                        .sort((a: any, b: any) => String(a.displayIdentifier).localeCompare(String(b.displayIdentifier), 'en', { numeric: true }));
                });
                this.standings.set((event.standings?.nodes ?? []).map((standing: any) => this.prepareStanding(standing, event)));
                this.standingsTotal.set(event.standings?.pageInfo?.total ?? 0);
                this.standingsPagesLoaded = 0;
            }
            this.tournament.set(event ? data : null);
            this.event.set(event);
        });
    }

    // Fixes up a standing for display: sponsor split off the name, and a color when there's no avatar
    private prepareStanding(standing: any, event: any) {
        const name: string = standing.entrant?.name ?? '';
        // A team's name holds every player's sponsor, so only a singles name is split
        const pipeIndex = event.type === 1 ? name.lastIndexOf('|') : -1;
        standing.sponsor = pipeIndex != -1 ? name.slice(0, pipeIndex - 1) : '';
        standing.tag = pipeIndex != -1 ? name.slice(pipeIndex + 2) : name;

        if (!this.getStandingProfile(standing)) {
            const key = standing.entrant?.id;
            if (!this.colors.has(key)) {
                const hue = Math.floor(Math.random() * 361);
                const sat = Math.floor(Math.random() * 101);
                this.colors.set(key, `hsl(${hue}, ${sat}%, 40%)`);
            }
            standing.backgroundColor = this.colors.get(key);
        }
        return standing;
    }

    async showMoreStandings() {
        const event = this.event();
        if (!event || this.loadingStandings()) return;
        this.loadingStandings.set(true);
        try {
            const page = this.standingsPagesLoaded + 1;
            const nodes = await this.startggService.getEventStandings(event.slug, page, this.standingsPerPage);
            // The event on screen changed while this was loading
            if (this.event() !== event) return;
            const more = nodes.map(standing => this.prepareStanding(standing, event));
            // The first page starts from 1st place again, so it replaces the top 8
            this.standings.update(standings => page == 1 ? more : [...standings, ...more]);
            this.standingsPagesLoaded = page;
            if (!nodes.length) this.standingsTotal.set(this.standings().length);
        } catch (error) {
            console.error(error);
            this.loadingService.error(error instanceof StartggError ? error.message : 'Could not load more standings.');
        } finally {
            this.loadingStandings.set(false);
        }
    }

    phaseLink(phase: any, pool: any = null): string {
        return '/' + this.event().slug + '/brackets/' + phase.id + (pool ? '/' + pool.id : '');
    }

    // "Double Elimination · 64 entrants · 8 pools"
    getPhaseDetails(phase: any): string {
        const details = [];
        if (phase.bracketType) details.push(phase.bracketType.toLowerCase().replace(/(^|_)(\w)/g, (_, sep, letter) => (sep ? ' ' : '') + letter.toUpperCase()));
        if (phase.numSeeds) details.push(`${phase.numSeeds} ${phase.numSeeds == 1 ? 'entrant' : 'entrants'}`);
        if (phase.groupCount > 1) details.push(`${phase.groupCount} pools`);
        return details.join(' · ');
    }

    getStateLabel(state: string): string {
        if (state === 'CREATED' || state === 'READY') return 'Upcoming';
        if (state === 'ACTIVE') return 'In Progress';
        if (state === 'COMPLETED') return 'Completed';
        return '';
    }

    getOrdinalSuffix(placement: number): string {
        if (placement % 100 >= 11 && placement % 100 <= 13) return 'th';
        return ['th', 'st', 'nd', 'rd'][placement % 10] ?? 'th';
    }

    getStandingInitial(standing: any): string {
        return standing.tag[0]?.toUpperCase() ?? '';
    }

    getStandingProfileImage(standing: any): string {
        const profile = this.getStandingProfile(standing);
        return profile ? profile.url : '';
    }

    getStandingProfileImageOrientation(standing: any): string {
        const profile = this.getStandingProfile(standing);
        return profile && profile.height > profile.width ? 'portrait' : '';
    }

    private getStandingProfile(standing: any): any {
        const images = standing.entrant?.participants?.[0]?.user?.images;
        if (!images?.length) return null;
        return images.find((img: any) => img.type === 'profile') ?? null;
    }
}
