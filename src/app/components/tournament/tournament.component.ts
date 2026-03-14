import { Component, computed, effect, signal } from '@angular/core';
import { NgClass, NgStyle } from '@angular/common';
import { RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { TournamentDataService } from 'src/app/services/tournamentData.service';

@Component({
    selector: 'app-tournament',
    imports: [MatIconModule, RouterLink, NgClass, NgStyle],
    templateUrl: './tournament.component.html',
    styleUrl: './tournament.component.scss',
})
export class TournamentComponent {

    tournament = signal<any>(null);
    private standingColorMap = new Map<number, string>();

    profileImage = computed(() => {
        const t = this.tournament();
        if (!t?.images?.length) return '';
        return (t.images.find((i: any) => i.type === 'profile') ?? t.images[0]).url ?? '';
    });

    bannerImage = computed(() => {
        const t = this.tournament();
        if (!t?.images?.length) return '';
        return (t.images.find((i: any) => i.type === 'banner') ?? t.images[0]).url ?? '';
    });

    formattedDate = computed(() => {
        const t = this.tournament();
        if (!t?.startAt) return '';
        return new Date(t.startAt * 1000).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    });

    googleMapsUrl = computed(() => {
        const t = this.tournament();
        if (!t?.venueAddress) return '';
        return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(t.venueAddress);
    });

    getGameImage(images: any[]): string {
        if (!images?.length) return '';
        return (images.find(i => i.type === 'primary') ?? images[0]).url ?? '';
    }

    getEventDate(startAt: number): string {
        if (!startAt) return '';
        return new Date(startAt * 1000).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    }

    hasTopThree(event: any): boolean {
        const nodes = event.standings?.nodes;
        return nodes?.length === 3 && nodes[0].placement === 1 && nodes[1].placement === 2 && nodes[2].placement === 3;
    }

    getStandingName(standing: any): string {
        return standing.entrant.name;
    }

    getStandingInitial(standing: any): string {
        const name: string = standing.entrant.name;
        const pipeIndex = name.indexOf('|');
        const initial = pipeIndex !== -1 ? name[pipeIndex + 2] : name[0];
        return initial?.toUpperCase() ?? '';
    }

    getOrdinalSuffix(placement: number): string {
        if (placement === 1) return 'st';
        if (placement === 2) return 'nd';
        if (placement === 3) return 'rd';
        return 'th';
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

    private randomColor(): string {
        const hue = Math.floor(Math.random() * 361);
        const sat = Math.floor(Math.random() * 101);
        return `hsl(${hue}, ${sat}%, 40%)`;
    }

    constructor(private tournamentDataService: TournamentDataService) {
        effect(() => {
            const data = this.tournamentDataService.tournamentSource();
            if (data?.name) {
                data.events?.forEach((event: any) => {
                    event.standings?.nodes?.forEach((standing: any) => {
                        if (!this.getStandingProfile(standing)) {
                            const participants = standing.entrant?.participants;
                            if (participants?.length === 1) {
                                const pid = participants[0].id;
                                if (!this.standingColorMap.has(pid)) {
                                    this.standingColorMap.set(pid, this.randomColor());
                                }
                                standing.backgroundColor = this.standingColorMap.get(pid);
                            } else {
                                standing.backgroundColor = this.randomColor();
                            }
                        }
                    });
                });
            }
            this.tournament.set(data?.name ? data : null);
        });
    }
}
