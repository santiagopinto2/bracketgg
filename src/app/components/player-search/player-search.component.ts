import { AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, OnDestroy, Signal, computed, inject, signal } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { PlayerAvatarComponent } from './player-avatar.component';
import { PlayerTrack } from './player-track';

export interface PlayerSearchData {
    // The shown phase's players. A signal, so the list grows while the phase's pools are still loading.
    tracks: Signal<PlayerTrack[]>;
    phaseName: string;
    // The event's other phases, for when nobody here matches
    otherPhases: { id: any, name: string }[];
    // What the box starts with
    text: string;
    // Full screen, above the keyboard
    phone: boolean;
}

// What the search closes with: the player picked, or another phase to search with the same text
export type PlayerSearchResult = { player: PlayerTrack } | { phase: { id: any, name: string }, text: string } | undefined;

interface Segment { text: string; hit: boolean; }
interface Item { track: PlayerTrack; index: number; sponsor: Segment[]; name: Segment[]; }

// The most rows drawn at once. A phase can have over a thousand players; typing narrows the list.
const LIMIT = 100;

// A name cut around the part that matches, which is underlined
function segments(text: string, query: string): Segment[] {
    const at = query ? text.toLowerCase().indexOf(query) : -1;
    if (at < 0) return text ? [{ text, hit: false }] : [];
    return [
        { text: text.slice(0, at), hit: false },
        { text: text.slice(at, at + query.length), hit: true },
        { text: text.slice(at + query.length), hit: false },
    ].filter(segment => segment.text);
}

// The bracket's player search: a large box over the bracket (the whole screen on a phone) that lists
// the shown phase's players, those still in first, and closes with the one picked.
@Component({
    selector: 'app-player-search',
    templateUrl: './player-search.component.html',
    styleUrls: ['./player-search.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [MatIconModule, PlayerAvatarComponent]
})
export class PlayerSearchComponent implements AfterViewInit, OnDestroy {

    data: PlayerSearchData = inject(MAT_DIALOG_DATA);
    private dialogRef: MatDialogRef<PlayerSearchComponent, PlayerSearchResult> = inject(MatDialogRef);
    private host: HTMLElement = inject(ElementRef).nativeElement;

    text = signal(this.data.text ?? '');
    // The row the arrow keys are on, counted through both groups
    active = signal(0);

    // Every player in seed order, with their name in lower case to search in
    private players = computed(() => this.data.tracks()
        .map(track => {
            const name: string = track.entrant?.name ?? '', sponsor: string = track.entrant?.sponsor ?? '';
            return { track, name, sponsor, lower: `${sponsor} | ${name}`.toLowerCase() };
        })
        .sort((a, b) => (a.track.seed ?? Infinity) - (b.track.seed ?? Infinity)));

    // The matches in their two groups. With nothing typed, everyone.
    shown = computed(() => {
        const players = this.players();
        const query = this.text().trim().toLowerCase();
        const matches = query ? players.filter(player => player.lower.includes(query)) : players;
        // Once nobody is still in, the second group is the whole phase and includes its winner
        const outLabel = players.some(player => player.track.status.in) ? 'Out' : 'Finished';
        const groups: { label: string, count: number, items: Item[] }[] = [];
        let index = 0;
        for (const [label, stillIn] of [['Still in', true], [outLabel, false]] as [string, boolean][]) {
            const list = matches.filter(player => player.track.status.in === stillIn);
            const items = list.slice(0, Math.max(0, LIMIT - index)).map(player => ({
                track: player.track, index: index++, sponsor: segments(player.sponsor, query), name: segments(player.name, query),
            }));
            if (items.length) groups.push({ label, count: list.length, items });
        }
        return { groups, items: groups.flatMap(group => group.items), total: matches.length, more: matches.length - index };
    });

    private viewport = window.visualViewport;
    private fit = () => {
        // The phone's keyboard covers the bottom of the screen without making the page shorter, so the
        // panel takes the size and place of what is left to see
        const pane = this.host.closest<HTMLElement>('.cdk-overlay-pane');
        if (!pane || !this.viewport) return;
        pane.style.height = `${this.viewport.height}px`;
        pane.style.transform = `translateY(${this.viewport.offsetTop}px)`;
    };

    ngAfterViewInit() {
        if (!this.data.phone || !this.viewport) return;
        this.fit();
        this.viewport.addEventListener('resize', this.fit);
        this.viewport.addEventListener('scroll', this.fit);
        window.addEventListener('resize', this.fit);
    }

    ngOnDestroy() {
        this.viewport?.removeEventListener('resize', this.fit);
        this.viewport?.removeEventListener('scroll', this.fit);
        window.removeEventListener('resize', this.fit);
    }

    onInput(value: string) {
        this.text.set(value);
        this.active.set(0);
        this.host.querySelector('.ps-body')?.scrollTo({ top: 0 });
    }

    onKeydown(event: KeyboardEvent) {
        const items = this.shown().items;
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            if (!items.length) return;
            const step = event.key === 'ArrowDown' ? 1 : -1;
            this.active.set(Math.min(items.length - 1, Math.max(0, this.active() + step)));
            // Once the row is drawn as the active one
            setTimeout(() => this.host.querySelector('.ps-row.active')?.scrollIntoView({ block: 'nearest' }));
        } else if (event.key === 'Enter') {
            event.preventDefault();
            const item = items[Math.min(this.active(), items.length - 1)];
            if (item) this.pick(item.track);
        }
    }

    pick(track: PlayerTrack) {
        this.dialogRef.close({ player: track });
    }

    searchPhase(phase: { id: any, name: string }) {
        this.dialogRef.close({ phase, text: this.text().trim() });
    }

    close() {
        this.dialogRef.close();
    }
}
