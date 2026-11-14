import { ChangeDetectionStrategy, Component, ElementRef, OnDestroy, computed, effect, signal, untracked, viewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { StartggError, StartggService } from 'src/app/services/startgg.service';
import { rankIcon, rankingsOf, socialsOf } from 'src/app/services/player-extras';
import { AttendeeDialogComponent } from '../attendee-dialog/attendee-dialog.component';

// One row of the list: an attendee as start.gg's participant, ready to draw
export interface AttendeeRow {
    key: string;
    id: any;
    tag: string;
    sponsor: string;
    image: string;
    // With no picture: the tag's first letter on a color of the attendee's own
    initial: string;
    color: string;
    socials: any[];
    rankings: any[];
    // The events they entered, by name
    events: any[];
    // Their seed in the picked event, when the list is in seed order
    seed: number | null;
}

// A color that stays the same for an attendee on every visit, from their id
export function attendeeColor(id: any): string {
    let hash = 0;
    for (const char of String(id)) hash = (hash * 31 + char.charCodeAt(0)) % 100000;
    return `hsl(${hash % 360}, ${30 + hash % 60}%, 40%)`;
}

// Where the list's rows come from: every attendee of the tournament, one event's attendees, or one
// phase's seeds (an event in seed order)
type Source = { kind: 'all' } | { kind: 'event', eventId: any } | { kind: 'seeds', phaseId: any, teams: boolean };

// A tournament's attendees: an endless list, 50 at a time, with a search box and an event filter.
// Every event: start.gg's player id order. One event: its seed order, with the seed in each row.
@Component({
    selector: 'app-attendees',
    imports: [MatIconModule, MatTooltipModule, RouterLink],
    templateUrl: './attendees.component.html',
    changeDetection: ChangeDetectionStrategy.Eager,
    styleUrls: ['./attendees.component.scss', './attendee-rows.scss'],
})
export class AttendeesComponent implements OnDestroy {

    readonly rankIcon = rankIcon;
    readonly placeholders = [0, 1, 2, 3, 4, 5, 6, 7];

    tournament = signal<any>(null);
    // What the search box holds, and what the list was last asked for (the box, a moment later)
    searchText = signal('');
    search = signal('');
    rows = signal<AttendeeRow[]>([]);
    // How many attendees (or teams) match, once start.gg has said
    total = signal<number | null>(null);
    // What the shown rows are of: the search and event they were asked with, and how they are ordered
    shown = signal<{ search: string, event: any, seeded: boolean, teams: boolean }>({ search: '', event: null, seeded: false, teams: false });
    loading = signal(false);
    done = signal(false);
    failed = signal('');
    // The Discord account whose username was just copied: its tooltip says so for a moment
    copied = signal<any>(null);

    private urlSegments = toSignal(this.route.url);
    private queryParams = toSignal(this.route.queryParamMap);
    // The tournament's slug in the address: /tournament/<slug>/attendees
    private slug = computed(() => this.urlSegments()?.[1]?.path ?? '');
    // The picked event, from ?event=<the last part of its slug>
    event = computed(() => {
        const picked = this.queryParams()?.get('event');
        return picked ? (this.tournament()?.events ?? []).find((event: any) => this.shortSlug(event) === picked) ?? null : null;
    });
    private eventsById = computed(() => new Map<string, any>((this.tournament()?.events ?? []).map((event: any) => [String(event.id), event])));

    private sentinel = viewChild<ElementRef<HTMLElement>>('sentinel');
    private observer: IntersectionObserver | null = null;
    private searchTimer: ReturnType<typeof setTimeout> | null = null;
    // Counts the lists asked for: an answer for an older list is dropped
    private listId = 0;
    // Seeds (teams, in a teams event) or attendees loaded so far, which is where the next request starts
    loaded = signal(0);

    constructor(
        private route: ActivatedRoute,
        private router: Router,
        private dialog: MatDialog,
        private startggService: StartggService
    ) {
        // The tournament's name, time zone, and events. The app's frame asks for the same thing, so this is one request.
        effect(() => {
            const slug = this.slug();
            if (!slug) return;
            this.startggService.getTournamentEvents(slug).then(tournament => {
                if (slug === this.slug()) this.tournament.set(tournament);
            }, () => { /* the app's frame reports it */ });
        });

        // A new list whenever the tournament, the picked event, or the search changes
        const listKey = computed(() => this.tournament() ? `${this.tournament().slug}|${this.event()?.id ?? ''}|${this.search()}` : '');
        effect(() => {
            if (listKey()) untracked(() => this.restart());
        });

        // Endless scroll: the next rows load when the end of the list is near the bottom of the view
        effect(() => {
            const sentinel = this.sentinel()?.nativeElement;
            this.observer?.disconnect();
            if (!sentinel) return;
            this.observer = new IntersectionObserver(entries => {
                if (entries.some(entry => entry.isIntersecting)) this.loadMore();
            }, { root: sentinel.closest('mat-sidenav-content'), rootMargin: '0px 0px 400px 0px' });
            this.observer.observe(sentinel);
        });
    }

    ngOnDestroy() {
        this.observer?.disconnect();
        if (this.searchTimer) clearTimeout(this.searchTimer);
        this.listId++;
    }

    // "melee-singles" of "tournament/genesis-x/event/melee-singles"
    shortSlug(event: any): string {
        return String(event?.slug ?? '').split('/').pop() ?? '';
    }

    onSearchInput(text: string) {
        this.searchText.set(text);
        if (this.searchTimer) clearTimeout(this.searchTimer);
        this.searchTimer = setTimeout(() => this.search.set(text.trim()), 300);
    }

    clearSearch() {
        if (this.searchTimer) clearTimeout(this.searchTimer);
        this.searchText.set('');
        this.search.set('');
    }

    // Picks an event ('' for all of them). It goes in the address, so a link can open the page with it picked.
    pickEvent(shortSlug: string) {
        this.router.navigate([], { relativeTo: this.route, queryParams: { event: shortSlug || null }, queryParamsHandling: 'merge', replaceUrl: true });
    }

    private restart() {
        this.listId++;
        this.loaded.set(0);
        this.loading.set(false);
        this.done.set(false);
        this.failed.set('');
        this.loadMore();
    }

    retry() {
        this.failed.set('');
        this.loadMore();
    }

    async loadMore() {
        if (this.loading() || this.done() || this.failed() || !this.tournament()) return;
        const id = this.listId;
        const offset = this.loaded(), first = offset === 0;
        const search = this.search(), event = this.event();
        this.loading.set(true);
        try {
            const source = await this.sourceOf(event);
            if (id !== this.listId) return;
            const slice = source.kind === 'seeds'
                ? await this.startggService.getSeededAttendees(source.phaseId, offset, { search, teams: source.teams })
                : await this.startggService.getAttendees(this.slug(), offset, { search, eventId: source.kind === 'event' ? source.eventId : null });
            if (id !== this.listId) return;

            let rows: AttendeeRow[];
            if (source.kind === 'seeds') {
                // A search's matches come in start.gg's own order: when they all fit in one page, back in seed order
                const seeds = search && first && slice.done ? [...slice.nodes].sort((a, b) => (a?.seedNum ?? Infinity) - (b?.seedNum ?? Infinity)) : slice.nodes;
                rows = seeds.flatMap(seed => (seed?.entrant?.participants ?? []).map((participant: any) => this.toRow(participant, seed.seedNum ?? null)));
            }
            else rows = slice.nodes.map(participant => this.toRow(participant, null));
            this.loaded.set(offset + slice.nodes.length);

            // The first rows of a new list replace the old list, which stays up until they arrive
            const kept = first ? [] : this.rows();
            if (first && this.rows().length) document.querySelector('mat-sidenav-content')?.scrollTo({ top: 0 });
            const keys = new Set(kept.map(row => row.key));
            this.rows.set([...kept, ...rows.filter(row => !keys.has(row.key) && keys.add(row.key))]);
            this.total.set(slice.total);
            this.shown.set({ search, event, seeded: source.kind === 'seeds', teams: source.kind === 'seeds' && source.teams });
            this.done.set(slice.done || !slice.nodes.length);
        } catch (error) {
            if (id !== this.listId) return;
            console.error(error);
            this.failed.set(error instanceof StartggError ? error.message : 'Something went wrong loading the attendees.');
        } finally {
            if (id === this.listId) {
                this.loading.set(false);
                // A list still shorter than the view needs its next rows without a scroll
                setTimeout(() => this.recheck());
            }
        }
    }

    // Asks the observer again whether the end of the list is in view
    private recheck() {
        const sentinel = this.sentinel()?.nativeElement;
        if (!sentinel || !this.observer) return;
        this.observer.unobserve(sentinel);
        this.observer.observe(sentinel);
    }

    // An event's attendees come in seed order from the seeds of its first phase: the one that holds
    // every entrant. Where no phase does (an event split into divisions, or not seeded yet), they come
    // from the tournament's list, in player id order and without seeds.
    private async sourceOf(event: any): Promise<Source> {
        if (!event) return { kind: 'all' };
        const phases: any[] = (await this.startggService.getEventPhases(event.slug, event.numEntrants))?.phases ?? [];
        const biggest = phases.reduce((best, phase) => (phase?.numSeeds ?? 0) > (best?.numSeeds ?? 0) ? phase : best, null);
        if (biggest && biggest.numSeeds >= (event.numEntrants ?? 0)) return { kind: 'seeds', phaseId: biggest.id, teams: event.type !== 1 };
        return { kind: 'event', eventId: event.id };
    }

    private toRow(participant: any, seed: number | null): AttendeeRow {
        const tag = String(participant?.gamerTag ?? '');
        const events = (participant?.events ?? []).map((event: any) => this.eventsById().get(String(event?.id))).filter((event: any) => event)
            .sort((a: any, b: any) => String(a.name).localeCompare(String(b.name)));
        return {
            key: `${participant?.id}:${seed ?? ''}`,
            id: participant?.id,
            tag,
            sponsor: String(participant?.prefix ?? '').trim(),
            image: participant?.user?.images?.[0]?.url ?? '',
            initial: (tag[0] ?? '').toUpperCase(),
            color: attendeeColor(participant?.id),
            // Twitch, X, Discord: the order of Santi's example row
            socials: socialsOf(participant?.user?.authorizations, ['TWITCH', 'TWITTER', 'DISCORD']),
            rankings: rankingsOf(participant?.player?.rankings),
            events,
            seed,
        };
    }

    // "4,786"
    count(n: number | null): string {
        return Number(n ?? 0).toLocaleString('en-US');
    }

    // "attendees", "team"...: what the count line and the line under the list count
    unit(n: number | null): string {
        return this.shown().teams ? (n === 1 ? 'team' : 'teams') : (n === 1 ? 'attendee' : 'attendees');
    }

    openAttendee(row: AttendeeRow) {
        const phone = window.matchMedia('(max-width: 640px)').matches;
        // On a phone the dialog is a sheet from the bottom
        this.dialog.open(AttendeeDialogComponent, {
            data: { row, tournament: this.tournament() },
            autoFocus: false,
            ariaLabel: row.tag,
            panelClass: phone ? ['attendee-dialog', 'attendee-sheet'] : 'attendee-dialog',
            width: phone ? '100vw' : '600px',
            maxWidth: phone ? '100vw' : 'calc(100vw - 64px)',
            position: phone ? { bottom: '0' } : undefined,
        });
    }

    // Discord has no profile page to link to, so its icon copies the username
    copy(social: any) {
        navigator.clipboard?.writeText(social.username).then(() => {
            this.copied.set(social);
            setTimeout(() => this.copied() === social && this.copied.set(null), 2000);
        }, () => { });
    }
}
