// A pool start.gg has seeded but made no sets for (Port Priority DX's Melee Singles pool E43, 2026-11-14:
// its seeds and seedMap come back, its sets don't, and start.gg's own page draws the bracket from the
// seeds). This builds the sets the way start.gg's other pools come: preview ids, start.gg's round
// numbers and round names, and slots linked by prereqId, so the bracket draws and projects like any
// other pool that hasn't started.
//
// Checked against start.gg's own drawing of a 16-player pool (E43, every projected set the same).
// Built only for what start.gg's other pools show: a power of two players with no byes, double or single
// elimination, nobody coming from an earlier phase, and either no players going on (the full bracket with its grand final) or an even number
// going on, half from each side. Anything else returns null and the pool stays empty, as before.

export interface PoolSeeds {
    seedMap: any;
    progressionsOut: any[] | null;
    seeds: { nodes: { groupSeedNum: number, entrant: any, progressionSource?: any }[] };
}

const slot = (prereqType: string, prereqId: string, prereqPlacement: number | null, entrant: any = null) =>
    ({ prereqType, prereqId, prereqPlacement, entrant });

const set = (pool, round: number, k: number, fullRoundText: string, slots: any[]) => ({
    id: `preview_${pool}_${round}_${k}`, round, fullRoundText, winnerId: null, displayScore: null, state: 1, totalGames: null,
    startedAt: null, completedAt: null, vodUrl: null, games: null, slots, generated: true,
});

// start.gg names rounds from the end of the whole bracket, even when the pool stops before it
const roundName = (side: string, round: number, last: number) =>
    round === last ? `${side}Final` : round === last - 1 ? `${side}Semi-Final` : round === last - 2 ? `${side}Quarter-Final` : `${side}Round ${round}`;

export function generatePoolSets(pool, bracketType: string, data: PoolSeeds): any[] | null {
    const order = data?.seedMap && typeof data.seedMap === 'object' ? Object.values(data.seedMap) : [];
    if (order.length !== 1 || !Array.isArray(order[0])) return null;
    const seeds: any[] = order[0] as any[];
    const n = seeds.length;
    if (n < 4 || (n & (n - 1)) !== 0 || seeds.some(seed => typeof seed !== 'number')) return null;
    // A later phase's pool can bring players in on the losers side, which a fresh bracket doesn't have
    if (data.seeds?.nodes?.some(seed => seed.progressionSource)) return null;
    const bySeed = new Map(data.seeds?.nodes?.map(seed => [seed.groupSeedNum, seed.entrant ?? null]) ?? []);
    const going = data.progressionsOut?.length ?? 0;
    const m = Math.log2(n);
    const sets = [];

    if (bracketType === 'SINGLE_ELIMINATION') {
        if (going && (going & (going - 1)) !== 0) return null;
        for (let r = 1; r <= m && n / 2 ** r >= Math.max(going, 1); r++) {
            for (let k = 0; k < n / 2 ** r; k++) {
                const slots = r === 1
                    ? [0, 1].map(i => slot('seed', String(seeds[2 * k + i]), null, bySeed.get(seeds[2 * k + i]) ?? null))
                    : [0, 1].map(i => slot('set', `preview_${pool}_${r - 1}_${2 * k + i}`, 1));
                sets.push(set(pool, r, k, roundName('', r, m).trim(), slots));
            }
        }
        return sets;
    }
    if (bracketType !== 'DOUBLE_ELIMINATION') return null;
    // Players going on: half from each side, a power of two from each, at most a quarter of the pool
    const half = going / 2;
    if (going && (going % 2 || (half & (half - 1)) !== 0 || half > n / 4)) return null;
    const keep = (count: number) => count >= Math.max(half, 1);

    // Winners: rounds 1 to m
    for (let r = 1; r <= m && keep(n / 2 ** r); r++) {
        for (let k = 0; k < n / 2 ** r; k++) {
            const slots = r === 1
                ? [0, 1].map(i => slot('seed', String(seeds[2 * k + i]), null, bySeed.get(seeds[2 * k + i]) ?? null))
                : [0, 1].map(i => slot('set', `preview_${pool}_${r - 1}_${2 * k + i}`, 1));
            sets.push(set(pool, r, k, roundName('Winners ', r, m), slots));
        }
    }

    // Losers: 2m - 2 rounds, numbered as start.gg numbers them, -3, -4, ... (-2 is the hidden round of
    // winners round 1's losers, which these sets link past). Round 1 pairs winners round 1's losers. Each even round
    // brings in the losers of a winners round (in reverse order the first time, then in order, alternating,
    // as start.gg's pools do), and each odd round after it halves the field.
    const losersRounds = 2 * m - 2;
    let previous: string[] = [];
    for (let j = 1; j <= losersRounds; j++) {
        const ids = [];
        const name = roundName('Losers ', j, losersRounds);
        if (j === 1) {
            const count = n / 4;
            if (!keep(count)) break;
            for (let k = 0; k < count; k++) {
                const s = set(pool, -(j + 2), k, name, [0, 1].map(i => slot('set', `preview_${pool}_1_${2 * k + i}`, 2)));
                sets.push(s); ids.push(s.id);
            }
        } else if (j % 2 === 0) {
            const winnersRound = j / 2 + 1;
            const count = previous.length;
            if (!keep(count)) break;
            const reversed = (j / 2) % 2 === 1;
            for (let k = 0; k < count; k++) {
                const from = reversed ? count - 1 - k : k;
                const s = set(pool, -(j + 2), k, name, [slot('set', `preview_${pool}_${winnersRound}_${from}`, 2), slot('set', previous[k], 1)]);
                sets.push(s); ids.push(s.id);
            }
        } else {
            const count = previous.length / 2;
            if (!keep(count)) break;
            for (let k = 0; k < count; k++) {
                const s = set(pool, -(j + 2), k, name, [0, 1].map(i => slot('set', previous[2 * k + i], 1)));
                sets.push(s); ids.push(s.id);
            }
        }
        previous = ids;
    }

    // With nobody going on, the grand final: the winners final's winner against the losers final's
    if (!going) sets.push(set(pool, m + 1, 0, 'Grand Final', [slot('set', `preview_${pool}_${m}_0`, 1), slot('set', previous[0], 1)]));
    return sets;
}
