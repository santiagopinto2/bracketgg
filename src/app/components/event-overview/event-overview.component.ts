import { Component, computed, effect, signal, ChangeDetectionStrategy } from '@angular/core';
import { NgClass, NgStyle } from '@angular/common';
import { RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { StartggService } from 'src/app/services/startgg.service';
import { TournamentDataService } from 'src/app/services/tournamentData.service';
import { lostTo } from 'src/app/services/lost-to';
import { rankIcon, rankingsOf, socialsOf } from 'src/app/services/player-extras';

// An event's landing page: header, the top 8, and its phases, each linked to its bracket
@Component({
    selector: 'app-event-overview',
    imports: [MatIconModule, MatTooltipModule, RouterLink, NgClass, NgStyle],
    templateUrl: './event-overview.component.html',
    changeDetection: ChangeDetectionStrategy.Eager,
    styleUrl: './event-overview.component.scss',
})
export class EventOverviewComponent {

    tournament = signal<any>(null);
    event = signal<any>(null);
    standings = signal<any[]>([]);
    // On a wide screen the standings read down the first column, then the second
    private colors = new Map<any, string>();
    readonly rankIcon = rankIcon;

    // The Discord account whose username was just copied: its tooltip says so for a moment
    copied = signal<any>(null);

    formattedDate = computed(() => {
        const startAt = this.event()?.startAt;
        if (!startAt) return '';
        return new Date(startAt * 1000).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    });

    // "1,544"
    entrantCount = computed(() => Number(this.event()?.numEntrants ?? 0).toLocaleString('en-US'));
    // "melee-singles" of "tournament/genesis-x/event/melee-singles": how the Attendees page names an event
    shortSlug = computed(() => String(this.event()?.slug ?? '').split('/').pop() ?? '');

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
        private startggService: StartggService
    ) {
        effect(() => {
            const data = this.tournamentDataService.tournamentSource();
            const event = data?.event?.overview ?? null;
            if (event) {
                event.phases = event.phases ?? [];
                const nodes = event.standings?.nodes ?? [];
                const names = new Map<string, string>(nodes.map((standing: any) => [String(standing.entrant?.id), standing.entrant?.name]));
                this.standings.set(nodes.map((standing: any) => this.prepareStanding(standing, event, names)));
            }
            this.tournament.set(event ? data : null);
            this.event.set(event);
        });
    }

    // Fixes up a standing for display: sponsor split off the name, a color when there's no avatar, who
    // the entrant lost to, and a singles player's socials and rankings. `names` is every standing's entrant.
    private prepareStanding(standing: any, event: any, names: Map<string, string>) {
        const singles = event.type === 1;
        const name: string = standing.entrant?.name ?? '';
        standing.sponsor = singles ? this.splitName(name).sponsor : '';
        standing.tag = singles ? this.splitName(name).tag : name;

        if (!this.getStandingProfile(standing)) {
            const key = standing.entrant?.id;
            if (!this.colors.has(key)) {
                const hue = Math.floor(Math.random() * 361);
                const sat = Math.floor(Math.random() * 101);
                this.colors.set(key, `hsl(${hue}, ${sat}%, 40%)`);
            }
            standing.backgroundColor = this.colors.get(key);
        }

        // "Cody Schwab ×2, Zain": oldest loss first, as start.gg lists them, with a repeat counted
        const losses = new Map<string, number>();
        lostTo(standing.entrant, names, this.startggService.setsPerStanding)
            .map(winner => singles ? this.splitName(winner).tag : winner)
            .forEach(tag => losses.set(tag, (losses.get(tag) ?? 0) + 1));
        standing.lostTo = [...losses].map(([tag, count]) => count > 1 ? `${tag} ×${count}` : tag).join(', ');

        // A team would need these per player, which is too much for one card
        const participant = singles ? standing.entrant?.participants?.[0] : null;
        standing.socials = socialsOf(participant?.user?.authorizations);
        standing.rankings = rankingsOf(participant?.player?.rankings);
        return standing;
    }

    // Discord has no profile page to link to, so its icon copies the username
    copy(social: any) {
        navigator.clipboard?.writeText(social.username).then(() => {
            this.copied.set(social);
            setTimeout(() => this.copied() === social && this.copied.set(null), 2000);
        }, () => { });
    }

    // "TSM | Leffen" is the sponsor "TSM" and the tag "Leffen"
    private splitName(name: string) {
        const pipeIndex = name.lastIndexOf('|');
        return pipeIndex != -1 ? { sponsor: name.slice(0, pipeIndex - 1), tag: name.slice(pipeIndex + 2) } : { sponsor: '', tag: name };
    }

    phaseLink(phase: any): string {
        return '/' + this.event().slug + '/brackets/' + phase.id;
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

    // The profile picture: the only image asked for (images(type: "profile"))
    private getStandingProfile(standing: any): any {
        return standing.entrant?.participants?.[0]?.user?.images?.[0] ?? null;
    }
}
