// What a phase's own sets say about each of its players, for the player search and the tracker under
// the bracket: the sets a player is in, in the order they play them, and whether they are still in.
// Nothing here asks start.gg for anything.

// One set of a player's
export interface TrackStep {
    set: any;
    poolId: any;
    // The round's name, as the bracket's column heading has it
    round: string;
    // W or L once the set is over
    result: 'W' | 'L' | null;
    // "Won 3-0 vs Sable", "Up next vs Sable"
    text: string;
}

export interface TrackStatus {
    // Still playing in this phase, or through to a later one
    in: boolean;
    // Finished the phase without being knocked out of it
    won: boolean;
    // For a search row: "Winners Final", "Out, 17th"
    text: string;
    // For the tracker: "Next: Winners Final", "Out, 17th"
    line: string;
}

export interface PlayerTrack {
    id: any;
    entrant: any;
    seed: number | null;
    steps: TrackStep[];
    status: TrackStatus;
}

export interface TrackOptions {
    // The sets' own placements (lPlacement and wPlacement) are the event's. In a phase with several
    // pools they are a pool's (17th of a 32-player pool), so they are left out.
    placements: boolean;
    // A later phase takes players from this one, so winning a last set here is not winning the event
    feedsLaterPhase: boolean;
    // The players start.gg has already placed in a later phase, by entrant id, with that phase's name
    advanced: Map<string, string>;
}

export function ordinal(n: number): string {
    const tens = n % 100;
    if (tens >= 11 && tens <= 13) return `${n}th`;
    return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
}

const isGrandFinal = set => set.round > 0 && /^grand final/i.test(set.fullRoundText ?? '');

// A player's sets in the order they play them: the winners rounds, then the losers rounds, then the
// grand final and its reset (both on the winners side, after every losers round)
const orderOf = (set): [number, number] => isGrandFinal(set) ? [2, set.round] : set.round > 0 ? [0, set.round] : [1, -set.round];

const scoreOf = (slot): number | null => {
    const value = slot?.standing?.stats?.score?.value;
    return value == null || value === '' || isNaN(Number(value)) ? null : Number(value);
};

function stepOf(playerId: string, entry: { set: any, poolId: any, slot: any, other: any }): TrackStep {
    const { set, poolId, slot, other } = entry;
    const round = set.fullRoundText || 'Set';
    const opponent: string = other?.entrant?.name ?? '';
    const mine = scoreOf(slot), theirs = scoreOf(other);
    const dq = mine === -1 || theirs === -1;
    const score = !dq && mine != null && theirs != null && (mine > 0 || theirs > 0) ? `${mine}-${theirs}` : '';

    if (set.winnerId) {
        const won = String(set.winnerId) === playerId;
        const text = [won ? 'Won' : 'Lost', dq ? 'by DQ' : score, opponent ? `vs ${opponent}` : ''].filter(Boolean).join(' ');
        return { set, poolId, round, result: won ? 'W' : 'L', text };
    }
    if (set.state === 2) {
        return { set, poolId, round, result: null, text: opponent ? `Playing ${opponent}${score ? `, ${score}` : ''}` : 'Being played' };
    }
    return { set, poolId, round, result: null, text: opponent ? `Up next vs ${opponent}` : 'Waiting for an opponent' };
}

// `pools` are the bracket's drawn pools: each has its sets as `sets.nodes`, by side and round. A pool
// that hasn't loaded yet (null) is skipped.
export function trackPlayers(pools: any[], options: TrackOptions): Map<string, PlayerTrack> {
    const byPlayer = new Map<string, { set: any, pool: number, poolId: any, slot: any, other: any }[]>();
    // The sets with a slot still empty, by the set and placement (1 winner, 2 loser) that fills it
    const waiting = new Map<string, any>();
    pools.forEach((pool, poolIndex) => {
        if (!pool) return;
        for (const set of (pool.sets?.nodes ?? []).flat(2)) {
            (set?.slots ?? []).forEach((slot, i) => {
                if (!slot) return;
                if (slot.entrant?.id != null) {
                    const key = String(slot.entrant.id);
                    if (!byPlayer.has(key)) byPlayer.set(key, []);
                    byPlayer.get(key).push({ set, pool: poolIndex, poolId: pool.id, slot, other: set.slots[1 - i] ?? null });
                } else if (slot.prereqType === 'set') {
                    waiting.set(`${slot.prereqId}:${slot.prereqPlacement}`, set);
                }
            });
        }
    });

    const tracks = new Map<string, PlayerTrack>();
    byPlayer.forEach((entries, id) => {
        entries.sort((a, b) => {
            const [sideA, roundA] = orderOf(a.set), [sideB, roundB] = orderOf(b.set);
            return a.pool - b.pool || sideA - sideB || roundA - roundB;
        });
        const steps = entries.map(entry => stepOf(id, entry));
        const entrant = entries[entries.length - 1].slot.entrant;
        const seed = entrant.initialSeedNum == null ? null : Number(entrant.initialSeedNum);
        tracks.set(id, { id: entrant.id, entrant, seed, steps, status: statusOf(id, steps, waiting, options) });
    });
    return tracks;
}

function statusOf(playerId: string, steps: TrackStep[], waiting: Map<string, any>, options: TrackOptions): TrackStatus {
    const still = (round: string, now = false): TrackStatus => ({ in: true, won: false, text: round, line: `${now ? 'Now' : 'Next'}: ${round}` });

    // A set of theirs that isn't over: being played, or the next one
    const pending = steps.find(step => !step.set.winnerId);
    if (pending) return still(pending.round, pending.set.state === 2);

    const through = options.advanced.get(playerId);
    if (through) return { in: true, won: false, text: `Advanced to ${through}`, line: `Advanced to ${through}` };

    const last = steps[steps.length - 1];
    const won = last.result === 'W';
    // start.gg hasn't put them in their next set yet, but the bracket says which one it is
    const next = waiting.get(`${last.set.id}:${won ? 1 : 2}`);
    if (next) return still(next.fullRoundText || 'Next set');

    const placement = options.placements ? Number(won ? last.set.wPlacement : last.set.lPlacement) || null : null;
    if (won) {
        if (options.feedsLaterPhase) return { in: true, won: false, text: 'Advanced', line: 'Advanced' };
        if (placement && placement > 1) return { in: false, won: false, text: `Out, ${ordinal(placement)}`, line: `Out, ${ordinal(placement)}` };
        const text = placement === 1 ? '1st' : `Won ${last.round}`;
        return { in: false, won: true, text, line: text };
    }
    const text = `Out, ${placement ? ordinal(placement) : last.round}`;
    return { in: false, won: false, text, line: text };
}
