import { rankingSeriesLogo } from './ranking-series';
import { Component, computed, effect, signal } from '@angular/core';
import { NgClass, NgStyle } from '@angular/common';
import { RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { StartggService } from 'src/app/services/startgg.service';
import { TournamentDataService } from 'src/app/services/tournamentData.service';
import { lostTo } from 'src/app/services/lost-to';

// Each social's name, profile address (Discord has none) and icon, a 24x24 path, in the order they show
const socials = [
    { type: 'TWITTER', name: 'X', profile: 'https://x.com/', icon: 'M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z' },
    { type: 'TWITCH', name: 'Twitch', profile: 'https://twitch.tv/', icon: 'M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714Z' },
    { type: 'DISCORD', name: 'Discord', profile: '', icon: 'M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z' },
];

// An event's landing page: header, the top 8, and its phases, each linked to its bracket
@Component({
    selector: 'app-event-overview',
    imports: [MatIconModule, MatTooltipModule, RouterLink, NgClass, NgStyle],
    templateUrl: './event-overview.component.html',
    styleUrl: './event-overview.component.scss',
})
export class EventOverviewComponent {

    tournament = signal<any>(null);
    event = signal<any>(null);
    standings = signal<any[]>([]);
    // On a wide screen the standings read down the first column, then the second
    private colors = new Map<any, string>();
    // A trophy, drawn beside the number of a ranking whose series has no built-in logo (a 24x24 path)
    readonly rankIcon = 'M19 5h-2V3H7v2H5c-1.1 0-2 .9-2 2v1c0 2.55 1.92 4.63 4.39 4.94.63 1.5 1.98 2.63 3.61 2.96V19H7v2h10v-2h-4v-3.1c1.63-.33 2.98-1.46 3.61-2.96C19.08 12.63 21 10.55 21 8V7c0-1.1-.9-2-2-2zM5 8V7h2v3.82C5.84 10.4 5 9.3 5 8zm14 0c0 1.3-.84 2.4-2 2.82V7h2v1z';

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
        const accounts = participant?.user?.authorizations ?? [];
        standing.socials = socials.flatMap(social => {
            const account = accounts.find((a: any) => a?.type === social.type && a.externalUsername);
            if (!account) return [];
            const url = /^https:\/\//.test(account.url ?? '') ? account.url : social.profile ? social.profile + encodeURIComponent(account.externalUsername) : '';
            return [{ ...social, username: account.externalUsername, url, label: `${social.name}: ${account.externalUsername}` }];
        });
        // A ranking shows its series' logo when that is one of the built-in ones, and the trophy otherwise
        standing.rankings = (participant?.player?.rankings ?? []).filter((ranking: any) => ranking?.rank && ranking.title)
            .map((ranking: any) => ({ ...ranking, image: rankingSeriesLogo(ranking.title) }));
        return standing;
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

    private getStandingProfile(standing: any): any {
        const images = standing.entrant?.participants?.[0]?.user?.images;
        if (!images?.length) return null;
        return images.find((img: any) => img.type === 'profile') ?? null;
    }
}
