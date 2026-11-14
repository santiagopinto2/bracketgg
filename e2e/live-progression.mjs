// Live check against the real start.gg (needs STARTGG_TOKEN) of what the progression tags are drawn
// from, on Genesis X Melee Singles: the event's phases say which phase each takes its players from;
// the next phase's seeds say which pool each is filled from, where it plays and who was placed in it,
// at 4 objects per seed; each placed player's last set in their pool is found from the links between
// sets; and a player keeps their entrant id in the next phase, which is what the tag's link carries.
// 5 requests.
// Usage: node --experimental-strip-types e2e/live-progression.mjs
import { eventPhasesQuery, phaseProgressionsQuery, poolSetsQuery } from '../src/app/services/startgg-queries.ts';
import { askStartgg } from './startgg-live.mjs';

const token = process.env.STARTGG_TOKEN;
if (!token) {
    console.log(JSON.stringify({ skipped: 'no STARTGG_TOKEN' }));
    process.exit(0);
}
const ask = async (query, variables) => {
    const { status, json } = await askStartgg(token, query, variables);
    return { data: json.data, errors: json.errors?.map(e => e.message) ?? (json.data ? [] : [json.message ?? `HTTP ${status}`]), complexity: json.extensions?.queryComplexity ?? null };
};
const report = { checks: [] };
const check = (name, ok, detail) => report.checks.push({ name, ok: !!ok, detail });

// R1 Pools 1465054 (pool D503 is 2216620) feeds R2 Pools 1572545 (pool J619 is 2357746), which feeds Top 64 1560208
const phasesAnswer = await ask(eventPhasesQuery, { slug: 'tournament/genesis-x/event/melee-singles' });
const phases = phasesAnswer.data?.event?.phases ?? [];
const origins = phases.map(p => [p.name, p.groupCount, (p.progressingInData ?? []).map(d => [d.origin, d.numProgressing])]);
check('event phases: each phase names the phase its players come from and how many, and its pool count', !phasesAnswer.errors.length
    && JSON.stringify(origins) === JSON.stringify([['R1 Pools', 64, []], ['R2 Pools', 16, [[1465054, 384]]], ['Top 64', 1, [[1572545, 64]]], ['Top 8', 1, [[1560208, 8]]]]) && (phasesAnswer.complexity ?? 0) < 50,
    { errors: phasesAnswer.errors, complexity: phasesAnswer.complexity, origins });

// R2 Pools' 384 seeds, the way the app asks: pages of 240
const pages = [await ask(phaseProgressionsQuery, { phaseId: 1572545, page: 1, perPage: 240 }), await ask(phaseProgressionsQuery, { phaseId: 1572545, page: 2, perPage: 240 })];
const seeds = pages.flatMap(page => page.data?.phase?.seeds?.nodes ?? []);
check('the next phase\'s seeds: 384 in two requests, 4 objects a seed, each with the pool it is filled from, the pool it plays in and its entrant',
    pages.every(page => !page.errors.length) && seeds.length === 384 && pages[0].complexity === 961 && pages[1].complexity === 577
    && seeds.every(seed => seed.entrant?.id && seed.phaseGroup?.id && seed.phaseGroup.displayIdentifier && seed.progressionSource?.originPhaseGroup?.id && seed.progressionSource.originPlacement > 0)
    && new Set(seeds.map(seed => seed.progressionSource.originPhaseGroup.id)).size === 64,
    { errors: pages.flatMap(page => page.errors), complexity: pages.map(page => page.complexity), seeds: seeds.length });

// Pool D503: two players placed 3rd (the winners semi-finals' winners) and four 5th (their losers and
// the last losers round's winners), all to pool J619. Each one's last set in the pool is the set of
// theirs that none of their others is reached from, as the app finds it.
const pool = await ask(poolSetsQuery, { id: 2216620, page: 1, perPage: 95 });
const sets = pool.data?.phaseGroup?.sets?.nodes ?? [];
const fromPool = seeds.filter(seed => seed.progressionSource.originPhaseGroup.id == 2216620);
const lastSetOf = playerId => {
    const slotOf = set => set.slots.find(slot => slot.entrant?.id == playerId);
    const theirs = sets.filter(slotOf);
    const left = new Set(theirs.map(slotOf).filter(slot => slot.prereqType === 'set').map(slot => String(slot.prereqId)));
    const ends = theirs.filter(set => !left.has(String(set.id)));
    return ends.length === 1 ? ends[0] : null;
};
const tags = fromPool.map(seed => {
    const last = lastSetOf(seed.entrant.id);
    return { placement: seed.progressionSource.originPlacement, to: `${seed.phaseGroup.displayIdentifier} ${seed.phaseGroup.id}`, set: last?.id, round: last?.fullRoundText, who: last && (last.winnerId == seed.entrant.id ? 'W' : 'L') };
});
const winnerPlaysOn = new Set(sets.flatMap(set => set.slots).filter(slot => slot.prereqType === 'set' && slot.prereqPlacement == 1).map(slot => String(slot.prereqId)));
const exitSets = sets.filter(set => !winnerPlaysOn.has(String(set.id))).map(set => set.id).sort();
const said = placement => tags.filter(tag => tag.placement === placement).map(tag => `${tag.who} ${tag.round.startsWith('Winners Semi') ? 'winners semi-final' : tag.round.startsWith('Losers') ? 'losers' : tag.round}`).sort().join(', ');
check('a pool\'s sets cost what they did (9 objects a set), and each placed player\'s last set is found: 3rd place won a winners semi-final, 5th place lost one or won the last losers round; those four sets are the pool\'s exit sets',
    !pool.errors.length && sets.length > 0 && pool.complexity === 1 + 9 * sets.length && !/ProgressionSeed/.test(poolSetsQuery) && tags.length === 6 && tags.every(tag => tag.set && tag.to === 'J619 2357746')
    && said(3) === 'W winners semi-final, W winners semi-final' && said(5) === 'L winners semi-final, L winners semi-final, W losers, W losers'
    && JSON.stringify([...new Set(tags.map(tag => tag.set))].sort()) === JSON.stringify(exitSets),
    { errors: pool.errors, complexity: pool.complexity, sets: sets.length, tags, exitSets });

// The six players play in J619 under the same entrant ids
const next = await ask(poolSetsQuery, { id: 2357746, page: 1, perPage: 95 });
const playing = new Set((next.data?.phaseGroup?.sets?.nodes ?? []).flatMap(set => set.slots.map(slot => slot.entrant?.id)));
check('the next phase: every player sent on plays in their pool there under the same entrant id', !next.errors.length && fromPool.length === 6 && fromPool.every(seed => playing.has(seed.entrant.id)),
    { errors: next.errors, found: fromPool.map(seed => playing.has(seed.entrant.id)) });

report.passed = report.checks.every(c => c.ok);
console.log(JSON.stringify(report, null, 2));
process.exit(report.passed ? 0 : 1);
