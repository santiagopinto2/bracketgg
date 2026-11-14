import { AfterViewInit, ChangeDetectorRef, Component, NgZone, OnDestroy, OnInit, ViewChildren, effect, computed, signal, ChangeDetectionStrategy } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { StartggError, StartggService } from 'src/app/services/startgg.service';
import { TournamentDataService } from 'src/app/services/tournamentData.service';
import { SetOrderConstants } from './set-order-constants';
import { picksBySide } from '../set/character-picks';
import { Location, NgStyle, NgClass } from '@angular/common';
import { MatButtonModule, MatIconButton } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatInputModule } from '@angular/material/input';
import { FormControl, FormsModule, ReactiveFormsModule } from '@angular/forms';
import { MatDialog } from '@angular/material/dialog';
import { SetComponent } from '../set/set.component';
import { LoadingService } from 'src/app/services/loading.service';
import { DeviceDetectorService } from 'ngx-device-detector';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { toSignal } from '@angular/core/rxjs-interop';

@Component({
    selector: 'app-event',
    templateUrl: './event.component.html',
    styleUrls: ['./event.component.scss'],
    changeDetection: ChangeDetectionStrategy.Eager,
    imports: [MatIconButton, MatIconModule, NgStyle, NgClass, MatFormFieldModule, MatAutocompleteModule, MatInputModule, FormsModule, ReactiveFormsModule, MatButtonModule, MatCheckboxModule, MatMenuModule, RouterLink]
})
export class EventComponent implements OnInit, AfterViewInit, OnDestroy {

    isDesktop = false;
    scrollToTopOffset = 20;
    scrollToTopBottomOffset = 20;
    // The back-to-top button shows once the bracket is scrolled away from its top left corner
    showScrollToTop = signal(false);
    private listeners = new AbortController();
    eventId = -1;
    // The event's name and slug, for the link back to its landing page
    eventName = '';
    eventSlug = '';
    // The shown phase's id, also for a phase the event's list doesn't have
    phaseId = null;
    // The pool a /brackets/<phase id>/<pool id> link names. It loads first; the page stays at the top.
    poolId = null;
    // Where the link that opened this phase points: its pool, and the player (?player=, from a set's
    // progression tag) or the set (?set=, the history entry a followed tag leaves behind) to center.
    // `done` once the bracket has scrolled there, so each visit scrolls at most once.
    private arrival: { poolId: any, playerId: any, setId: any, done: boolean } | null = null;
    // The visitor scrolled, dragged or pressed a key since the phase began to load: the bracket no longer scrolls for them
    private userMoved = false;
    // What the bracket scrolled to for the link: a set, centered, or a pool, at the top of the view
    private arrivedAt: HTMLElement | null = null;
    // The set the bracket scrolled to, outlined for a few seconds
    highlightedSetId: string | null = null;
    private highlightTimer: any;
    private hoverTimer: any;
    // The shown phase's players by entrant id, with their pictures, loading alongside its sets
    playersById: Promise<Map<any, any>> = Promise.resolve(new Map());
    // The color of each player without a picture, kept while the event stays the same
    colorsById = new Map<any, string>();
    // A newer phase load makes older ones stale, so they stop instead of mixing two phases' data
    loadId = 0;
    entrants = signal<any[]>([]);
    entrantCtrl = new FormControl<string | { name: string }>('');
    entrantCtrlValue = toSignal(this.entrantCtrl.valueChanges, { initialValue: '' });
    filteredEntrants = computed(() => {
        const value = this.entrantCtrlValue() || '';
        const filterValue = typeof value === 'string' ? value.toLowerCase() : value.name?.toLowerCase() || '';
        const currentEntrants = this.entrants();
        return filterValue ? currentEntrants.filter(entrant => entrant.name.toLowerCase().includes(filterValue)) : currentEntrants.slice();
    });
    phases = [];
    currentPhaseIndex = -1;
    phaseGroups = [];
    projected = [];
    maxRounds = [];
    maxRoundModifier = [1, -1];
    maxRoundsPhase = -1;
    canHover = true;
    playerHovered = -1;
    isGrabbing = false;
    showUpsets = false;
    showProjected = false;
    // setHeight should be a multiple of 4 plus 0.67
    setHeight = 52.67;

    @ViewChildren('slot') slotElements: any;

    constructor(
        private startggService: StartggService,
        private tournamentDataService: TournamentDataService,
        private loadingService: LoadingService,
        private deviceService: DeviceDetectorService,
        private dialog: MatDialog,
        private router: Router,
        private location: Location,
        private cdr: ChangeDetectorRef,
        private zone: NgZone
    ) {
        this.isDesktop = this.deviceService.isDesktop();

        // Watch for tournament source changes using effect
        effect(() => {
            const tournament = this.tournamentDataService.tournamentSource();
            const event = tournament.event;

            // Clear data
            this.phases = [];
            this.currentPhaseIndex = -1;
            this.phaseGroups = [];
            this.projected = [];
            this.maxRounds = [];
            this.maxRoundsPhase = -1;
            this.entrants.set([]);
            this.playerHovered = -1;
            this.arrival = null;
            this.arrivedAt = null;
            this.userMoved = false;
            this.highlightedSetId = null;
            clearTimeout(this.highlightTimer);

            // Clear this data only if there is no event
            if (!event || !event.phaseId) {
                this.eventId = -1;
                this.eventName = '';
                this.eventSlug = '';
                this.phaseId = null;
                this.playersById = Promise.resolve(new Map());
                this.colorsById = new Map();
                this.loadId++;
            }
            else {
                // Players keep their colors across the event's phases
                if (event.event.id != this.eventId) {
                    this.eventId = event.event.id;
                    this.colorsById = new Map();
                }

                this.eventName = event.event.name;
                this.eventSlug = event.slug;
                this.phaseId = event.phaseId;
                this.poolId = event.poolId ?? null;
                // A plain pool link names no player and no set: its phase opens at the top of the page
                if (event.playerId || event.setId) {
                    this.arrival = { poolId: event.poolId ?? null, playerId: event.playerId ?? null, setId: event.setId ?? null, done: false };
                }

                // Get all phase and phase group data
                this.phases = event.event.phases;
                this.currentPhaseIndex = this.phases.findIndex(phase => phase.id == event.phaseId);
                this.playersById = this.loadPlayers(event.phaseId, this.phases[this.currentPhaseIndex]?.numSeeds, event.event.type === 1);
                this.getPhase(event.phaseId);
            }

            setTimeout(() => {
                this.getScrollToTopOffset();
            });
        });
    }

    ngOnInit() {
        this.showUpsets = localStorage.getItem('showUpsets') === 'true';
        this.showProjected = localStorage.getItem('showProjected') === 'true';
    }

    ngAfterViewInit() {
        // Outside Angular, so scrolling doesn't run change detection on every frame. The signal still updates the view.
        this.zone.runOutsideAngular(() => {
            const content = document.querySelector<HTMLElement>('mat-sidenav-content');
            content.addEventListener('scroll', () => {
                this.showScrollToTop.set(content.scrollTop > 200 || content.scrollLeft > 200);
            }, { passive: true, signal: this.listeners.signal });

            // A visitor who has started moving around is not scrolled to where a link pointed (arrive)
            const moved = () => this.userMoved = true;
            for (const type of ['wheel', 'touchstart', 'mousedown']) content.addEventListener(type, moved, { passive: true, signal: this.listeners.signal });
            window.addEventListener('keydown', moved, { passive: true, signal: this.listeners.signal });
            // Pools can be drawn above the one being looked at. drawPool keeps the view in place itself, so
            // the browser's own scroll anchoring, which only some browsers have, must not do it too.
            content.style.overflowAnchor = 'none';
        });

        // Horizontal and vertical drag

        let mouseDown = false;
        let startX, scrollLeft, startY, scrollTop;
        const sidenavContentElement = document.querySelector<HTMLElement>('.mat-sidenav-content');

        const startDragging = event => {
            this.isGrabbing = true;
            mouseDown = true;

            startX = event.pageX - sidenavContentElement.offsetLeft;
            scrollLeft = sidenavContentElement.scrollLeft;

            startY = event.pageY - sidenavContentElement.offsetTop;
            scrollTop = sidenavContentElement.scrollTop;
        }

        const stopDragging = event => {
            this.isGrabbing = false;
            mouseDown = false;
        }

        const move = event => {
            event.preventDefault();
            if (!mouseDown) return;

            const x = event.pageX - sidenavContentElement.offsetLeft;
            const horizontalScroll = x - startX;
            sidenavContentElement.scrollLeft = scrollLeft - horizontalScroll;

            const y = event.pageY - sidenavContentElement.offsetTop;
            const verticalScroll = y - startY;
            sidenavContentElement.scrollTop = scrollTop - verticalScroll;
        }

        sidenavContentElement.addEventListener('mousemove', move, false);
        sidenavContentElement.addEventListener('mousedown', startDragging, false);
        sidenavContentElement.addEventListener('mouseup', stopDragging, false);
        sidenavContentElement.addEventListener('mouseleave', stopDragging, false);
    }

    // Fixes up an entrant from start.gg for display: sponsor split off the name, and a color when there's no avatar
    prepareEntrant(entrant) {
        if (!entrant.participants?.length) entrant.participants = [{ gamerTag: entrant.name || '?', user: null }];
        if (!entrant.participants[0].user) entrant.participants[0].user = { images: [] };

        if (!entrant.backgroundColor && this.getEntrantImage(entrant) === '') entrant.backgroundColor = this.colorFor(entrant.id);

        entrant.name = entrant.name ?? '';
        let pipeIndex = entrant.name.lastIndexOf('|');
        if (pipeIndex != -1) {
            entrant.sponsor = entrant.name.slice(0, pipeIndex - 1);
            entrant.name = entrant.name.slice(pipeIndex + 2);
        }
        return entrant;
    }

    // A player's random color, the same each time they appear in this event
    colorFor(entrantId): string {
        let color = this.colorsById.get(entrantId);
        if (!color) {
            const hue = Math.floor(Math.random() * 361);
            const sat = Math.floor(Math.random() * 101);
            const lum = 40;
            color = `hsl(${hue}, ${sat}%, ${lum}%)`;
            if (entrantId != null) this.colorsById.set(entrantId, color);
        }
        return color;
    }

    // The phase's players by entrant id. Those without a picture get their colors here, in seed order.
    // If start.gg won't answer, the bracket still draws: each set names its players, who then show
    // colored initials instead of pictures.
    // `singles` (start.gg's event type 1) picks the page size.
    async loadPlayers(phaseId, numSeeds, singles): Promise<Map<any, any>> {
        try {
            const players = await this.startggService.getPhaseEntrants(phaseId, numSeeds, singles);
            for (const player of players) if (!player.participants?.[0]?.user?.images?.length) this.colorFor(player.id);
            return new Map(players.map(player => [player.id, player]));
        } catch (error) {
            console.warn('Could not load the players of this phase', error);
            return new Map();
        }
    }

    async getPhase(phaseId) {
        const loadId = ++this.loadId;
        try {
            let phase = await this.startggService.getPhase(phaseId);
            if (loadId !== this.loadId) return;

            // Only elimination brackets can be drawn. Round robin and Swiss get a message, not a spinner.
            if (phase.bracketType && !['SINGLE_ELIMINATION', 'DOUBLE_ELIMINATION'].includes(phase.bracketType)) {
                throw new StartggError(`This phase is a ${phase.bracketType.toLowerCase().replace(/_/g, ' ')}. Only single and double elimination brackets can be drawn.`);
            }

            // With several pools, fetch them in runs of pool slices and draw each pool, in order, as soon as
            // all of its sets are in. Each pool goes in its own slot, so the pools keep their order.
            // The pool a link names loads first. A link that also names a player or a set is scrolled to it
            // as soon as that pool is drawn (arrive), without waiting for the others.
            const groups = phase.phaseGroups.nodes;
            const phaseGroupPromises = [];
            const progression = this.sendsPlayersOn(phaseId);
            for (let i = 0; i < groups.length; i++) this.maxRounds.push([]);
            if (groups.length > 1) {
                const indexOf = new Map<any, number>(groups.map((group, i): [any, number] => [group.id, i]));
                const first = groups.find(group => group.id == this.poolId);
                const order = first ? [first, ...groups.filter(group => group !== first)] : groups;
                const expected = new Map<any, number>(order.map((group): [any, number] => [group.id, group.sets?.pageInfo?.total ?? 0]));
                await this.startggService.getPhaseSetsByPool(phaseId, expected, (poolId, sets) => {
                    if (loadId !== this.loadId) return;
                    const i = indexOf.get(poolId);
                    phaseGroupPromises.push(this.getPhaseGroup(groups[i], i, loadId, sets));
                }, progression);
            } else {
                for (let i = 0; i < groups.length; i++) phaseGroupPromises.push(this.getPhaseGroup(groups[i], i, loadId, null, progression));
            }
            if (loadId !== this.loadId) return;

            await Promise.all(phaseGroupPromises);
            if (loadId !== this.loadId) return;
            this.loadingService.updateValue(false);
            // A link with no pool, or to a pool that isn't here: look for its player or set in the whole phase
            this.arrive();
        } catch (error) {
            if (loadId !== this.loadId) return;
            console.error(error);
            this.loadingService.error(error instanceof StartggError ? error.message : 'Could not draw this bracket.');
        }
    }

    // `prefetched` is this pool's sets from the phase's pool slices, or null to fetch the pool alone,
    // with where its sets send their players if `progression`
    async getPhaseGroup(phaseGroup, phaseGroupIndex, loadId, prefetched = null, progression = false) {
        let phaseGroupSetsRes = prefetched
            ? { nodes: prefetched }
            : await this.startggService.getPhaseGroupSets(phaseGroup.id, phaseGroup.sets.pageInfo.total, progression);
        if (loadId !== this.loadId || phaseGroupSetsRes.nodes.length == 0) return;

        phaseGroup.sets = phaseGroupSetsRes;
        let phaseGroupSets = phaseGroup.sets.nodes;

        const playersById = await this.playersById;
        if (loadId !== this.loadId) return;

        // Add entrant data to each set and add unique entrants to entrant list. The set itself carries
        // each entrant's current name and seed, so an entrant missing from the cached list still shows.
        const newEntrants = [];
        const seen = new Set(this.entrants().map(e => e.id));
        phaseGroupSets.forEach(set => {
            set.slots.forEach(slot => {
                if (!slot?.entrant) return;
                // Name and seed come from the set (always fresh), the picture from the phase's player list
                const listed = playersById.get(slot.entrant.id);
                const entrant = this.prepareEntrant({ ...slot.entrant, participants: listed?.participants });
                slot.entrant.name = entrant.name;
                slot.entrant.sponsor = entrant.sponsor;
                slot.entrant.participants = entrant.participants;
                slot.entrant.initialSeedNum = entrant.initialSeedNum;
                slot.entrant.backgroundColor = entrant.backgroundColor;
                if (!seen.has(slot.entrant.id)) {
                    seen.add(slot.entrant.id);
                    newEntrants.push(slot.entrant);
                }
            });
        });
        if (newEntrants.length) this.entrants.update(entrants => [...entrants, ...newEntrants]);
        this.entrantCtrl.setValue('');

        // A grand final reset shares the grand final's round: a played one gets its own column after it,
        // an unplayed one is dropped. start.gg sometimes lists it before the grand final, so look for it.
        let resetIndex = phaseGroupSets.findIndex(set => set.fullRoundText === 'Grand Final Reset');
        if (resetIndex >= 0) {
            if (phaseGroupSets[resetIndex].slots[0]?.entrant) phaseGroupSets[resetIndex].round++;
            else phaseGroupSets.splice(resetIndex, 1);
        }

        // Standardizes the round data for each set. Single elimination has no losers rounds to shift.
        let winnersIndex = phaseGroupSets.findIndex(set => set.round > 0);
        if (winnersIndex > 0) {
            let losersRoundChange = Math.abs(phaseGroupSets[winnersIndex - 1].round) - 1;
            if (losersRoundChange != 0) {
                for (let i = 0; i < winnersIndex; i++) phaseGroupSets[i].round += losersRoundChange;
            }
        }

        // Sorts the round data
        phaseGroupSets.sort((a, b) => {
            if (a.round != b.round) return a.round - b.round;
            if (isNaN(a.id) && a.id.includes('preview_')) {
                let aEndId = Number(a.id.slice(a.id.lastIndexOf('_') + 1));
                let bEndId = Number(b.id.slice(b.id.lastIndexOf('_') + 1));
                return aEndId - bEndId;
            }
            return a.id - b.id;
        });

        // Stores the max round number for each side of bracket and updates the max rounds for the phase.
        // A single elimination pool has only the winners side, so only that side is drawn.
        let winnersMaxRound = phaseGroupSets[phaseGroupSets.length - 1].round;
        let losersMaxRound = phaseGroupSets[0].round < 0 ? Math.abs(phaseGroupSets[0].round) : 0;
        this.maxRounds[phaseGroupIndex] = losersMaxRound ? [winnersMaxRound, losersMaxRound] : [winnersMaxRound];
        this.maxRoundsPhase = Math.max(this.maxRoundsPhase, winnersMaxRound, losersMaxRound);

        // Convert set data into arrays
        phaseGroup.sets.nodes = [[], []];
        for (let i = 0; i < winnersMaxRound; i++) phaseGroup.sets.nodes[0].push(Array.from(phaseGroupSets.filter(set => set.round == i + 1)));
        for (let i = 0; i < losersMaxRound; i++) phaseGroup.sets.nodes[1].push(Array.from(phaseGroupSets.filter(set => set.round == (i + 1) * -1)));

        // Where each set of a round with byes goes, from start.gg's links between sets
        phaseGroup.byeLayouts = phaseGroup.sets.nodes.map(rounds => this.getByeLayouts(rounds));

        // Organize set games data
        phaseGroupSets.forEach(set => {
            if (set.games) {
                set.games.forEach(game => game.picks = picksBySide(game, set.slots));
            }
        });

        // The tags beside the sets that send a player to a later phase
        phaseGroupSets.forEach(set => set.progression = this.progressionTags(set));

        // Calculate the number of players per phase group
        phaseGroup.numPlayers = this.getNumberOfPlayers(phaseGroup);

        // Set all projected sets of the phase group. If projecting fails on a bracket shape it doesn't
        // know, "Show Projected" shows the real sets instead of the page failing to draw.
        try {
            this.projected[phaseGroupIndex] = this.getProjected(phaseGroup);
        } catch (error) {
            console.warn('Could not project this pool', error);
            this.projected[phaseGroupIndex] = phaseGroup.sets.nodes;
        }

        // Finally set the phase group
        this.drawPool(phaseGroupIndex, phaseGroup);
        if (phaseGroup.id == this.arrival?.poolId) this.arrive();

        setTimeout(() => {
            this.getScrollToTopOffset();
        });
    }

    // Whether the phase's sets can send players to a later phase: some phase of the event names it as
    // where its players come from. Only then are the sets asked where their players go, which costs 2
    // of start.gg's objects per set. A phase the event's list doesn't have is asked, to be safe.
    sendsPlayersOn(phaseId): boolean {
        if (!this.phases.some(phase => phase.id == phaseId)) return true;
        return this.phases.some(phase => phase.progressingInData?.some(source => source?.origin == phaseId));
    }

    // The tags of a set that sends its winner, its loser or both to a later phase: where each goes and
    // the link there. Once the set is played the link carries the player (?player=<entrant id>, the
    // same id in every phase of an event), for the next phase to scroll to them.
    progressionTags(set) {
        const seeds = [['Winner', set.winnerProgressionSeed], ['Loser', set.loserProgressionSeed]].filter(([, seed]) => seed?.phase?.id != null && seed.phase.id != this.phaseId);
        return seeds.map(([who, seed]) => {
            const listed = this.phases.find(phase => phase.id == seed.phase.id);
            const phaseName = seed.phase.name || listed?.name || 'Next phase';
            // A phase with one pool needs no pool name
            const poolName = seed.phaseGroup?.displayIdentifier && listed?.groupCount != 1 ? `Pool ${seed.phaseGroup.displayIdentifier}` : '';
            let entrantId = null;
            if (set.winnerId && set.slots.every(slot => slot?.entrant)) {
                entrantId = set.slots.find(slot => (slot.entrant.id == set.winnerId) == (who == 'Winner'))?.entrant.id ?? null;
            }
            return {
                who,
                // "W" and "L" tell the two tags apart when both players go on
                short: seeds.length > 1 ? who[0] : '',
                label: poolName ? `${phaseName} · ${poolName}` : phaseName,
                title: `${who} goes to ${phaseName}${poolName ? ', ' + poolName : ''}`,
                entrantId,
                href: `/${this.eventSlug}/brackets/${seed.phase.id}${seed.phaseGroup?.id != null ? '/' + seed.phaseGroup.id : ''}${entrantId != null ? '?player=' + entrantId : ''}`,
            };
        });
    }

    // A click on a progression tag opens the phase it names. The history entry left behind names this
    // pool and set, so Back returns to the set the tag was on instead of the top of the phase.
    followProgression(event: MouseEvent, phaseGroup, set, tag) {
        // Not a click on the set, which would open its dialog
        event.stopPropagation();
        // The browser opens a new tab or window itself
        if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        if (this.phaseId != null && phaseGroup?.id != null) {
            this.location.replaceState(`/${this.eventSlug}/brackets/${this.phaseId}/${phaseGroup.id}`, `set=${encodeURIComponent(set.id)}`);
        }
        this.router.navigateByUrl(tag.href);
    }

    // Draws a pool whose sets are in. Pools can come out of order (the one a link names loads first), and
    // a pool drawn above what the visitor is looking at would push it down the page. So the bracket goes
    // back to where the link pointed, or, once the visitor has moved, scrolls by as much as a pool above
    // the top of the view grew. Both happen in the same frame as the drawing.
    private drawPool(phaseGroupIndex, phaseGroup) {
        const content = document.querySelector<HTMLElement>('mat-sidenav-content');
        const row = document.querySelector<HTMLElement>(`[data-pool-index="${phaseGroupIndex}"]`);
        const follow = !!this.arrivedAt && !this.userMoved;
        const above = !follow && !!content && !!row && row.getBoundingClientRect().top < content.getBoundingClientRect().top;
        const heightBefore = above ? row.getBoundingClientRect().height : 0;
        this.phaseGroups[phaseGroupIndex] = phaseGroup;
        if (!follow && !above) return;
        this.cdr.detectChanges();
        if (follow) this.showArrival();
        else content.scrollTop += row.getBoundingClientRect().height - heightBefore;
    }

    // Takes the visitor where the link pointed, once per visit: the set named in the link, or the
    // player's first set, centered and outlined for a few seconds; without either (the player isn't
    // placed in this phase yet, say), the top of the pool. Called when the link's pool is drawn and
    // again when the whole phase is. A visitor who has already started moving around is left alone.
    private arrive() {
        const arrival = this.arrival;
        if (!arrival || arrival.done) return;
        arrival.done = true;
        if (this.userMoved) return;
        this.cdr.detectChanges();

        const content = document.querySelector<HTMLElement>('mat-sidenav-content');
        const pool = arrival.poolId ? document.getElementById('pool-' + arrival.poolId) : null;
        const setId = arrival.setId ?? this.firstSetOf(arrival.playerId, arrival.poolId);
        const set = setId == null ? null
            : Array.from((pool ?? content).querySelectorAll<HTMLElement>('[data-set-id]')).find(element => element.getAttribute('data-set-id') == String(setId));
        this.arrivedAt = set ?? pool;
        this.showArrival();
        if (!set) return;
        this.highlightedSetId = String(setId);
        if (arrival.playerId != null && !arrival.setId) this.playerHovered = arrival.playerId;
        clearTimeout(this.highlightTimer);
        this.highlightTimer = setTimeout(() => this.highlightedSetId = null, 3500);
    }

    // Scrolls, at once, to what the link pointed at: a set to the middle of the view, a pool to its top.
    // A short page can't scroll that far yet, so this runs again as more pools are drawn (drawPool).
    private showArrival() {
        const target = this.arrivedAt;
        if (!target?.isConnected) return;
        // After a scroll the browser tells whatever is now under a resting mouse that it is hovered.
        // That must not move the highlight from the link's player to someone else.
        this.canHover = false;
        clearTimeout(this.hoverTimer);
        this.hoverTimer = setTimeout(() => this.canHover = true, 600);
        if (!target.hasAttribute('data-set-id')) {
            target.scrollIntoView({ block: 'start', behavior: 'instant' });
            return;
        }
        const content = document.querySelector<HTMLElement>('mat-sidenav-content');
        const box = content.getBoundingClientRect();
        const place = target.getBoundingClientRect();
        content.scrollTo({
            left: content.scrollLeft + place.left - box.left - (box.width - place.width) / 2,
            top: content.scrollTop + place.top - box.top - (box.height - place.height) / 2,
            behavior: 'instant'
        });
    }

    // The first set a player plays in the phase: the one they don't reach from another of their sets
    // (a player who comes in on the losers side and reaches the grand final has sets on both sides).
    // Looks in the named pool if it is drawn, otherwise in every pool.
    private firstSetOf(playerId, poolId) {
        if (playerId == null) return null;
        const drawn = this.phaseGroups.filter(phaseGroup => phaseGroup);
        const named = drawn.filter(phaseGroup => phaseGroup.id == poolId);
        for (const phaseGroup of named.length ? named : drawn) {
            const slotOf = set => set.slots.find(slot => slot?.entrant?.id == playerId);
            // Winners rounds, then losers rounds, each from its first round
            const sets = phaseGroup.sets.nodes.flat(2).filter(set => slotOf(set));
            const ids = new Set(sets.map(set => String(set.id)));
            const first = sets.find(set => !(slotOf(set).prereqType === 'set' && ids.has(String(slotOf(set).prereqId)))) ?? sets[0];
            if (first) return first.id;
        }
        return null;
    }

    // Fills every empty slot with who would get there if the higher seed won each set from here on.
    // Each slot says where its player comes from (prereqType "set", prereqId, prereqPlacement 1 for
    // the winner or 2 for the loser), so this follows start.gg's own links and works for any bracket
    // shape, including later phases whose losers bracket starts with players from an earlier phase.
    getProjected(phaseGroup) {
        let projectedPhaseGroup = structuredClone(phaseGroup.sets.nodes);
        let setsById = new Map<string, any>(projectedPhaseGroup.flat(2).map(set => [String(set.id), set]));
        let done = new Set<string>();

        const fill = (set, depth) => {
            if (done.has(String(set.id)) || depth > 64) return;
            done.add(String(set.id));
            // The reset is only played if the losers side wins the grand final, so it isn't projected
            if (set.fullRoundText === 'Grand Final Reset') return;
            set.slots.forEach((slot, slotIndex) => {
                if (slot.entrant || slot.prereqType !== 'set') return;
                let source = setsById.get(String(slot.prereqId));
                if (!source) return;
                fill(source, depth + 1);
                let advancing = this.getSetPlacement(source, slot.prereqPlacement);
                if (advancing.entrant) set.slots[slotIndex] = this.setProjectedSlot(advancing);
            });
        };
        setsById.forEach(set => fill(set, 0));

        return projectedPhaseGroup;
    }

    // The slot that finishes a set in `placement` (1 winner, 2 loser): the real result if the set is
    // done, else the higher seed wins
    getSetPlacement(set, placement) {
        let slots = set.slots;
        if (set.winnerId && slots[0].entrant && slots[1].entrant) {
            let winner = slots.find(slot => slot.entrant.id == set.winnerId);
            let loser = slots.find(slot => slot.entrant.id != set.winnerId);
            if (winner && loser) return structuredClone(placement == 1 ? winner : loser);
        }
        return this.getLowerHigherSeed(slots, placement != 1);
    }

    setProjectedSlot(slot) {
        let newSlot = structuredClone(slot);
        newSlot.isProjected = true;
        if (newSlot.standing) newSlot.standing.stats.score.value = null;
        return newSlot;
    }

    getLowerHigherSeed(slots, isLower) {
        if (!slots[0].entrant || !slots[1].entrant) return { entrant: null, standing: null };
        if (isLower) return structuredClone(slots.reduce((prev, current) => prev.entrant.initialSeedNum > current.entrant.initialSeedNum ? prev : current));
        return structuredClone(slots.reduce((prev, current) => prev.entrant.initialSeedNum < current.entrant.initialSeedNum ? prev : current));
    }

    isProjected(slot) {
        return slot.isProjected ? 'projected' : '';
    }

    getRoundSets(phaseGroup, side, round, phaseGroupIndex = null) {
        if (!phaseGroup) return [];
        round = Math.abs(Math.trunc(round));

        if (this.showProjected && phaseGroupIndex != null) {
            return this.projected[phaseGroupIndex][side][round - 1];
        }
        return phaseGroup.sets.nodes[side][round - 1];
    }

    // One side's rounds with byes, each laid out against the round after it (see getByeLayout), or
    // null for a round that is full or whose links are missing. A round's sets are put in drawing order.
    getByeLayouts(rounds) {
        let layouts = rounds.map(() => null);
        // From the last round back, so each round is placed against a round that is already in order
        for (let i = rounds.length - 2; i >= 0; i--) {
            if (layouts[i + 1]) continue;
            layouts[i] = this.getByeLayout(rounds[i], rounds[i + 1]);
            if (layouts[i]) rounds[i].sort((a, b) => layouts[i].spans.get(String(a.id))[0] - layouts[i].spans.get(String(b.id))[0]);
        }
        return layouts;
    }

    // A round with byes has fewer sets than a full one. start.gg numbers the hidden bye sets too, so
    // the set ids don't say where a set goes; the next round's slots do (prereqId). The round is drawn
    // on a grid of `full` places: as many as the next round when it has fewer sets than that round, each
    // set beside the set it feeds, or twice as many when it has more, two sets feeding one set side by
    // side and a set feeding one alone centered on two places. `spans` has each set's [first, end)
    // places, `feeders` how many of this round's sets feed each set of the next round.
    getByeLayout(sets, nextSets) {
        let setCount = sets.length;
        let nextSetCount = nextSets?.length ?? 0;
        if (!nextSetCount || setCount == nextSetCount || setCount == nextSetCount * 2) return null;
        let full = setCount < nextSetCount ? nextSetCount : nextSetCount * 2;
        if (setCount > full) return null;

        let indexOf = new Map<string, number>(sets.map((set, i) => [String(set.id), i]));
        let spans = new Map<string, number[]>();
        let feeders = [];
        for (let k = 0; k < nextSetCount; k++) {
            let ids = [...new Set<string>(nextSets[k].slots
                .filter(slot => slot?.prereqType === 'set' && indexOf.has(String(slot.prereqId)))
                .map(slot => String(slot.prereqId)))]
                .sort((a, b) => indexOf.get(a) - indexOf.get(b));
            if (ids.length > (full == nextSetCount ? 1 : 2) || ids.some(id => spans.has(id))) return null;
            feeders.push(ids.length);
            if (full == nextSetCount && ids.length) spans.set(ids[0], [k, k + 1]);
            else if (ids.length == 1) spans.set(ids[0], [k * 2, k * 2 + 2]);
            else ids.forEach((id, j) => spans.set(id, [k * 2 + j, k * 2 + j + 1]));
        }
        // Every set must feed the next round, or the old guess is used
        if (spans.size != setCount) return null;
        return { full, spans, feeders };
    }

    getSetMargin(phaseGroup, round, side, set) {
        let sets = this.getRoundSets(phaseGroup, side, round);
        let setCount = sets.length;
        let rightRoundSets = this.getRoundSets(phaseGroup, side, (round + Math.sign(round)));
        let rightRoundSetCount = rightRoundSets ? rightRoundSets.length : 0;
        let firstSetId = this.getSetId(sets[0]);
        let setId = this.getSetId(set);


        // If the round set count is a standard amount
        if (setCount == rightRoundSetCount || setCount / 2 == rightRoundSetCount || rightRoundSetCount == 0) {
            let marginHeight = this.getStandardMarginHeight(phaseGroup, side, setCount);
            return `${marginHeight}px 0`;
        }

        // A round with byes whose links to the next round are known: each set on its places of the grid,
        // with the empty places before the first set and after each set added to its margins
        let layout = phaseGroup.byeLayouts?.[side]?.[Math.abs(round) - 1];
        let span = layout?.spans.get(String(set.id));
        if (span) {
            let placeHeight = this.getPhaseGroupSideHeight(phaseGroup, side) / layout.full;
            let setIndex = sets.findIndex(s => s.id == set.id);
            let nextStart = setIndex == setCount - 1 ? layout.full : layout.spans.get(String(sets[setIndex + 1].id))[0];
            let ownMargin = ((span[1] - span[0]) * placeHeight - this.setHeight) / 2;
            let marginTop = ownMargin + (setIndex == 0 ? span[0] * placeHeight : 0);
            let marginBottom = ownMargin + (nextStart - span[1]) * placeHeight;
            return `${marginTop}px 0 ${marginBottom}px`;
        }

        // If it's losers side
        if (side == 1) {
            // Get the distance between two powers of 2 for the number of players
            let powerOfPlayersRemainder = this.getPowerOfPlayersRemainder(phaseGroup.numPlayers);

            // If winners round 1 set count is less than 1/4 of the way between powers of 2
            if (powerOfPlayersRemainder < 0.321928094) {
                let setCountFull = rightRoundSetCount;
                let addedSetIndexes = this.getAddedSetIndexes(setCountFull, setCount, true);

                let setIndex = (setId - firstSetId) / 2;
                let nextSetIndex = this.getNextSetIndex(addedSetIndexes, setIndex, setCountFull);

                let marginTop = this.getStandardMarginHeight(phaseGroup, side, setCountFull);
                let marginBottom = marginTop + (this.setHeight + marginTop * 2) * (nextSetIndex - setIndex - 1);
                return `${marginTop}px 0 ${marginBottom}px`;
            }
            // If winners round 1 set count is between 1/4 and 1/2 of the way between powers of 2
            else if (powerOfPlayersRemainder < 0.584962500) {
                let setCountFull = rightRoundSetCount * 2;
                let addedSetIndexes = this.getAddedSetIndexes(setCountFull, setCount, true);

                let setIndex = setId - firstSetId;
                let nextSetIndex = this.getNextSetIndex(addedSetIndexes, setIndex, setCountFull);

                if (setIndex + 1 == nextSetIndex) {
                    let marginHeight = this.getStandardMarginHeight(phaseGroup, side, setCountFull);
                    return `${marginHeight}px 0`;
                }
                if (setIndex + 2 == nextSetIndex) {
                    let marginHeight = this.getStandardMarginHeight(phaseGroup, side, setCountFull) * 2 + this.setHeight / 2;
                    return `${marginHeight}px 0`;
                }
            }
            // If winners round 1 set count is greater than 1/2 of the way between powers of 2
            else {
                let setCountFull = rightRoundSetCount;
                let addedSetIndexes = this.getAddedSetIndexes(setCountFull, setCount, false);

                let setIndexRelative = sets.findIndex(s => s.id == set.id)
                let setIndex = -1;
                let count = 0;
                for (let i = 0; i < addedSetIndexes.length; i++) {
                    if (addedSetIndexes[i]) {
                        if (count == setIndexRelative) {
                            setIndex = i;
                            break;
                        }
                        count++;
                    }
                }
                let nextSetIndex = this.getNextSetIndex(addedSetIndexes, setIndex, setCountFull);

                let marginHeight = this.getStandardMarginHeight(phaseGroup, side, setCountFull);
                let marginTop = setIndexRelative == 0 ? marginHeight + (this.setHeight + marginHeight * 2) * setIndex : marginHeight;
                let marginBottom = marginHeight + (this.setHeight + marginHeight * 2) * (nextSetIndex - setIndex - 1);

                return `${marginTop}px 0 ${marginBottom}px`;
            }

            return '0';
        }

        // If it's winners side and the round set count is less than the next round set count
        if (setCount < rightRoundSetCount) {
            let setCountFull = rightRoundSetCount;
            let addedSetIndexes = this.getAddedSetIndexes(setCountFull, setCount, true);

            let setIndex = (setId - firstSetId) / 2;
            let nextSetIndex = this.getNextSetIndex(addedSetIndexes, setIndex, setCountFull);

            let marginTop = this.getStandardMarginHeight(phaseGroup, side, setCountFull);
            let marginBottom = marginTop + (this.setHeight + marginTop * 2) * (nextSetIndex - setIndex - 1);
            return `${marginTop}px 0 ${marginBottom}px`;
        }

        // If it's winners side and the round set count is greater than the next round set count
        if (setCount > rightRoundSetCount) {
            let setCountFull = rightRoundSetCount * 2;
            let addedSetIndexes = this.getAddedSetIndexes(setCountFull, setCount, true);

            let setIndex = setId - firstSetId;
            let nextSetIndex = this.getNextSetIndex(addedSetIndexes, setIndex, setCountFull);

            if (setIndex + 1 == nextSetIndex) {
                let marginHeight = this.getStandardMarginHeight(phaseGroup, side, setCountFull);
                return `${marginHeight}px 0`;
            }
            if (setIndex + 2 == nextSetIndex) {
                let marginHeight = this.getStandardMarginHeight(phaseGroup, side, setCountFull) * 2 + this.setHeight / 2;
                return `${marginHeight}px 0`;
            }
        }

        return '0';
    }

    getBlockClass(columnIndex, blockIndex, phaseGroup, bracketSide) {
        let blockColumnIndex = columnIndex % 3;
        let leftRoundSetCount = this.getRoundSets(phaseGroup, bracketSide, (columnIndex / 3 + 1) * this.maxRoundModifier[bracketSide]).length;
        let rightRoundSets = this.getRoundSets(phaseGroup, bracketSide, (columnIndex / 3 + 2) * this.maxRoundModifier[bracketSide]);
        let rightRoundSetCount = rightRoundSets.length;

        // The 3rd place match is drawn after the final but isn't fed by it, so no line joins them
        if (rightRoundSets[0] && this.isThirdPlaceMatch(rightRoundSets[0])) return '';

        // A round with byes laid out from its links (getByeLayout): two sets feeding one set get a fork,
        // a set feeding one alone a straight line, each at the height of the set it feeds
        let layout = phaseGroup.byeLayouts?.[bracketSide]?.[Math.trunc(columnIndex / 3)];
        if (layout) {
            let feeders = layout.feeders[Math.trunc(blockIndex / 4)];
            if (feeders == 2) {
                if (blockColumnIndex == 1 && blockIndex % 4 == 1) return 'first-block-column-first-row';
                if (blockColumnIndex == 1 && blockIndex % 4 == 2) return 'first-block-column-second-row';
                if (blockColumnIndex == 2 && blockIndex % 4 == 1) return 'straight-block';
            }
            if (feeders == 1 && blockIndex % 4 == 1) return 'straight-block';
            return '';
        }

        if (leftRoundSetCount / 2 == rightRoundSetCount) {
            if (blockColumnIndex == 1) {
                if (blockIndex % 4 == 1) return 'first-block-column-first-row';
                else if (blockIndex % 4 == 2) return 'first-block-column-second-row';
            }
            else if (blockColumnIndex == 2) {
                if (blockIndex % 4 == 1) return 'straight-block';
            }
        }

        else if (leftRoundSetCount == rightRoundSetCount) {
            if (blockIndex % 4 == 1) return 'straight-block';
        }

        // If it's losers side and winners round 1 set count is greater than 1/2 of the way between powers of 2
        else if (bracketSide == 1 && Math.log(phaseGroup.numPlayers) / Math.log(2) % 1 > 0.584962500) {
            let setIndex = Math.trunc(blockIndex / 4);
            for (let i = 0; i < leftRoundSetCount; i++) {
                if (SetOrderConstants[`sets${rightRoundSetCount}`][rightRoundSetCount - 1 - i] == setIndex && blockIndex % 4 == 1) return 'straight-block';
            }
        }

        else if (leftRoundSetCount < rightRoundSetCount) {
            let setIndex = Math.trunc(blockIndex / 4);
            for (let i = 0; i < leftRoundSetCount; i++) {
                if (SetOrderConstants[`sets${rightRoundSetCount}`][i] == setIndex && blockIndex % 4 == 1) return 'straight-block';
            }
        }

        else if (leftRoundSetCount > rightRoundSetCount) {
            let leftRoundSetCountFull = rightRoundSetCount * 2;
            let addedSetIndexes = this.getAddedSetIndexes(leftRoundSetCountFull, leftRoundSetCount, true);

            let leftSetIndex = Math.trunc(blockIndex / 2);
            let leftNextSetIndex = this.getNextSetIndex(addedSetIndexes, leftSetIndex, leftRoundSetCountFull);

            if (leftSetIndex + 1 == leftNextSetIndex && addedSetIndexes[leftSetIndex]) {
                if (blockColumnIndex == 1) {
                    if (blockIndex % 4 == 1) return 'first-block-column-first-row';
                    else if (blockIndex % 4 == 2) return 'first-block-column-second-row';
                }
                else if (blockColumnIndex == 2) {
                    if (blockIndex % 4 == 1) return 'straight-block';
                }
            }
            if (leftSetIndex + 2 == leftNextSetIndex) {
                if (blockIndex % 4 == 1) return 'straight-block';
            }
        }

        return '';
    }

    // A single elimination 3rd place match: start.gg puts it in the round after the final, fed by the
    // semi-finals' losers. Winners side sets are otherwise only ever fed by winners.
    isThirdPlaceMatch(set) {
        return set.round > 0 && set.slots.every(slot => slot.prereqType === 'set' && slot.prereqPlacement == 2);
    }

    getNumberOfPlayers(phaseGroup) {
        let sets = phaseGroup.sets.nodes;
        if (!sets[0][1]) return sets[0][0].length * 2;
        return sets[0][1].length * 2 + sets[0][0].length;
    }

    getPowerOfPlayersRemainder(numPlayers) {
        return Math.log(numPlayers) / Math.log(2) % 1;
    }

    getAddedSetIndexes(length, setCount, isForwards) {
        let addedSetIndexes = Array(length).fill(false);

        if (isForwards) for (let i = 0; i < setCount; i++) addedSetIndexes[SetOrderConstants[`sets${length}`][i]] = true;
        else for (let i = 0; i < setCount; i++) addedSetIndexes[SetOrderConstants[`sets${length}`][length - 1 - i]] = true;

        return addedSetIndexes;
    }

    getNextSetIndex(addedSetIndexes, setIndex, setCountFull) {
        let nextSetIndex = addedSetIndexes.indexOf(true, setIndex + 1);
        return nextSetIndex == -1 ? setCountFull : nextSetIndex;
    }

    getStandardMarginHeight(phaseGroup, side, setCountFull) {
        return (this.getPhaseGroupSideHeight(phaseGroup, side) - setCountFull * this.setHeight) / (setCountFull * 2);
    }

    getSetId(set) {
        if (isNaN(set.id) && set.id.includes('preview_')) return set.id.slice(set.id.lastIndexOf('_') + 1);
        return set.id;
    }

    getPhaseGroupSideHeight(phaseGroup, side) {
        let multiplier = 110;

        // If it's winners side
        if (side == 0) {
            // If winners only has one round
            if (phaseGroup.sets.nodes[0].length == 1) return this.getRoundSets(phaseGroup, side, 1).length * multiplier;

            // If winners has more than one round
            return Math.max(this.getRoundSets(phaseGroup, side, 1).length, this.getRoundSets(phaseGroup, side, 2).length) * multiplier;
        }

        // If it's losers side
        else {
            // If losers only has one round
            if (phaseGroup.sets.nodes[1].length == 1) return this.getRoundSets(phaseGroup, side, -1).length * multiplier;

            // If losers has more than one round
            return Math.max(this.getRoundSets(phaseGroup, side, -1).length, this.getRoundSets(phaseGroup, side, -2).length) * multiplier;
        }
    }

    changePhase(direction) {
        let url = this.router.url;
        if (url.indexOf('/brackets') == -1) url += '/brackets';
        this.router.navigate([url.slice(0, url.indexOf('/brackets') + '/brackets'.length) + '/' + this.phases[this.currentPhaseIndex + direction].id]);
    }

    // Jumps straight to any phase, from the menu on the phase's name
    goToPhase(phase) {
        if (phase.id == this.phases[this.currentPhaseIndex]?.id) return;
        this.router.navigate(['/' + this.eventSlug + '/brackets/' + phase.id]);
    }

    isWinner(set, slot, typeOfDisplay) {
        if (!slot.entrant) return `loser-${typeOfDisplay}`;
        return slot.entrant.id == set.winnerId ? `winner-${typeOfDisplay}` : `loser-${typeOfDisplay}`;
    }

    getScore(slot, set) {
        if (!slot.standing) return '‎';
        if (!isNaN(slot.standing.stats.score.value)) {
            if (slot.standing.stats.score.value == -1) return 'DQ';
            return slot.standing.stats.score.value;
        }

        let otherSlot = set.slots.find(s => s.id != slot.id);
        return otherSlot.standing ? 0 : '‎';
    }

    getSlotHeight(firstSlot) {
        let normalSlotHeight = (this.setHeight - 0.67) / 2;
        return (firstSlot ? normalSlotHeight + 0.67 : normalSlotHeight) + 'px';
    }

    getSetNameWidth(set) {
        if (this.hasScore(set) && set.games && set.games[0].selections) return '108px';
        if (this.hasScore(set)) return '136px';
        return '156px';
    }

    getSetNamesWidthStyling(set) {
        return !this.hasScore(set) ? 'set-names-no-score' : '';
    }

    getSeedFontSize(slot) {
        if (!slot.entrant) return null;
        if (slot.entrant.initialSeedNum < 100) return '12px';
        if (slot.entrant.initialSeedNum < 1000) return '10px';
        return '8px';
    }

    getScoreFontSize(slot) {
        return slot.standing?.stats.score.value == -1 ? '12px' : '14px';
    }

    getScoreFontWeight(slot) {
        return 'normal';
        // return slot.standing?.stats.score.value == -1 ? 'bold' : 'normal';
    }

    getColumnWidth(column) {
        return column % 3 == 0 ? '204px' : '22px';
    }

    entrantSearched(event) {
        const element = this.slotElements.toArray().find(element => element.nativeElement.getAttribute('entrantId') == event.option.value.id);
        if (!element) return;
        this.playerHovered = event.option.value.id;

        const container = document.querySelector<HTMLElement>('mat-sidenav-content');
        container.addEventListener('scroll', () => {
            this.canHover = false;
        }, { once: true });
        const allowHover = () => this.canHover = true;
        container.addEventListener('scrollend', allowHover, { once: true });
        setTimeout(allowHover, 1500); // Safari before 26 has no scrollend

        // Scroll the bracket itself so the slot ends up in the middle of the screen
        const scroll = () => {
            const box = container.getBoundingClientRect();
            const slot = element.nativeElement.getBoundingClientRect();
            container.scrollTo({
                left: container.scrollLeft + slot.left - box.left - (box.width - slot.width) / 2,
                top: container.scrollTop + slot.top - box.top - (box.height - slot.height) / 2,
                behavior: 'smooth'
            });
        };

        // On a phone, close the keyboard. That resizes the page and can stop the scroll partway,
        // so scroll again once the size settles. The blur waits a tick because the autocomplete
        // focuses the search box again right after this event, and a focused box keeps the keyboard
        // open and makes iOS scroll back up to it.
        setTimeout(() => {
            (document.activeElement as HTMLElement)?.blur();
            scroll();
        });
        let timer;
        const again = () => { clearTimeout(timer); timer = setTimeout(scroll, 150); };
        window.addEventListener('resize', again);
        window.visualViewport?.addEventListener('resize', again);
        setTimeout(() => {
            window.removeEventListener('resize', again);
            window.visualViewport?.removeEventListener('resize', again);
        }, 1500);
    }

    entrantSearchDisplay(entrant) {
        return entrant ? entrant.name : '';
    }

    getEntrantImage(entrant) {
        let profile = this.getEntrantProfile(entrant);
        return profile ? profile.url : '';
    }

    getEntrantImageOrientation(entrant) {
        let profile = this.getEntrantProfile(entrant);
        return profile && profile.height > profile.width ? 'portrait' : '';
    }

    // The profile picture: the only image asked for (images(type: "profile"))
    getEntrantProfile(entrant) {
        if (!entrant) return null;
        return entrant.participants[0].user.images?.[0] ?? null;
    }

    onSlotEnter(slot) {
        if (this.canHover) this.playerHovered = slot.entrant?.id ?? -1;
    }

    onSlotLeave() {
        if (this.canHover) this.playerHovered = -1;
    }

    getSlotBackgroundColor(slot, set, needsRoundedCorners = false) {
        if (slot.entrant?.id == this.playerHovered) {
            if (!needsRoundedCorners || this.hasScore(set)) return 'slot-hover';
            return 'slot-hover-rounded-corners';
        }
        if (!this.showUpsets || !set.slots[0].standing || !set.slots[1].standing || set.slots[0].standing.stats.score.value == -1 || set.slots[1].standing.stats.score.value == -1 || !set.winnerId) return '';

        let winner = set.slots.find(s => s.entrant.id == set.winnerId);
        let loser = set.slots.find(s => s.entrant.id != set.winnerId);
        if (winner.entrant.id == slot.entrant.id || winner.entrant.initialSeedNum < loser.entrant.initialSeedNum) return '';

        const placements = [4097, 3073, 2049, 1537, 1025, 769, 513, 385, 257, 193, 129, 97, 65, 49, 33, 25, 17, 13, 9, 7, 5, 4, 3, 2, 1];
        const winnerPower = placements.findIndex(placement => placement <= winner.entrant.initialSeedNum);
        const loserPower = placements.findIndex(placement => placement <= loser.entrant.initialSeedNum);
        const upsetFactor = Math.min((loserPower - winnerPower), 10);
        return `upset-factor-${upsetFactor}`;
    }

    hasScore(set) {
        if (!set.slots[0].standing || !set.slots[1].standing) return false;
        return set.slots[0].standing.stats.score.value || set.slots[1].standing.stats.score.value;
    }

    hasChars(set) {
        return set.games?.[0]?.picks?.some(side => side.length);
    }

    // The bracket has room for one icon per side: the first player's pick in game 1
    getCharIcon(set, playerIndex) {
        return set.games[0].picks[playerIndex]?.[0] ?? null;
    }

    onShowUpsetsChange(event) {
        localStorage.setItem('showUpsets', event.checked);
    }

    onShowProjectedChange(event) {
        localStorage.setItem('showProjected', event.checked);
    }

    getScrollToTopOffset() {
        const sidenavContentElement = document.querySelector<HTMLElement>('mat-sidenav-content');
        this.scrollToTopOffset = !this.isDesktop || sidenavContentElement.scrollHeight == sidenavContentElement.clientHeight ? 20 : 35;
        this.scrollToTopBottomOffset = !this.isDesktop || sidenavContentElement.scrollWidth == sidenavContentElement.clientWidth ? 20 : 35;
    }

    ngOnDestroy() {
        this.listeners.abort();
        clearTimeout(this.highlightTimer);
        clearTimeout(this.hoverTimer);
        const content = document.querySelector<HTMLElement>('mat-sidenav-content');
        if (content) content.style.overflowAnchor = '';
    }

    scrollToTop() {
        const sidenavContentElement = document.querySelector<HTMLElement>('.mat-sidenav-content');
        sidenavContentElement.scroll({
            top: 0,
            left: 0,
            behavior: 'smooth'
        });
    }

    openSet(set) {
        const dialogRef = this.dialog.open(SetComponent, {
            data: { set },
            width: '800px',
            autoFocus: false
        });
    }
}