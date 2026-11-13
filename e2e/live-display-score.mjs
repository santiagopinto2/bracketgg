// Live check against the real start.gg (needs STARTGG_TOKEN): scores read from displayScore must
// equal each slot's standing score, on Genesis X Melee Singles R2 Pools (416 sets, played with
// scores) and Top 64 (84 sets, best of 5 with DQs). Also checks a 95-set page of the app's slimmed
// query fits under the 1000-object cap. About 15 requests.
// Usage: node --experimental-strip-types e2e/live-display-score.mjs
import { scoresFromDisplayScore } from '../src/app/services/display-score.ts';
import { askStartgg } from './startgg-live.mjs';

const token = process.env.STARTGG_TOKEN;
if (!token) {
    console.log(JSON.stringify({ skipped: 'no STARTGG_TOKEN' }));
    process.exit(0);
}
// A refused request stops the check with start.gg's answer, rather than counting as an empty page
const ask = async query => {
    const { status, json } = await askStartgg(token, query);
    if (json.errors?.length && !json.data) throw new Error(`start.gg: ${status} ${JSON.stringify(json.errors).slice(0, 300)}`);
    if (!json.data) throw new Error(`start.gg: ${status} ${JSON.stringify(json).slice(0, 300)}`);
    return json;
};

const report = { phases: [] };
for (const [name, phaseId, total] of [['R2 Pools', 1572545, 416], ['Top 64', 1560208, 84]]) {
    const sets = [];
    for (let page = 1; sets.length < total; page++) {
        const json = await ask(`query { phase(id: ${phaseId}) { sets(page: ${page}, perPage: 40, sortType: ROUND) { nodes {
            id winnerId displayScore slots { entrant { id name } standing { stats { score { value } } } } } } } }`);
        const nodes = json.data?.phase?.sets?.nodes ?? [];
        if (!nodes.length) break;
        sets.push(...nodes);
    }
    let same = 0, unread = 0;
    const wrong = [];
    for (const set of sets) {
        const real = set.slots.map(slot => slot.standing?.stats?.score?.value ?? null);
        const read = scoresFromDisplayScore(set);
        if (!read) unread++;
        else if (JSON.stringify(read) === JSON.stringify(real)) same++;
        else wrong.push({ displayScore: set.displayScore, read, real });
    }
    report.phases.push({ name, sets: sets.length, same, unread, wrong: wrong.slice(0, 5) });
}

// The app's set query at 95 per page, on R1 Pools (no characters reported)
const page = await ask(`query { phase(id: 1465054) { sets(page: 1 perPage: 95 sortType: ROUND) { nodes { phaseGroup { id } id round fullRoundText winnerId displayScore
    games { winnerId stage { name } selections { entrant { id } character { name images { url type width height } } } }
    slots { prereqId prereqType prereqPlacement entrant { id name initialSeedNum } } } } } }`);
report.page95 = { complexity: page.extensions?.queryComplexity ?? null, errors: page.errors?.map(e => e.message) ?? [] };

report.passed = report.phases.every(p => p.sets > 0 && p.same === p.sets) && !report.page95.errors.length;
console.log(JSON.stringify(report, null, 2));
process.exit(report.passed ? 0 : 1);
