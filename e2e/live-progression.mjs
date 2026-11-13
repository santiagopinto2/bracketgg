// Live check against the real start.gg (needs STARTGG_TOKEN) of what the progression tags are drawn
// from, on Genesis X Melee Singles: the event's phases say which phase each takes its players from; a
// pool's sets say where their winners and losers go only when asked ($progression), at 2 objects per
// set and 2 per seed; a pool slice answers the same; and a player keeps their entrant id in the next
// phase, which is what the tag's link carries. 5 requests.
// Usage: node --experimental-strip-types e2e/live-progression.mjs
import { eventPhasesQuery, poolSetsQuery, poolSlicesQuery } from '../src/app/services/startgg-queries.ts';
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

// R1 Pools 1465054 (pool A505 is 2341829) feeds R2 Pools 1572545 (pool H517 is 2357765), which feeds Top 64 1560208
const phasesAnswer = await ask(eventPhasesQuery, { slug: 'tournament/genesis-x/event/melee-singles' });
const phases = phasesAnswer.data?.event?.phases ?? [];
const origins = phases.map(p => [p.name, p.groupCount, (p.progressingInData ?? []).map(d => d.origin)]);
check('event phases: each phase names the phase its players come from, and its pool count', !phasesAnswer.errors.length
    && JSON.stringify(origins) === JSON.stringify([['R1 Pools', 64, []], ['R2 Pools', 16, [1465054]], ['Top 64', 1, [1572545]], ['Top 8', 1, [1560208]]]) && (phasesAnswer.complexity ?? 0) < 50,
    { errors: phasesAnswer.errors, complexity: phasesAnswer.complexity, origins });

const seedsOf = sets => sets.flatMap(set => [['winner', set.winnerProgressionSeed], ['loser', set.loserProgressionSeed]].filter(([, seed]) => seed)
    .map(([who, seed]) => ({ who, to: `${seed.phase?.name} ${seed.phase?.id} ${seed.phaseGroup?.displayIdentifier} ${seed.phaseGroup?.id}`,
        player: who === 'winner' ? set.winnerId : set.slots.find(slot => slot.entrant && slot.entrant.id != set.winnerId)?.entrant.id })));

const plain = await ask(poolSetsQuery, { id: 2341829, page: 1, perPage: 80, progression: false });
const plainSets = plain.data?.phaseGroup?.sets?.nodes ?? [];
const asked = await ask(poolSetsQuery, { id: 2341829, page: 1, perPage: 80, progression: true });
const sets = asked.data?.phaseGroup?.sets?.nodes ?? [];
const seeds = seedsOf(sets);
check('a pool\'s sets without $progression: no seed fields, 9 objects a set', !plain.errors.length && plainSets.length === 40
    && plainSets.every(set => !('winnerProgressionSeed' in set) && !('loserProgressionSeed' in set)) && plain.complexity <= 1 + 9 * plainSets.length,
    { errors: plain.errors, complexity: plain.complexity, sets: plainSets.length });
check('a pool\'s sets with $progression: 4 winners and 2 losers go to R2 Pools, pool H517, at no more than 12 objects a set',
    !asked.errors.length && sets.length === 40 && seeds.length === 6 && seeds.filter(s => s.who === 'winner').length === 4
    && seeds.every(s => s.to === 'R2 Pools 1572545 H517 2357765' && s.player) && asked.complexity <= 12 * sets.length && asked.complexity === plain.complexity + 2 * sets.length + 2 * seeds.length,
    { errors: asked.errors, complexity: asked.complexity, sets: sets.length, seeds });

// The same pool as two pool slices of 5 sets: the same seeds as the first 10 sets asked for alone
const sliced = await ask(poolSlicesQuery(2), { g0: 2341829, p0: 1, g1: 2341829, p1: 2, perPage: 5, progression: true });
const slicedSets = [...(sliced.data?.s0?.sets?.nodes ?? []), ...(sliced.data?.s1?.sets?.nodes ?? [])];
check('pool slices with $progression: the same sets and seeds as the pool asked for alone', !sliced.errors.length && slicedSets.length === 10
    && JSON.stringify(slicedSets) === JSON.stringify(sets.slice(0, 10)) && sliced.complexity <= 2 + 12 * slicedSets.length,
    { errors: sliced.errors, complexity: sliced.complexity, sets: slicedSets.length });

// The six players who went on play in H517 under the same entrant ids, and H517's own seeds lead to Top 64
const next = await ask(poolSetsQuery, { id: 2357765, page: 1, perPage: 80, progression: true });
const nextSets = next.data?.phaseGroup?.sets?.nodes ?? [];
const playing = new Set(nextSets.flatMap(set => set.slots.map(slot => slot.entrant?.id)));
const nextSeeds = seedsOf(nextSets);
check('the next phase: every player sent on plays there under the same entrant id, and its seeds lead to Top 64',
    !next.errors.length && seeds.length === 6 && seeds.every(s => playing.has(s.player)) && nextSeeds.length > 0 && nextSeeds.every(s => s.to === 'Top 64 1560208 KL719 2341867'),
    { errors: next.errors, complexity: next.complexity, sets: nextSets.length, found: seeds.map(s => playing.has(s.player)), nextSeeds: nextSeeds.map(s => s.to) });

report.passed = report.checks.every(c => c.ok);
console.log(JSON.stringify(report, null, 2));
process.exit(report.passed ? 0 : 1);
