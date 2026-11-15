import { AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, OnDestroy, ViewEncapsulation, computed, effect, signal, untracked } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { RouterLink } from '@angular/router';
import { StartggService } from 'src/app/services/startgg.service';
import { TournamentDataService } from 'src/app/services/tournamentData.service';
import { EventCard, EventKind, EventSort, PlayerRow, filterEvents, finalRows, buildView } from './tournament-view';

// The tournament's page: a header tinted by its banner, the biggest events' results, every event as a
// card, when and where it is, its streams, and when each event starts. tournament-view.ts works out
// what each part says.
@Component({
    selector: 'app-tournament',
    imports: [RouterLink, NgTemplateOutlet],
    templateUrl: './tournament.component.html',
    changeDetection: ChangeDetectionStrategy.Eager,
    styleUrl: './tournament.component.scss',
    // The styles are all under .tp-page, and unscoped so they stay small
    encapsulation: ViewEncapsulation.None,
})
export class TournamentComponent implements AfterViewInit, OnDestroy {

    // Event cards shown before "Show all"
    readonly eventLimit = 8;

    tournament = signal<any>(null);
    view = computed(() => {
        const t = this.tournament();
        return t ? buildView(t, Date.now() / 1000) : null;
    });

    // The events list: its filter, order, and whether every card is shown
    kind = signal<EventKind>('all');
    sort = signal<EventSort>('size');
    showAll = signal(false);
    listedEvents = computed(() => filterEvents(this.view()?.events ?? [], this.kind(), this.sort()));
    shownEvents = computed(() => this.showAll() ? this.listedEvents() : this.listedEvents().slice(0, this.eventLimit));

    // The result shown on a phone, and the tab last jumped to
    resultTab = signal(0);
    activeTab = signal('tp-top');
    // What was just copied: 'link', 'address', or ''
    copied = signal('');

    // Each result event's top 8 by event id, once loaded; until then its card shows the top 3
    private topEight = signal<Record<string, any[]>>({});
    private topEightKey = '';
    private scroller: HTMLElement | null = null;

    constructor(
        private tournamentDataService: TournamentDataService,
        private startggService: StartggService,
        private host: ElementRef<HTMLElement>
    ) {
        effect(() => {
            const data = this.tournamentDataService.tournamentSource();
            const next = data?.name ? data : null;
            if (next?.slug !== untracked(this.tournament)?.slug) {
                this.kind.set('all');
                this.showAll.set(false);
                this.resultTab.set(0);
            }
            this.tournament.set(next);
        });

        // The top 8 of the events in Results: one request, only when there are results to show
        effect(() => {
            const ids = (this.view()?.results ?? []).map(event => event.id);
            const key = ids.join(',');
            if (!ids.length || key === this.topEightKey) return;
            this.topEightKey = key;
            this.startggService.getTournamentResults(ids)
                .then(standings => { if (this.topEightKey === key) this.topEight.set(standings); })
                // The cards keep the top 3 they already show
                .catch(error => console.error(error));
        });
    }

    ngAfterViewInit() {
        this.scroller = this.host.nativeElement.closest('mat-sidenav-content');
        this.scroller?.addEventListener('scroll', this.onScroll, { passive: true });
    }

    ngOnDestroy() {
        this.scroller?.removeEventListener('scroll', this.onScroll);
    }

    // Back at the top, the first tab is the chosen one again
    private onScroll = () => {
        if (this.scroller && this.scroller.scrollTop < 40 && this.activeTab() !== 'tp-top') this.activeTab.set('tp-top');
    };

    // The rows of a result card: the champion first, then up to 2nd to 8th
    rowsOf(event: EventCard): PlayerRow[] {
        const rows = finalRows(this.topEight()[event.id], event.teams, true);
        return rows.length ? rows : event.podium;
    }

    // Scrolls to a section of the page
    go(id: string) {
        this.activeTab.set(id);
        const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        this.host.nativeElement.querySelector('#' + id)?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
    }

    setKind(kind: EventKind) {
        this.kind.set(kind);
    }

    setSort(event: Event) {
        this.sort.set((event.target as HTMLSelectElement).value as EventSort);
    }

    // The phone's share sheet where there is one; otherwise the page's link is copied
    share(title: string) {
        const url = window.location.href;
        if (typeof navigator.share === 'function') navigator.share({ title, url }).catch(() => { });
        else this.copy(url, 'link');
    }

    copy(text: string, what: string) {
        navigator.clipboard?.writeText(text).then(() => {
            this.copied.set(what);
            setTimeout(() => { if (this.copied() === what) this.copied.set(''); }, 1500);
        }).catch(() => { });
    }

    // A picture that failed to load gives way to the initials or the plain box behind it
    hide(event: Event) {
        (event.target as HTMLElement).style.display = 'none';
    }
}
