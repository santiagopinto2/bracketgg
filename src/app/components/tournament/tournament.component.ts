import { Component, computed, effect, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { TournamentDataService } from 'src/app/services/tournamentData.service';

@Component({
    selector: 'app-tournament',
    imports: [MatIconModule, RouterLink],
    templateUrl: './tournament.component.html',
    styleUrl: './tournament.component.scss',
})
export class TournamentComponent {

    tournament = signal<any>(null);

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

    constructor(private tournamentDataService: TournamentDataService) {
        effect(() => {
            const data = this.tournamentDataService.tournamentSource();
            this.tournament.set(data?.name ? data : null);
        });
    }
}
