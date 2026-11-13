// Live check against the real start.gg (needs STARTGG_TOKEN) of the bracket view's lighter requests, on
// Genesis X Melee Singles: the event's id and phases in one small query, a phase's players come
// with profile pictures only and a 300-player page fits under the 1000-object cap, and the landing page's
// overview still tells who each of the top 8 lost to; the tournament's top 3 pictures are profile pictures. 5 requests.
// Usage: node --experimental-strip-types e2e/live-players.mjs
import { eventOverviewQuery, eventPhasesQuery, phaseEntrantsQuery, tournamentQuery } from '../src/app/services/startgg-queries.ts';
import { lostTo } from '../src/app/services/lost-to.ts';
import { askStartgg } from './startgg-live.mjs';

const token = process.env.STARTGG_TOKEN;
if (!token) {
    console.log(JSON.stringify({ skipped: 'no STARTGG_TOKEN' }));
    process.exit(0);
}
// start.gg's answer, its error messages (a refusal counts as one) and its object count
const ask = async (query, variables) => {
    const { status, json } = await askStartgg(token, query, variables);
    return { data: json.data, errors: json.errors?.map(e => e.message) ?? (json.data ? [] : [json.message ?? `HTTP ${status}`]), complexity: json.extensions?.queryComplexity ?? null };
};
const report = { checks: [] };
const check = (name, ok, detail) => report.checks.push({ name, ok: !!ok, detail });
// A profile picture as asked for: url, width and height, nothing else
const isPicture = image => typeof image?.url === 'string' && image.url.startsWith('https://') && image.width > 0 && image.height > 0 && !('type' in image);

// The event's id and its phases with seed counts
const phasesAnswer = await ask(eventPhasesQuery, { slug: 'tournament/genesis-x/event/melee-singles' });
const phases = phasesAnswer.data?.event?.phases ?? [];
check('event phases: the id, and each phase with its seed count, in a few objects', !phasesAnswer.errors.length && phasesAnswer.data?.event?.id == 985241
    && JSON.stringify(phases.map(p => [p.name, p.numSeeds])) === JSON.stringify([['R1 Pools', 1544], ['R2 Pools', 384], ['Top 64', 64], ['Top 8', 8]]) && (phasesAnswer.complexity ?? 0) < 50,
    { errors: phasesAnswer.errors, complexity: phasesAnswer.complexity, phases });

// The tournament page's top 3 per event: profile pictures only
const tournament = await ask(tournamentQuery, { slug: 'genesis-x' });
const event = tournament.data?.tournament?.events?.find(e => e.slug === 'tournament/genesis-x/event/melee-singles');
const topThreePictures = (event?.standings?.nodes ?? []).flatMap(s => s.entrant?.participants?.[0]?.user?.images ?? []);
check('tournament: the top 3 pictures are profile pictures only', !tournament.errors.length && topThreePictures.length > 0 && topThreePictures.length <= 3 && topThreePictures.every(isPicture), topThreePictures);

// Top 8's players: all 8, with gamer tags and pictures
const top8 = await ask(phaseEntrantsQuery, { phaseId: 1560209, page: 1, perPage: 300 });
const top8Players = (top8.data?.phase?.seeds?.nodes ?? []).map(seed => seed.entrant);
const top8Pictures = top8Players.flatMap(p => p?.participants?.[0]?.user?.images ?? []);
check('Top 8 players: 8 entrants with gamer tags and profile pictures (at most one each)', !top8.errors.length && top8Players.length === 8
    && top8Players.every(p => p?.id && p.participants?.[0]?.gamerTag && (p.participants[0].user?.images ?? []).length <= 1)
    && top8Pictures.length >= 4 && top8Pictures.every(isPicture),
    { errors: top8.errors, complexity: top8.complexity, players: top8Players.map(p => p?.participants?.[0]?.gamerTag), pictures: top8Pictures.length });

// R1 Pools: a full 300-player page fits under the cap
const r1 = await ask(phaseEntrantsQuery, { phaseId: 1465054, page: 1, perPage: 300 });
const r1Players = r1.data?.phase?.seeds?.nodes ?? [];
check('R1 Pools players: a 300-player page fits under the 1000-object cap', !r1.errors.length && r1Players.length === 300 && (r1.complexity ?? 0) < 1000,
    { errors: r1.errors, complexity: r1.complexity, players: r1Players.length, pictures: r1Players.filter(s => s.entrant?.participants?.[0]?.user?.images?.length).length });

// The landing page's overview: who each of the top 8 lost to, and profile pictures only
const overview = await ask(eventOverviewQuery({ lostTo: true, rankings: true, socials: true }), { slug: 'tournament/genesis-x/event/melee-singles', videogameId: 1 });
const standings = overview.data?.event?.standings?.nodes ?? [];
const names = new Map(standings.map(s => [String(s.entrant?.id), s.entrant?.name]));
const losses = standings.map(s => lostTo(s.entrant, names, 50));
const standingPictures = standings.flatMap(s => s.entrant?.participants?.[0]?.user?.images ?? []);
check('overview: the winner lost to no one and the rest of the top 8 each lost to two players; pictures are profile pictures only',
    !overview.errors.length && standings.length === 8 && losses[0].length === 0 && losses.slice(1).every(l => l.length === 2)
    && JSON.stringify(losses[1]) === JSON.stringify(['69% | Cody Schwab', '69% | Cody Schwab']) && standingPictures.length > 0 && standingPictures.every(isPicture),
    { errors: overview.errors, complexity: overview.complexity, losses, pictures: standingPictures.length });

report.passed = report.checks.every(c => c.ok);
console.log(JSON.stringify(report, null, 2));
process.exit(report.passed ? 0 : 1);
