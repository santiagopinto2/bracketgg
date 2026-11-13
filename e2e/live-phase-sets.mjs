// Live check against the real start.gg (needs STARTGG_TOKEN): a phase's sets fetched all at once,
// then sorted by pool, must match each pool fetched alone: the same sets, in the same order, with
// the same data. The app draws from that order, so matching means every set lands in the same spot.
// Uses the 8-pool "Brawl" Singles pools phase of Tussle Thru Time. About 15 requests.
// Usage: node e2e/live-phase-sets.mjs   Prints a JSON report and exits 1 on a mismatch.
import { askStartgg } from './startgg-live.mjs';
const token = process.env.STARTGG_TOKEN;
if (!token) {
    console.log(JSON.stringify({ skipped: 'no STARTGG_TOKEN' }));
    process.exit(0);
}

const phaseId = 2258351;
const fields = 'id round fullRoundText winnerId slots { prereqId prereqType prereqPlacement entrant { id name initialSeedNum } standing { stats { score { value } } } }';
const ask = async query => {
    const { status, json } = await askStartgg(token, query);
    if (json.errors?.length || !json.data) throw new Error(`start.gg: ${status} ${JSON.stringify(json.errors ?? json).slice(0, 300)}`);
    return json.data;
};

const report = { phaseId, pools: [] };
const phase = (await ask(`query { phase(id: ${phaseId}) { sets(page: 1, perPage: 1, sortType: ROUND) { pageInfo { total } }
    phaseGroups(query: { page: 1, perPage: 100 }) { nodes { id displayIdentifier sets(page: 1, perPage: 1, sortType: ROUND) { pageInfo { total } } } } } }`)).phase;
const total = phase.sets.pageInfo.total;

const whole = [];
for (let page = 1; whole.length < total; page++) {
    const nodes = (await ask(`query { phase(id: ${phaseId}) { sets(page: ${page}, perPage: 50, sortType: ROUND) { nodes { phaseGroup { id } ${fields} } } } }`)).phase.sets.nodes;
    if (!nodes.length) break;
    whole.push(...nodes);
}

for (const group of phase.phaseGroups.nodes) {
    const alone = [];
    for (let page = 1; alone.length < group.sets.pageInfo.total; page++) {
        const nodes = (await ask(`query { phaseGroup(id: ${group.id}) { sets(page: ${page}, perPage: 55, sortType: ROUND) { nodes { ${fields} } } } }`)).phaseGroup.sets.nodes;
        if (!nodes.length) break;
        alone.push(...nodes);
    }
    const fromPhase = whole.filter(set => set.phaseGroup?.id == group.id).map(({ phaseGroup, ...set }) => set);
    report.pools.push({ pool: group.displayIdentifier, sets: alone.length, same: JSON.stringify(fromPhase) === JSON.stringify(alone) });
}

report.totalSets = total;
report.phaseFetched = whole.length;
report.passed = whole.length === total && report.pools.length > 1 && report.pools.every(p => p.same && p.sets > 0);
console.log(JSON.stringify(report, null, 2));
process.exit(report.passed ? 0 : 1);
