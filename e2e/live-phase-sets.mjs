// Live check against the real start.gg (needs STARTGG_TOKEN): a multi-pool phase fetched the way the
// app does it, in runs of pool slices (poolSlicesQuery: pages of 5 sets from one pool, several pools per
// request), must give each pool exactly the sets of that pool fetched alone: the same sets, in the same
// order, with the same data. The app draws from that order, so matching means every set lands in the
// same spot. Requests here are kept small (about 25 sets) so pools are split across requests.
// Uses the 8-pool "Brawl" Singles pools phase of Tussle Thru Time. About 20 requests.
// Usage: node e2e/live-phase-sets.mjs   Prints a JSON report and exits 1 on a mismatch.
import { askStartgg } from './startgg-live.mjs';
const { poolSlicesQuery, MAX_POOL_SLICES } = await import('../src/app/services/startgg-queries.ts');
const token = process.env.STARTGG_TOKEN;
if (!token) {
    console.log(JSON.stringify({ skipped: 'no STARTGG_TOKEN' }));
    process.exit(0);
}

const phaseId = 2258351;
const sliceSize = 5;
const setsPerRequest = 23;
const fields = 'id round fullRoundText winnerId displayScore slots { prereqId prereqType prereqPlacement entrant { id name initialSeedNum } }';
const ask = async (query, variables) => {
    const { status, json } = await askStartgg(token, query, variables);
    if (json.errors?.length || !json.data) throw new Error(`start.gg: ${status} ${JSON.stringify(json.errors ?? json).slice(0, 300)}`);
    return json.data;
};
// The app's fields, without the games (the same objects everywhere, and they make the comparison long)
const pick = set => ({ id: set.id, round: set.round, fullRoundText: set.fullRoundText, winnerId: set.winnerId, displayScore: set.displayScore,
    slots: set.slots.map(({ prereqId, prereqType, prereqPlacement, entrant }) => ({ prereqId, prereqType, prereqPlacement, entrant })) });

const report = { phaseId, pools: [] };
const phase = (await ask(`query { phase(id: ${phaseId}) {
    phaseGroups(query: { page: 1, perPage: 100 }) { nodes { id displayIdentifier sets(page: 1, perPage: 1, sortType: ROUND) { pageInfo { total } } } } } }`)).phase;
const pools = phase.phaseGroups.nodes;

// Each pool's slices, one past its set count, packed in order into requests of about setsPerRequest sets
const slices = pools.flatMap(group => {
    const total = group.sets.pageInfo.total;
    return Array.from({ length: Math.floor(total / sliceSize) + 1 }, (_, i) => ({ group: group.id, page: i + 1, sets: Math.min(sliceSize, total - i * sliceSize) }));
});
const requests = [];
for (const slice of slices) {
    const last = requests.at(-1);
    if (last && last.reduce((n, s) => n + s.sets, 0) + slice.sets <= setsPerRequest && last.length < MAX_POOL_SLICES) last.push(slice);
    else requests.push([slice]);
}
const sliced = new Map(pools.map(group => [group.id, []]));
const splitPools = new Set();
for (const request of requests) {
    const variables = { perPage: sliceSize };
    request.forEach((slice, k) => Object.assign(variables, { [`g${k}`]: slice.group, [`p${k}`]: slice.page }));
    const data = await ask(poolSlicesQuery(request.length), variables);
    request.forEach((slice, k) => sliced.get(slice.group).push(...data[`s${k}`].sets.nodes.map(pick)));
}
for (const group of pools) if (new Set(requests.filter(r => r.some(s => s.group === group.id))).size > 1) splitPools.add(group.id);

for (const group of pools) {
    const alone = [];
    for (let page = 1; alone.length < group.sets.pageInfo.total; page++) {
        const nodes = (await ask(`query { phaseGroup(id: ${group.id}) { sets(page: ${page}, perPage: 55, sortType: ROUND) { nodes { ${fields} } } } }`)).phaseGroup.sets.nodes;
        if (!nodes.length) break;
        alone.push(...nodes.map(pick));
    }
    report.pools.push({ pool: group.displayIdentifier, sets: alone.length, split: splitPools.has(group.id), same: JSON.stringify(sliced.get(group.id)) === JSON.stringify(alone) });
}

report.requests = requests.length;
report.splitPools = splitPools.size;
report.passed = report.pools.length > 1 && splitPools.size > 0 && report.pools.every(p => p.same && p.sets > 0);
console.log(JSON.stringify(report, null, 2));
process.exit(report.passed ? 0 : 1);
