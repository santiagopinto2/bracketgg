import { Injectable } from '@angular/core';
import { AuthService } from './auth.service';
import { LoadingService } from './loading.service';
import { TournamentDataService } from './tournamentData.service';
import { BackgroundLane, BackgroundStopped, StartggService } from './startgg.service';
import { PREFETCH_LIMITS, PrefetchBudget, phasesAfter, planPrefetch, progressionSeeds } from './phase-prefetch-plan';

// Once the bracket view has drawn a phase, loads the event's other phases in the background (their
// pools' sets, players and where their players go next), through the same StartggService calls the
// bracket view makes, so switching to one of them asks start.gg nothing. StartggService keeps what was
// loaded (getLoadedPhases).
//
// Which phases, and the hard limits, are in phase-prefetch-plan.ts: a logged-in visitor gets the whole
// event, cheapest phases first; a visitor who isn't logged in only the phases that fit in a request or
// two. One phase loads at a time, its requests at most 2 at once (RequestGate) and only when the
// visitor's own requests aren't waiting. Nothing loads while the tab is hidden or another phase is
// loading. It stops for good when the visitor leaves the event, and at the first busy, rate-limited or
// failed answer, which is never retried. A Save-Data connection loads nothing in the background.
@Injectable({
    providedIn: 'root'
})
export class PhasePrefetch {
    private run: PrefetchRun | null = null;
    // Each event's request budget, kept for the page's life, so coming back to an event doesn't start a new one
    private budgets = new Map<string, PrefetchBudget>();
    // After start.gg or the site was busy, no background loading starts again before this time
    private quietUntil = 0;

    constructor(
        private startgg: StartggService,
        private auth: AuthService,
        private loading: LoadingService,
        private tournamentData: TournamentDataService
    ) { }

    // The bracket view finished drawing phase `phaseId` of the event it shows
    shownPhaseLoaded(phaseId) {
        const event = this.tournamentData.tournamentSource()?.event?.event;
        if (event?.id == null || !Array.isArray(event.phases)) return;
        // Another phase of an event already loading, or done, in the background: nothing new to start
        if (this.run && this.run.eventId === event.id && !this.run.left) return;
        this.run?.stop('left the event');
        this.run = null;
        if (Date.now() < this.quietUntil || saveData()) return;
        const loggedIn = this.auth.isAuthenticated();
        const key = `${event.id}:${loggedIn}`;
        const budget = this.budgets.get(key) ?? new PrefetchBudget(loggedIn ? PREFETCH_LIMITS.loggedIn : PREFETCH_LIMITS.visitor);
        this.budgets.delete(key);
        this.budgets.set(key, budget);
        if (this.budgets.size > MAX_BUDGETS) this.budgets.delete(this.budgets.keys().next().value as string);
        this.run = new PrefetchRun(event.id, budget, this.loading, this.tournamentData, reason => {
            if (/busy|rate/.test(reason)) this.quietUntil = Date.now() + QUIET_AFTER_BUSY_MS;
        });
        this.run.start(this.startgg.background(this.run), event.phases, phaseId, loggedIn, event.type === 1);
    }
}

const QUIET_AFTER_BUSY_MS = 5 * 60_000;
// The most events whose budgets are kept
const MAX_BUDGETS = 50;
// While waiting its turn, a background request looks again this often, and at most this many times
const RECHECK_MS = 1000;
const MAX_RECHECKS = 3600;
// The most pools of one phase built from their seeds (a pool start.gg made no sets for)
const MAX_GENERATED_POOLS = 8;

function saveData(): boolean {
    return !!(navigator as any)?.connection?.saveData;
}

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// The background loading of one event
class PrefetchRun implements BackgroundLane {
    stopped: string | null = null;
    // The visitor went to another page or event
    left = false;
    constructor(
        readonly eventId: any,
        private budget: PrefetchBudget,
        private loading: LoadingService,
        private tournamentData: TournamentDataService,
        private onStop: (reason: string) => void
    ) { }

    async start(startgg: StartggService, phases: any[], shownPhaseId, loggedIn: boolean, singles: boolean) {
        // Bounded by the plan, at most PREFETCH_LIMITS' maxPhases
        for (const phase of planPrefetch(phases, shownPhaseId, loggedIn, singles)) {
            if (this.stopped) return;
            try {
                await this.loadPhase(startgg, phase, phases, singles);
            } catch (error) {
                if (!(error instanceof BackgroundStopped)) console.warn('Background loading stopped', error);
                this.stop(error instanceof BackgroundStopped ? error.message : 'error');
            }
        }
    }

    // What the bracket view asks for when it opens `phase` (event.component.ts getPhase), in the same calls
    private async loadPhase(startgg: StartggService, phase: any, phases: any[], singles: boolean) {
        const loaded = await startgg.getPhase(phase.id);
        // Only elimination brackets are drawn, so nothing more is asked of the others
        if (loaded.bracketType && !['SINGLE_ELIMINATION', 'DOUBLE_ELIMINATION'].includes(loaded.bracketType)) return;
        const groups: any[] = loaded.phaseGroups?.nodes ?? [];
        const others = [
            startgg.getPhaseEntrants(phase.id, phase.numSeeds, singles),
            ...phasesAfter(phase, phases).map(next => startgg.getPhaseProgressions(next.id, progressionSeeds(next))),
        ].map(load => load.then(() => null, error => error));
        const empty: any[] = [];
        let failed = null;
        try {
            if (groups.length > 1) {
                const expected = new Map<any, number>(groups.map((group): [any, number] => [group.id, group.sets?.pageInfo?.total ?? 0]));
                await startgg.getPhaseSetsByPool(phase.id, expected, (poolId, sets) => sets.length || empty.push(poolId));
            } else {
                for (const group of groups) {
                    if (!(await startgg.getPhaseGroupSets(group.id, group.sets?.pageInfo?.total ?? 0)).nodes.length) empty.push(group.id);
                }
            }
            for (const poolId of empty.slice(0, MAX_GENERATED_POOLS)) await startgg.getGeneratedPoolSets(poolId, loaded.bracketType ?? 'DOUBLE_ELIMINATION');
        } catch (error) {
            failed = error;
        }
        const errors = (await Promise.all(others)).filter(error => error);
        failed ??= errors.find(error => error instanceof BackgroundStopped) ?? errors[0];
        if (failed) throw failed;
    }

    // Lets one background request go when its turn comes (BackgroundLane)
    async admit(): Promise<void> {
        for (let i = 0; i < MAX_RECHECKS; i++) {
            if (this.stopped) throw new BackgroundStopped(this.stopped);
            // Never while the tab is hidden or the visitor waits for a page to load (which can be another event)
            if (document.visibilityState === 'hidden' || this.loading.currentValue()) {
                await delay(RECHECK_MS);
                continue;
            }
            if (this.tournamentData.tournamentSource()?.event?.event?.id !== this.eventId) {
                this.left = true;
                this.stop('left the event');
                continue;
            }
            const wait = this.budget.take(Date.now());
            if (wait === Infinity) {
                this.stop('budget spent');
                continue;
            }
            if (wait > 0) {
                await delay(Math.min(wait, RECHECK_MS * 5));
                continue;
            }
            return;
        }
        this.stop('waited too long');
        throw new BackgroundStopped(this.stopped);
    }

    stop(reason: string) {
        if (this.stopped) return;
        this.stopped = reason;
        this.onStop(reason);
    }
}
