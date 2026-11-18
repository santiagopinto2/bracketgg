// Tests src/app/components/event/projection.ts: Show Projected within a pool and across phases. Real
// finished pools (e2e/fixtures/cross-phase.json) must send each player where start.gg placed them in the
// next phase, and a hand-made pool with byes checks the placements one by one.
// Usage: node e2e/projection.mjs   Prints a JSON report and exits 1 if a check fails. Needs Node 22.18+.
import { readFileSync } from 'node:fs';
const { projectPool, rankExits, assignExits, setPlacement, projectAcrossPhases, emptySeedSlots, isMissing, PROJECTION_MAX_REQUESTS } = await import('../src/app/components/event/projection.ts');

const report = { checks: [] };
const check = (name, ok, detail) => report.checks.push({ name, ok: !!ok, detail });
const fixture = JSON.parse(readFileSync(new URL('./fixtures/cross-phase.json', import.meta.url)));

// The pool's fill, for a later phase: its own seeds (with their numbers in the pool) and seedMap
const fillOf = c => c.seeds ? { bySeedId: new Map(), seedsById: new Map(c.seeds.map(seed => [String(seed.id), seed])), seedMap: c.seedMap } : null;

// Who a pool sends into each next-phase seed: the projection's player at the exit the seed's placement and order point to
function sent(sets, sources, fill) {
    const tiers = rankExits(sets, fill);
    if (!tiers) return null;
    const projected = new Map(projectPool(sets, fill).map(set => [String(set.id), set]));
    const out = new Map();
    assignExits(tiers, sources).forEach((exit, seedId) => out.set(seedId, setPlacement(projected.get(String(exit.set.id)), exit.placement).entrant?.id ?? null));
    return out;
}

// 1. Real finished pools: every seed of the next phases gets the player start.gg put there
for (const c of fixture.cases) {
    const got = sent(c.sets, c.sources, fillOf(c));
    const wrong = got ? c.sources.filter(seed => got.has(String(seed.id)) && got.get(String(seed.id)) !== seed.entrant.id)
        .map(seed => ({ seed: seed.id, placement: seed.progressionSource.originPlacement, order: seed.progressionSource.originOrder, startgg: seed.entrant.id, projected: got.get(String(seed.id)) ?? null })) : 'not ranked';
    const unassigned = got ? c.sources.filter(seed => !got.has(String(seed.id))).length : null;
    check(`${c.name}: each of the ${c.sources.length - (c.unassigned ?? 0)} seeds it fills that can be placed gets the player start.gg placed there${c.unassigned ? `, and the ${c.unassigned} knocked out together are left empty` : ''}`,
        got && !wrong.length && unassigned === (c.unassigned ?? 0), { pool: c.pool, wrong, unassigned });
}

// 2. Placements of a hand-made 6-player double elimination pool with byes (seeds 1 and 2 skip winners
//    round 1), as start.gg makes it: the bye sets (10, 12) and losers round 1's bye sets (20, 21) are left
//    out and only named by the sets they feed. Seed 5 beat seed 4; nothing else is played.
{
    const e = n => ({ id: 100 + n, initialSeedNum: n });
    const seedSlot = n => ({ prereqType: 'seed', prereqId: String(900 + n), entrant: e(n) });
    const from = (id, placement, entrant = null) => ({ prereqType: 'set', prereqId: String(id), prereqPlacement: placement, entrant });
    const sets = [
        { id: 31, round: -3, slots: [from(16, 2), from(30, 1)] },               // losers final
        { id: 30, round: -2, slots: [from(28, 1), from(29, 1)] },               // losers round 3
        { id: 28, round: -1, slots: [from(15, 2), from(20, 1, e(4))] },         // losers round 2: the winners semi-finals' losers
        { id: 29, round: -1, slots: [from(14, 2), from(21, 1)] },
        { id: 11, round: 1, winnerId: 105, slots: [seedSlot(4), seedSlot(5)] }, // winners round 1
        { id: 13, round: 1, slots: [seedSlot(3), seedSlot(6)] },
        { id: 14, round: 2, slots: [from(10, 1, e(1)), from(11, 1, e(5))] },    // winners semi-finals, seeds 1 and 2 from bye sets
        { id: 15, round: 2, slots: [from(12, 1, e(2)), from(13, 1)] },
        { id: 16, round: 3, slots: [from(14, 1), from(15, 1)] },                // winners final
        { id: 17, round: 4, fullRoundText: 'Grand Final', slots: [from(16, 1), from(31, 1)] },
    ];
    const tiers = rankExits(sets);
    const shape = tiers?.map(tier => ({ place: tier.place, still: tier.still, exits: tier.exits.map(exit => `${exit.set.id}:${exit.placement}`), seeds: tier.exits.map(exit => exit.seed) }));
    check('a pool with byes: its places are 1st, 2nd, 3rd, 4th and two 5ths, by where each player leaves, ordered by the seed each exit is meant for',
        JSON.stringify(shape) === JSON.stringify([
            { place: 1, still: false, exits: ['17:1'], seeds: [1] }, { place: 2, still: false, exits: ['17:2'], seeds: [2] },
            { place: 3, still: false, exits: ['31:2'], seeds: [3] }, { place: 4, still: false, exits: ['30:2'], seeds: [4] },
            { place: 5, still: false, exits: ['28:2', '29:2'], seeds: [5, 6] }]), shape);

    // The next phase takes 1st to 4th and both 5ths
    const seed = (id, placement, order) => ({ id, entrant: null, progressionSource: { originPlacement: placement, originOrder: order, originPhaseGroup: { id: 1 } } });
    const sources = [seed(1, 1, 1), seed(2, 2, 1), seed(3, 3, 1), seed(4, 4, 1), seed(5, 5, 1), seed(6, 5, 2)];
    const players = sources => Object.fromEntries([...sent(sets, sources)].map(([id, entrant]) => [id, entrant - 100]));
    // Projected: 1 beats 5 and 2 beats 3 in the semi-finals, 1 wins the final; 4 (from losers round 1's bye set) loses to 3, 6 to 5; 3 beats 5, 2 beats 3
    const before = players(sources);
    check('a pool with byes: each placement goes to its seed, 1st to 4th the seeds 1, 2, 3 and 5; the two 5ths, knocked out together, are left empty',
        JSON.stringify(before) === JSON.stringify({ 1: 1, 2: 2, 3: 3, 4: 5 }), before);

    // A played set changes who is projected: seed 6 beats seed 3. Now 6 meets 2 in the semi-final and drops
    // to losers round 2, where 4 beats them; 3 comes in from losers round 1's bye set and beats 5, then 4
    const upset = structuredClone(sets);
    Object.assign(upset.find(set => set.id === 13), { winnerId: 106 });
    const after = Object.fromEntries([...sent(upset, sources)].map(([id, entrant]) => [id, entrant - 100]));
    check('a played set wins over the projection: after seed 6 beats seed 3, 4th place is seed 4 instead of seed 5',
        JSON.stringify(after) === JSON.stringify({ 1: 1, 2: 2, 3: 3, 4: 4 }), after);
}

// 3. Across phases, on Genesis X: Top 8's seeds filled from Top 64's finished pool, as if start.gg hadn't
//    placed anyone yet, are the players it did place; and the Top 8 drawn from them before it started
//    has every first set as start.gg's, the losers side's players brought in through the sets it doesn't send.
{
    const t = fixture.top8;
    const top64Sets = fixture.cases.find(c => c.pool === t.top64Pool).sets;
    const unplaced = t.top8Seeds.map(seed => ({ ...seed, entrant: null }));
    const loads = { phase: [], poolSets: [], seeds: [] };
    const data = {
        phases: t.phases,
        phase: id => (loads.phase.push(id), id === '1560208' ? t.top64 : id === '1560209' ? t.top8 : null),
        poolSets: id => (loads.poolSets.push(id), id === String(t.top64Pool) ? top64Sets : null),
        seeds: id => (loads.seeds.push(id), id === '1560208' ? t.top64Seeds : id === '1560209' ? unplaced : null),
    };
    const result = projectAcrossPhases('1560209', [2341868], data);
    const fill = result.fills.get('2341868');
    const wrong = t.top8Seeds.filter(seed => fill?.bySeedId.get(String(seed.id))?.entrant?.id !== seed.entrant.id).map(seed => seed.id);
    check('Genesis X Top 8 from Top 64: all 8 seeds filled with the players start.gg placed, nothing missing, and only Top 64 asked about',
        fill && fill.bySeedId.size === 8 && !wrong.length && !isMissing(result.missing) && result.unplaced === 8 && result.filled === 8
        && [...new Set(loads.poolSets)].join() === String(t.top64Pool) && [...fill.bySeedId.values()].every(slot => slot.isProjected),
        { wrong, filled: result.filled, unplaced: result.unplaced, missing: result.missing, loads: { poolSets: [...new Set(loads.poolSets)], seeds: [...new Set(loads.seeds)] } });

    // Top 8 before it started: no players, no results
    const blank = t.top8Sets.map(set => ({ ...set, winnerId: null, slots: set.slots.map(slot => ({ ...slot, entrant: null })) }));
    const firstSets = t.top8Sets.filter(set => set.slots.some(slot => slot.prereqType === 'seed' || (set.round < 0 && !t.top8Sets.some(other => String(other.id) === slot.prereqId))));
    const projected = new Map(projectPool(blank, fill).map(set => [set.id, set]));
    const differs = firstSets.filter(set => set.slots.some((slot, i) => {
        const real = t.top8Sets.find(s => s.id === set.id).slots[i];
        const isFirst = slot.prereqType === 'seed' || !t.top8Sets.some(other => String(other.id) === slot.prereqId);
        return isFirst && projected.get(set.id).slots[i].entrant?.id !== real.entrant.id;
    })).map(set => set.id);
    check('Genesis X Top 8 before it started: its winners semi-finals and losers round 1 drawn with the players start.gg placed, the losers side through the sets it doesn\'t send (the seedMap)',
        firstSets.length === 4 && !differs.length && emptySeedSlots(blank) === 8 && emptySeedSlots(t.top8Sets) === 0, { firstSets: firstSets.map(set => set.id), differs });

    // Not loaded: Top 64's sets and Top 8's seeds are what's missing; nothing is filled, and nothing more is looked at
    const none = projectAcrossPhases('1560209', [2341868], { ...data, poolSets: () => null });
    check('Genesis X Top 8 with Top 64\'s sets not loaded: Top 64\'s pool is listed as missing, and no seed is filled',
        none.filled === 0 && [...(none.missing.pools.get('1560208') ?? [])].join() === String(t.top64Pool) && !none.missing.phases.size,
        { filled: none.filled, missing: { pools: [...none.missing.pools].map(([k, v]) => [k, [...v]]), phases: [...none.missing.phases], seeds: [...none.missing.seeds] } });
    const noSeeds = projectAcrossPhases('1560209', [2341868], { ...data, seeds: () => null });
    check('Genesis X Top 8 with its seeds not loaded: the seeds are missing and unplaced is unknown',
        noSeeds.unplaced === null && noSeeds.missing.seeds.has('1560209') && noSeeds.filled === 0, { unplaced: noSeeds.unplaced, seeds: [...noSeeds.missing.seeds] });
}

check('"Project from pools" may send at most 60 requests a click', PROJECTION_MAX_REQUESTS === 60, PROJECTION_MAX_REQUESTS);

report.passed = report.checks.every(c => c.ok);
console.log(JSON.stringify(report, null, 2));
process.exit(report.passed ? 0 : 1);
