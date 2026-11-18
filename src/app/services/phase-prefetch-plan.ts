// What the bracket view loads in the background once the shown phase is drawn (phase-prefetch.ts):
// which of the event's other phases, in what order, and how many requests that may take. Worked out
// from the event's phase list alone, before anything is asked. No Angular here, so
// e2e/prefetch-plan.mjs runs it in Node.

export type PrefetchLimits = {
    // The most phases loaded in the background for one event
    maxPhases: number;
    // The most background requests for one event, all phases together
    maxRequests: number;
    // The most background requests in any 60 seconds
    perMinute: number;
    // A phase estimated to take more requests than this is left out
    maxPhaseRequests: number;
    // A phase whose sets are estimated to take more requests than this is left out
    maxSetRequests: number;
};

// Hard limits. A logged-in visitor's requests use their own start.gg token, which start.gg allows 80
// a minute. Everyone else shares the site's token, 70 a minute for all of them (server/site-gate.js),
// so they get only the phases whose sets fit in one or two requests, never big pool phases.
export const PREFETCH_LIMITS: { loggedIn: PrefetchLimits, visitor: PrefetchLimits } = {
    loggedIn: { maxPhases: 40, maxRequests: 120, perMinute: 40, maxPhaseRequests: 60, maxSetRequests: 50 },
    visitor: { maxPhases: 6, maxRequests: 15, perMinute: 15, maxPhaseRequests: 5, maxSetRequests: 2 },
};

// The most phases of an event looked at, however many it lists
export const MAX_EVENT_PHASES = 200;

// The sizes startgg.service.ts asks for (measured costs are in CLAUDE.md): a single pool's sets 95 a
// request; a multi-pool phase's in pool slices of about 980 objects, 9 per set and 1 per slice;
// players 300 a request (190 two-player teams); a later phase's seeds 240 a request.
const SETS_PER_POOL_REQUEST = 95;
const OBJECTS_PER_POOL_SET = 9;
const OBJECTS_PER_REQUEST = 980;
const PLAYERS_PER_REQUEST = 300;
const TEAMS_PER_REQUEST = 190;
const PROGRESSION_SEEDS_PER_REQUEST = 240;

const progressing = (phase: any): number =>
    (phase?.progressingInData ?? []).reduce((sum: number, source: any) => sum + (Number(source?.numProgressing) || 0), 0);

// The phases that take players from `phase`, whose seeds the bracket view asks for alongside its sets
export function phasesAfter(phase: any, phases: any[]): any[] {
    return phases.filter(next => next && next.id != phase?.id && next.progressingInData?.some((source: any) => source?.origin == phase?.id));
}

// How many seeds a later phase's progression request asks for, as the bracket view does
export function progressionSeeds(phase: any): number {
    return Math.max(Number(phase?.numSeeds) || 0, progressing(phase));
}

// About how many requests opening `phase` takes: the phase, its players, its sets, and the seeds of
// the phases after it. start.gg doesn't say a phase's bracket type before it is asked for, so every
// phase counts as double elimination, about two sets per player.
export function estimatePhase(phase: any, phases: any[], singles: boolean): { requests: number, setRequests: number } {
    const seeds = Math.max(0, Number(phase?.numSeeds) || 0);
    const pools = Math.max(1, Number(phase?.groupCount) || 1);
    const sets = 2 * seeds;
    const setRequests = pools > 1
        ? Math.max(1, Math.ceil((sets * OBJECTS_PER_POOL_SET + 2 * pools) / OBJECTS_PER_REQUEST))
        : Math.max(1, Math.ceil(sets / SETS_PER_POOL_REQUEST));
    const playerRequests = Math.max(1, Math.ceil(seeds / (singles ? PLAYERS_PER_REQUEST : TEAMS_PER_REQUEST)));
    const progressionRequests = phasesAfter(phase, phases)
        .reduce((n, next) => n + Math.max(1, Math.ceil(progressionSeeds(next) / PROGRESSION_SEEDS_PER_REQUEST)), 0);
    return { requests: 1 + playerRequests + setRequests + progressionRequests, setRequests };
}

// The phases to load in the background, in order: every phase but the shown one that fits the limits,
// the cheapest first and, among equals, the later phase first (Top 8 before Top 64 before pools),
// until the event's phase or request budget is used up.
export function planPrefetch(phases: any[], shownPhaseId: any, loggedIn: boolean, singles: boolean): any[] {
    const limits = loggedIn ? PREFETCH_LIMITS.loggedIn : PREFETCH_LIMITS.visitor;
    const listed = (Array.isArray(phases) ? phases : []).slice(0, MAX_EVENT_PHASES);
    const candidates = listed
        .map((phase, index) => ({ phase, index, ...estimatePhase(phase, listed, singles) }))
        .filter(c => c.phase?.id != null && c.phase.id != shownPhaseId
            && c.requests <= limits.maxPhaseRequests && c.setRequests <= limits.maxSetRequests)
        .sort((a, b) => a.requests - b.requests || b.index - a.index);
    const plan: any[] = [];
    let total = 0;
    for (const candidate of candidates) {
        if (plan.length >= limits.maxPhases || total + candidate.requests > limits.maxRequests) break;
        plan.push(candidate.phase);
        total += candidate.requests;
    }
    return plan;
}

// Counts one event's background requests: at most `maxRequests` in all and `perMinute` in any 60
// seconds. `take` says how long to wait before the next request may start: 0 to start it now (and it
// is counted), or Infinity once the event's budget is spent.
export class PrefetchBudget {
    used = 0;
    private starts: number[] = [];
    private maxRequests: number;
    private perMinute: number;

    constructor(limits: PrefetchLimits) {
        this.maxRequests = limits.maxRequests;
        this.perMinute = limits.perMinute;
    }

    take(now: number): number {
        if (this.used >= this.maxRequests) return Infinity;
        this.starts = this.starts.filter(t => t > now - 60_000);
        if (this.starts.length >= this.perMinute) return this.starts[0] + 60_000 - now;
        this.starts.push(now);
        this.used++;
        return 0;
    }
}
