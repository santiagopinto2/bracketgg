// Show Projected: who reaches each empty slot if the better seed (the lower seed number) wins every set
// still to play. Played sets keep their real result. Within a pool this follows start.gg's links between
// sets; across phases it works out who each earlier pool sends on, in the order start.gg places them,
// and fills the later phase's seeds start.gg hasn't placed anyone in yet. No Angular here, so
// e2e/projection.mjs runs it in Node.

// What a pool of a later phase is filled with: the projected slot for each seed start.gg hasn't placed
// anyone in yet (by seed id), and what says which seed is behind a slot start.gg doesn't send: the
// pool's seeds (from the phase's progression seeds) and its seedMap (from the phase query).
export type PoolFill = {
    bySeedId: Map<string, any>;
    seedsById?: Map<string, any>;
    seedMap?: any;
};

// A slot start.gg links to but doesn't send: the loser of a winners set (`set`), or a seed (`seed`)
type Hidden = { set?: any, seed?: any };

const previewOf = (id: any) => {
    const match = /^preview_(\d+)_(-?\d+)_(\d+)$/.exec(String(id));
    return match ? { pool: match[1], round: Number(match[2]), k: Number(match[3]) } : null;
};
// Sorts ids in the order start.gg made them: preview ids by round and place, others by number
const idOrder = (a: string, b: string) => {
    const pa = previewOf(a), pb = previewOf(b);
    if (pa && pb) return Math.abs(pa.round) - Math.abs(pb.round) || pa.k - pb.k;
    return Number(a) - Number(b);
};
const loserOf = (set: any) => {
    if (set?.winnerId == null || !set.slots?.[0]?.entrant || !set.slots?.[1]?.entrant) return null;
    return set.slots.find(slot => slot.entrant.id != set.winnerId)?.entrant ?? null;
};

// Every slot that links to a set start.gg doesn't send, mapped to what it holds. Real pools leave out:
//   - Losers Round 1 sets, and losers bye sets, that hold the loser of a winners set. Before a pool
//     starts their ids say what they are (preview_<pool>_<round>_<k>, w = winners round 1's id round):
//     round -(w+1), k holds the loser of winners round 1's set k; round -(w+2), k is a losers round 1
//     bye, holding whoever reaches it from -(w+1) sets 2k and 2k+1 (Port Priority DX, 2026-11-14).
//     In a started pool the ids are numbers, which only say their order (worked out below).
//   - In a later phase, the sets that bring the players seeded into the losers side in: each holds the
//     worse seed of a pair of the pool's seedMap, in the seedMap's order (Genesis X Top 64 and Top 8,
//     a weekly's Top 16 before it started; 2026-11-18).
// Winners round 1 bye sets are left unresolved: the slot they feed already has its player.
export function hiddenSources(sets: any[], setsById: Map<string, any>, fill: PoolFill | null = null): Map<string, Hidden> {
    const hidden = new Map<string, Hidden>();
    const refs = sets.filter(set => set.round < 0).flatMap(set => set.slots
        .filter(slot => slot?.prereqType === 'set' && slot.prereqPlacement == 1 && !setsById.has(String(slot.prereqId)))
        .map(slot => ({ id: String(slot.prereqId), set, slot })));
    const missing = [...new Set<string>(refs.map(ref => ref.id))].sort(idOrder);
    if (!missing.length) return hidden;

    // A later phase's seeds that come in on the losers side
    const holders = seedHolders(sets, fill);
    if (holders.length && holders.length === missing.length) {
        missing.forEach((id, i) => hidden.set(id, { seed: holders[i] }));
        return hidden;
    }

    const winnersRounds = sets.map(set => set.round).filter(round => round > 0);
    if (!winnersRounds.length) return hidden;

    // Before the pool starts: from the preview ids
    if (missing.every(id => previewOf(id))) {
        const winnersIdRounds = sets.map(set => previewOf(set.id)).filter(parsed => parsed && parsed.round > 0).map(parsed => parsed.round);
        if (!winnersIdRounds.length) return hidden;
        const w = Math.min(...winnersIdRounds);
        for (const id of missing) {
            const { pool, round, k } = previewOf(id);
            let source = null;
            if (round === -(w + 1)) source = setsById.get(`preview_${pool}_${w}_${k}`) ?? null;
            if (round === -(w + 2)) {
                const reached = [2 * k, 2 * k + 1].map(j => setsById.get(`preview_${pool}_${w}_${j}`)).filter(Boolean);
                source = reached.length === 1 ? reached[0] : null;
            }
            if (source) hidden.set(id, { set: source });
        }
        return hidden;
    }

    // A started pool. A slot whose player is in already says which set they lost on the winners side.
    for (const { id, slot } of refs) {
        const playerId = slot.entrant?.id;
        if (playerId == null || hidden.has(id)) continue;
        const lost = sets.find(set => set.round > 0 && set.winnerId != null && set.winnerId != playerId && set.slots.some(s => s?.entrant?.id == playerId));
        if (lost) hidden.set(id, { set: lost });
    }
    // The rest from the bracket's shape, each way checked against the slots whose players are in
    for (const guess of [losersRoundOneByes(sets, setsById), dropByes(sets, setsById), inOrder(sets, setsById, missing)]) {
        const agrees = [...guess].every(([id, source]) => refs.filter(ref => ref.id === id && ref.slot.entrant).every(ref => {
            const loser = loserOf(source.set);
            return !loser || loser.id == ref.slot.entrant.id;
        }));
        if (agrees) guess.forEach((source, id) => hidden.has(id) || hidden.set(id, source));
    }
    return hidden;
}

// The worse seed of each pair in the pool's seedMap whose player no slot names directly: the players a
// later phase brings in on the losers side, in the order of the sets that hold them
function seedHolders(sets: any[], fill: PoolFill | null): any[] {
    const map = fill?.seedMap && typeof fill.seedMap === 'object' ? Object.values(fill.seedMap)[0] : null;
    if (!Array.isArray(map) || !fill?.seedsById?.size) return [];
    const byNum = new Map<number, any>([...fill.seedsById.values()].map(seed => [Number(seed.groupSeedNum), seed]));
    const direct = new Set(sets.flatMap(set => set.slots).filter(slot => slot?.prereqType === 'seed').map(slot => String(slot.prereqId)));
    const holders = [];
    for (let k = 0; k + 1 < map.length; k += 2) {
        if (typeof map[k] !== 'number' || typeof map[k + 1] !== 'number') continue;
        const seed = byNum.get(Math.max(map[k], map[k + 1]));
        if (seed && !direct.has(String(seed.id))) holders.push(seed);
    }
    return holders;
}

// Winners round 1's places in order, its bye sets (left out, named only by winners round 2's slots)
// among them: a power of two of them, or null
function winnersRoundOne(sets: any[], setsById: Map<string, any>) {
    const winners = sets.filter(set => set.round > 0);
    if (!winners.length) return null;
    const first = Math.min(...winners.map(set => set.round));
    const byes = winners.filter(set => set.round === first + 1).flatMap(set => set.slots)
        .filter(slot => slot?.prereqType === 'set' && slot.prereqPlacement == 1 && !setsById.has(String(slot.prereqId))).map(slot => String(slot.prereqId));
    const places = [...new Set([...winners.filter(set => set.round === first).map(set => String(set.id)), ...byes])].sort(idOrder);
    if (!places.length || (places.length & (places.length - 1)) !== 0) return null;
    return { first, places };
}

// Losers round 1 in a pool with byes: each of its sets takes the losers of two places of winners round 1.
// The ones with one player are bye sets, left out and named only by losers round 2's slots (which also
// take a loser from winners round 2); the ones with two are sent, and their slots name two more left-out
// sets that each hold one loser. Matched in order: the k-th losers round 1 set to winners round 1's
// places 2k and 2k+1 (a 30-player weekly, a 41-player one, and Genesis X's R1 pools; 2026-11-18).
function losersRoundOneByes(sets: any[], setsById: Map<string, any>): Map<string, Hidden> {
    const found = new Map<string, Hidden>();
    const roundOne = winnersRoundOne(sets, setsById);
    if (!roundOne) return found;
    const { first, places } = roundOne;
    const secondRound = new Set(sets.filter(set => set.round === first + 1).map(set => String(set.id)));
    const losersRoundOne = new Set<string>();
    for (const set of sets.filter(set => set.round < 0)) {
        const dropped = set.slots.filter(slot => slot?.prereqType === 'set' && slot.prereqPlacement == 2 && secondRound.has(String(slot.prereqId)));
        const reached = set.slots.filter(slot => slot?.prereqType === 'set' && slot.prereqPlacement == 1);
        if (dropped.length === 1 && reached.length === 1) losersRoundOne.add(String(reached[0].prereqId));
    }
    const ordered = [...losersRoundOne].sort(idOrder);
    const real = places.map((id, k) => setsById.has(id) ? k : -1).filter(k => k >= 0);
    const used = [...new Set(real.map(k => k >> 1))].sort((a, b) => a - b);
    if (!ordered.length || ordered.length !== used.length) return found;
    ordered.forEach((id, i) => {
        const pair = [2 * used[i], 2 * used[i] + 1].map(k => setsById.get(places[k])).filter(Boolean);
        const sent = setsById.get(id);
        if (!sent && pair.length === 1) found.set(id, { set: pair[0] });
        if (!sent || pair.length !== 2) return;
        const inner = sent.slots.filter(slot => slot?.prereqType === 'set' && slot.prereqPlacement == 1 && !setsById.has(String(slot.prereqId)))
            .map(slot => String(slot.prereqId)).sort(idOrder);
        if (inner.length === 2) inner.forEach((innerId, j) => found.set(innerId, { set: pair[j] }));
    });
    return found;
}

// A losers round that takes the losers of a winners round, some of its sets left out because they have
// only that loser (a 41-player weekly's Losers Round 2). The sets it sends show how start.gg ordered the
// losers coming in (reversed, in order, or swapped in pairs or halves), and the left-out ones, named by
// the next losers round's slots, take the rest the same way.
function dropByes(sets: any[], setsById: Map<string, any>): Map<string, Hidden> {
    const found = new Map<string, Hidden>();
    const losersRounds = [...new Set(sets.filter(set => set.round < 0).map(set => set.round))];
    for (const w of [...new Set(sets.filter(set => set.round > 0).map(set => set.round))]) {
        const winners = sets.filter(set => set.round === w).map(set => String(set.id)).sort(idOrder);
        const n = winners.length;
        const placeOf = new Map(winners.map((id, k): [string, number] => [id, k]));
        for (const r of losersRounds) {
            const fed = sets.filter(set => set.round === r && set.slots.some(slot => slot?.prereqType === 'set' && slot.prereqPlacement == 2 && placeOf.has(String(slot.prereqId))));
            if (!fed.length) continue;
            const left = [...new Set(sets.filter(set => set.round === r - 1).flatMap(set => set.slots)
                .filter(slot => slot?.prereqType === 'set' && slot.prereqPlacement == 1 && !setsById.has(String(slot.prereqId))).map(slot => String(slot.prereqId)))];
            const round = [...new Set([...sets.filter(set => set.round === r).map(set => String(set.id)), ...left])].sort(idOrder);
            if (!left.length || round.length !== n) continue;
            const known = new Map<number, number>();
            for (const set of fed) {
                const slot = set.slots.find(slot => slot?.prereqType === 'set' && slot.prereqPlacement == 2 && placeOf.has(String(slot.prereqId)));
                known.set(round.indexOf(String(set.id)), placeOf.get(String(slot.prereqId)));
            }
            const orders = [(i: number) => i, (i: number) => n - 1 - i, (i: number) => i ^ 1, (i: number) => (i + n / 2) % n, (i: number) => (n - 1 - i) ^ 1]
                .filter(order => [...known].every(([i, k]) => order(i) === k));
            for (const id of left) {
                const places = new Set(orders.map(order => order(round.indexOf(id))));
                const source = places.size === 1 ? setsById.get(winners[[...places][0]]) : null;
                if (source) found.set(id, { set: source });
            }
        }
    }
    return found;
}

// The oldest guess: all the left-out sets feed one losers round and there are exactly as many as winners
// round 1 has sets (no byes), matched in order
function inOrder(sets: any[], setsById: Map<string, any>, missing: string[]): Map<string, Hidden> {
    const found = new Map<string, Hidden>();
    const winnersRounds = sets.map(set => set.round).filter(round => round > 0);
    const first = sets.filter(set => set.round === Math.min(...winnersRounds));
    const feedRounds = new Set(sets.filter(set => set.round < 0 && set.slots.some(slot => missing.includes(String(slot?.prereqId)))).map(set => set.round));
    if (feedRounds.size !== 1 || missing.length !== first.length || [...missing, ...first.map(set => set.id)].some(id => Number.isNaN(Number(id)))) return found;
    const sorted = [...first].sort((a, b) => Number(a.id) - Number(b.id));
    missing.forEach((id, i) => found.set(id, { set: sorted[i] }));
    return found;
}

// The slot that finishes a set in `placement` (1 winner, 2 loser): the real result if the set is done,
// else the better seed wins. A copy, or an empty slot when a player is missing.
export function setPlacement(set: any, placement: number): any {
    const slots = set.slots;
    if (set.winnerId && slots[0].entrant && slots[1].entrant) {
        const winner = slots.find(slot => slot.entrant.id == set.winnerId);
        const loser = slots.find(slot => slot.entrant.id != set.winnerId);
        if (winner && loser) return structuredClone(placement == 1 ? winner : loser);
    }
    if (!slots[0].entrant || !slots[1].entrant) return { entrant: null, standing: null };
    if (placement == 1) return structuredClone(slots.reduce((prev, current) => prev.entrant.initialSeedNum < current.entrant.initialSeedNum ? prev : current));
    return structuredClone(slots.reduce((prev, current) => prev.entrant.initialSeedNum > current.entrant.initialSeedNum ? prev : current));
}

// A projected copy of a slot: drawn as projected, with no score
export function projectedSlot(slot: any): any {
    const copy = structuredClone(slot);
    copy.isProjected = true;
    if (copy.standing) copy.standing.stats.score.value = null;
    return copy;
}

// A pool's sets (as drawn, by side and round, or a flat list) with every empty slot filled with who would
// get there. A seed start.gg hasn't placed anyone in takes the player `fill` projects out of an earlier
// phase. Each slot says where its player comes from (prereqType "set", prereqId, prereqPlacement 1 for
// the winner or 2 for the loser), so this follows start.gg's own links and works for any bracket shape.
export function projectPool<T>(nodes: T, fill: PoolFill | null = null): T {
    const projected = structuredClone(nodes);
    const sets: any[] = (projected as any).flat(2);
    const setsById = new Map<string, any>(sets.map(set => [String(set.id), set]));
    const hidden = hiddenSources(sets, setsById, fill);
    const fromSeed = (seed: any) => seed && fill?.bySeedId.get(String(seed.id));

    for (const set of sets) set.slots.forEach((slot, i) => {
        if (!slot?.entrant && slot?.prereqType === 'seed' && fill?.bySeedId.has(String(slot.prereqId)))
            set.slots[i] = { ...projectedSlot(fill.bySeedId.get(String(slot.prereqId))), prereqType: slot.prereqType, prereqId: slot.prereqId, prereqPlacement: slot.prereqPlacement };
    });

    const done = new Set<string>();
    const fillSet = (set: any, depth: number) => {
        if (done.has(String(set.id)) || depth > 64) return;
        done.add(String(set.id));
        // The reset is only played if the losers side wins the grand final, so it isn't projected
        if (set.fullRoundText === 'Grand Final Reset') return;
        set.slots.forEach((slot, slotIndex) => {
            if (!slot || slot.entrant || slot.prereqType !== 'set') return;
            let source = setsById.get(String(slot.prereqId));
            let placement = slot.prereqPlacement;
            const left = source ? null : hidden.get(String(slot.prereqId));
            if (left?.seed) {
                const seeded = fromSeed(left.seed);
                if (seeded) set.slots[slotIndex] = projectedSlot(seeded);
                return;
            }
            // A set start.gg doesn't send: whoever reaches it is the loser of a winners set
            if (left?.set) {
                source = left.set;
                placement = 2;
            }
            if (!source) return;
            fillSet(source, depth + 1);
            const advancing = setPlacement(source, placement);
            if (advancing.entrant) set.slots[slotIndex] = projectedSlot(advancing);
        });
    };
    setsById.forEach(set => fillSet(set, 0));
    return projected;
}

// Where a pool's players leave it, in the order start.gg places them. Each "exit" is a set and a
// placement in it (1 its winner, 2 its loser) that no other set of the pool takes a player from.
//
// start.gg gives every player who leaves at the same point one placement: the losers of a losers round
// tie, and so do, in a pool that stops early, the players still on the winners side, and those on the
// losers side (with the losers of the last winners round played, whose next set isn't in the pool).
// Among the players with one placement, `originOrder` follows the seed each exit is meant for: the seed
// that gets there if every set goes to the better seed (checked against Genesis X's R1 and R2 pools and
// Top 64, and weeklies with byes and two next phases; 2026-11-18). Ties are groups ("tiers") of exits,
// in the order of their best seed. A tier of players knocked out has its place: 1 plus everyone ahead.
// The players still in when the pool stops get the placement they'd have if they lost their next set,
// which the next phases' seeds say (see assignExits).
//
// Null when an exit's seed can't be worked out (a set left out that can't be placed): then nobody is
// sent on from this pool rather than someone in the wrong place.
export type Exit = { set: any, placement: number, seed: number };
export type Tier = { still: boolean, place: number | null, exits: Exit[] };

export function rankExits(rawSets: any[], fill: PoolFill | null = null): Tier[] | null {
    // An unplayed reset is dropped, as the bracket view drops it
    const sets = rawSets.filter(set => set.fullRoundText !== 'Grand Final Reset' || set.slots?.[0]?.entrant);
    const setsById = new Map<string, any>(sets.map(set => [String(set.id), set]));
    const hidden = hiddenSources(sets, setsById, fill);
    const taken = new Set<string>();
    for (const set of sets) for (const slot of set.slots) {
        if (slot?.prereqType !== 'set') continue;
        const left = setsById.has(String(slot.prereqId)) ? null : hidden.get(String(slot.prereqId));
        if (setsById.has(String(slot.prereqId))) taken.add(`${slot.prereqId}:${slot.prereqPlacement}`);
        else if (left?.set) taken.add(`${left.set.id}:2`);
    }

    // The seed meant for each slot and each exit: from the pool's own seed numbers when they are known
    // (a later phase), otherwise the players' seeds
    const seedNumOf = new Map<string, number>([...(fill?.seedsById ?? new Map()).values()].map(seed => [String(seed.id), Number(seed.groupSeedNum)]));
    const numOfEntrant = new Map<any, number>([...(fill?.seedsById ?? new Map()).values()].filter(seed => seed.entrant).map(seed => [seed.entrant.id, Number(seed.groupSeedNum)]));
    const ofEntrant = (entrant: any) => entrant == null ? Infinity
        : numOfEntrant.size ? numOfEntrant.get(entrant.id) ?? Infinity : Number(entrant.initialSeedNum) || Infinity;
    const memo = new Map<string, number>();
    const meant = (set: any, placement: number, depth = 0): number => {
        const key = `${set.id}:${placement}`;
        if (memo.has(key)) return memo.get(key);
        if (depth > 64) return Infinity;
        const seeds = set.slots.map(slot => {
            if (slot?.prereqType === 'seed') return seedNumOf.get(String(slot.prereqId)) ?? ofEntrant(slot.entrant);
            if (slot?.prereqType === 'set') {
                const source = setsById.get(String(slot.prereqId));
                if (source) return meant(source, slot.prereqPlacement, depth + 1);
                const left = hidden.get(String(slot.prereqId));
                if (left?.set) return meant(left.set, 2, depth + 1);
                if (left?.seed) return Number(left.seed.groupSeedNum) || Infinity;
            }
            return ofEntrant(slot?.entrant);
        }).sort((a, b) => a - b);
        const value = placement == 1 ? seeds[0] : seeds[1];
        memo.set(key, value);
        return value;
    };

    const doubleElimination = sets.some(set => set.round < 0);
    const isFinal = (set: any) => set.round > 0 && (set.fullRoundText === 'Grand Final Reset'
        || set.slots.some(slot => slot?.prereqType === 'set' && setsById.get(String(slot.prereqId))?.round < 0)
        || (!doubleElimination && !isThirdPlace(set) && sets.filter(other => other.round === set.round && !isThirdPlace(other)).length === 1
            && set.round === Math.max(...sets.filter(other => !isThirdPlace(other)).map(other => other.round))));
    const tierOf = (set: any, placement: number): string => {
        if (set.round > 0) {
            if (isFinal(set)) return `final:${placement}`;
            if (isThirdPlace(set)) return `third:${placement}`;
            if (placement == 1) return 'still:winners';
            return doubleElimination ? 'still:losers' : `out:${set.round}`;
        }
        return placement == 1 ? 'still:losers' : `out:${set.round}`;
    };

    const tiers = new Map<string, Exit[]>();
    for (const set of sets) for (const placement of [1, 2]) {
        if (taken.has(`${set.id}:${placement}`)) continue;
        const key = tierOf(set, placement);
        if (!tiers.has(key)) tiers.set(key, []);
        tiers.get(key).push({ set, placement, seed: meant(set, placement) });
    }
    const exits = [...tiers.values()].flat();
    if (!exits.length || exits.some(exit => !Number.isFinite(exit.seed)) || new Set(exits.map(exit => exit.seed)).size !== exits.length) return null;
    // Losers of the winners side who leave the pool can only come from the last winners round played
    // before it stops. More than one round of them means a set left out wasn't placed.
    const dropped = new Set((tiers.get('still:losers') ?? []).filter(exit => exit.set.round > 0).map(exit => exit.set.round));
    if (dropped.size > 1) return null;

    const ranked = [...tiers.entries()].map(([key, exits]) => ({ still: key.startsWith('still:'), place: null, exits: exits.sort((a, b) => a.seed - b.seed) }))
        .sort((a, b) => a.exits[0].seed - b.exits[0].seed);
    let ahead = 0;
    for (const tier of ranked) {
        if (!tier.still) tier.place = ahead + 1;
        ahead += tier.exits.length;
    }
    return ranked;
}

// A single elimination 3rd place match: start.gg puts it in the round after the final, fed by the semi-finals' losers
function isThirdPlace(set: any): boolean {
    return set.round > 0 && set.slots.every(slot => slot?.prereqType === 'set' && slot.prereqPlacement == 2);
}

// Matches the next phases' seeds filled from a pool (`sources`: progressionSource { originPlacement,
// originOrder }) to its exits: a placement a knocked-out tier has goes to that tier; the others, the
// best placements, go to the tiers still in, in order. Then the seed with order k takes the tier's k-th
// exit. Players knocked out together (sent on to a redemption bracket, say) are left out: start.gg's
// order among them follows neither their seeds nor their sets (a weekly's Redemption, 2026-11-18).
// Returns the exit for each seed id it could place.
export function assignExits(tiers: Tier[], sources: any[]): Map<string, Exit> {
    const assigned = new Map<string, Exit>();
    const byPlacement = new Map<number, any[]>();
    for (const seed of sources) {
        const placement = Number(seed?.progressionSource?.originPlacement);
        if (!(placement > 0) || seed?.id == null) continue;
        if (!byPlacement.has(placement)) byPlacement.set(placement, []);
        byPlacement.get(placement).push(seed);
    }
    const stillIn = tiers.filter(tier => tier.still);
    let next = 0;
    for (const placement of [...byPlacement.keys()].sort((a, b) => a - b)) {
        const seeds = byPlacement.get(placement);
        let tier = tiers.find(tier => !tier.still && tier.place === placement);
        if (!tier) {
            tier = stillIn[next++];
            // A group the tier can't hold means the tiers are not what start.gg made of the pool: stop
            if (!tier || seeds.some(seed => Number(seed.progressionSource.originOrder) > tier.exits.length)) break;
        } else if (tier.exits.length > 1) continue;
        for (const seed of seeds) {
            const exit = tier.exits[Number(seed.progressionSource.originOrder) - 1];
            if (exit) assigned.set(String(seed.id), exit);
        }
    }
    return assigned;
}

// How many slots of a pool's sets wait for a seed start.gg hasn't placed anyone in: an empty slot named
// by its seed, or an empty slot on the losers side that links to a set start.gg doesn't send
export function emptySeedSlots(sets: any[]): number {
    const ids = new Set(sets.map(set => String(set.id)));
    return sets.reduce((n, set) => n + set.slots.filter(slot => slot && !slot.entrant
        && (slot.prereqType === 'seed' || (set.round < 0 && slot.prereqType === 'set' && slot.prereqPlacement == 1 && !ids.has(String(slot.prereqId))))).length, 0);
}

// What the cross-phase projection reads, from what the app has loaded so far. Each returns null for
// something not loaded.
export type ProjectionData = {
    // The event's phases, in order, each with `progressingInData { origin }`
    phases: any[];
    // start.gg's phase (the phase query: its pools, each with its seedMap)
    phase(phaseId: string): any | null;
    // A pool's sets, as start.gg sends them
    poolSets(poolId: string): any[] | null;
    // A phase's seeds with where each comes from (the progressions query)
    seeds(phaseId: string): any[] | null;
};

// What is needed and not loaded: phases, pools' sets by phase, and phases' seeds
export type Missing = { phases: Set<string>, pools: Map<string, Set<string>>, seeds: Set<string> };

export const isMissing = (missing: Missing | null) => !!missing && (missing.phases.size > 0 || missing.pools.size > 0 || missing.seeds.size > 0);

// The most phases back one projection follows (R1 Pools to R2 Pools to Top 64 to Top 8 is three)
const MAX_DEPTH = 8;

// Show Projected across phases: for each of the shown phase's pools (`poolIds`), the players projected
// out of the earlier phases into the seeds start.gg hasn't placed anyone in yet. Each earlier pool is
// projected (with its own empty seeds filled the same way, back to the first phase), its exits matched
// to the seeds it fills, and whoever the projection puts at an exit fills that seed. A seed start.gg has
// placed someone in keeps them. Only the pools and phases that fill an empty seed are looked at, and
// what they need but isn't loaded is listed in `missing`. `unplaced` counts the shown pools' empty seeds,
// or is null when the shown phase's seeds aren't loaded.
export function projectAcrossPhases(shownPhaseId: any, poolIds: any[], data: ProjectionData): { fills: Map<string, PoolFill>, missing: Missing, unplaced: number | null, filled: number } {
    const missing: Missing = { phases: new Set(), pools: new Map(), seeds: new Set() };
    const exitsOf = new Map<string, Map<string, any> | null>();
    const originsOf = (phaseId: string) => (data.phases.find(phase => String(phase?.id) === phaseId)?.progressingInData ?? [])
        .map(source => source?.origin).filter(origin => origin != null).map(String);
    const nextOf = (phaseId: string) => data.phases.filter(phase => phase?.id != null && String(phase.id) !== phaseId
        && (phase.progressingInData ?? []).some(source => String(source?.origin) === phaseId)).map(phase => String(phase.id));
    const seedsOf = (phaseId: string) => {
        const seeds = data.seeds(phaseId);
        if (!seeds) missing.seeds.add(phaseId);
        return seeds;
    };
    const needPool = (phaseId: string, poolId: string) => {
        if (!missing.pools.has(phaseId)) missing.pools.set(phaseId, new Set());
        missing.pools.get(phaseId).add(poolId);
    };

    // The fill for a pool of `phaseId`, or null if the phase takes nobody from an earlier one
    const fillOf = (phaseId: string, poolId: string, depth: number): PoolFill | null => {
        if (!originsOf(phaseId).length) return null;
        const seeds = seedsOf(phaseId);
        if (!seeds) return null;
        const own = seeds.filter(seed => String(seed?.phaseGroup?.id) === poolId && seed?.id != null);
        const fill: PoolFill = {
            bySeedId: new Map(),
            seedsById: new Map(own.map(seed => [String(seed.id), seed])),
            seedMap: data.phase(phaseId)?.phaseGroups?.nodes?.find(group => String(group?.id) === poolId)?.seedMap ?? null,
        };
        for (const seed of own) {
            const origin = seed.progressionSource?.originPhaseGroup?.id;
            if (seed.entrant || origin == null) continue;
            const slot = exitSlot(phaseId, String(origin), String(seed.id), depth);
            if (slot) fill.bySeedId.set(String(seed.id), slot);
        }
        return fill;
    };

    // Who the projection puts in seed `seedId` of `phaseId`, from pool `originPool` of an earlier phase
    const exitSlot = (phaseId: string, originPool: string, seedId: string, depth: number) => {
        let originPhase = null;
        for (const candidate of originsOf(phaseId)) {
            const phase = data.phase(candidate);
            if (!phase) missing.phases.add(candidate);
            else if (phase.phaseGroups?.nodes?.some(group => String(group?.id) === originPool)) originPhase = candidate;
        }
        if (originPhase == null) return null;
        return exitsFrom(originPhase, originPool, depth + 1)?.get(seedId) ?? null;
    };

    // The slot projected into each seed that pool `poolId` of `phaseId` fills, by seed id
    const exitsFrom = (phaseId: string, poolId: string, depth: number): Map<string, any> | null => {
        if (exitsOf.has(poolId)) return exitsOf.get(poolId);
        exitsOf.set(poolId, null);
        if (depth > MAX_DEPTH) return null;
        const sets = data.poolSets(poolId);
        if (!sets) {
            needPool(phaseId, poolId);
            return null;
        }
        if (!sets.length) return null;
        const fill = fillOf(phaseId, poolId, depth);
        const tiers = rankExits(sets, fill);
        if (!tiers) return null;
        const projected = new Map<string, any>((projectPool(sets, fill) as any[]).map(set => [String(set.id), set]));
        const sources = nextOf(phaseId).flatMap(next => (seedsOf(next) ?? []).filter(seed => String(seed?.progressionSource?.originPhaseGroup?.id) === poolId));
        const slots = new Map<string, any>();
        assignExits(tiers, sources).forEach((exit, seedId) => {
            const slot = setPlacement(projected.get(String(exit.set.id)), exit.placement);
            if (slot.entrant) slots.set(seedId, projectedSlot(slot));
        });
        exitsOf.set(poolId, slots);
        return slots;
    };

    const shown = String(shownPhaseId);
    const fills = new Map<string, PoolFill>();
    let unplaced: number | null = 0, filled = 0;
    if (!originsOf(shown).length) return { fills, missing, unplaced: 0, filled };
    if (!data.seeds(shown)) unplaced = null;
    for (const poolId of poolIds.map(String)) {
        const fill = fillOf(shown, poolId, 0);
        if (!fill) continue;
        fills.set(poolId, fill);
        filled += fill.bySeedId.size;
        if (unplaced != null) unplaced += [...fill.seedsById.values()].filter(seed => !seed.entrant).length;
    }
    return { fills, missing, unplaced, filled };
}

// The most requests "Project from pools" may send for one click (event.component.ts projectFromPools)
export const PROJECTION_MAX_REQUESTS = 60;
