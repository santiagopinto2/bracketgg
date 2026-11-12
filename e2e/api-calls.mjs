// Browser test of how the app talks to start.gg, against a fake start.gg.
// Counts the requests a bracket view and an event landing page cost, and checks rate-limit and error handling.
//
//   node e2e/api-calls.mjs <app url> [--report-only]
//   node e2e/api-calls.mjs <app url> --screenshots <dir>   (only the screenshots e2e/visual-diff.mjs compares)
//
// The app must be served (STATIC_DIR=dist/bracketgg/browser node proxy-server.js). Needs the
// playwright package and Chromium (npm install --no-save playwright && npx playwright install chromium).
// Prints a JSON report. Without --report-only it exits 1 if a check fails.
import { chromium, webkit, devices } from 'playwright';
import { readFileSync } from 'node:fs';

const appUrl = process.argv[2] ?? 'http://localhost:4300';
const reportOnly = process.argv.includes('--report-only');
const eventPath = '/tournament/test-tourney/event/test-event/brackets';

const entrants = ['Alpha', 'Bravo', 'Charlie', 'Delta'].map((name, i) => ({
    id: i + 1, name, initialSeedNum: i + 1, participants: [{ gamerTag: name, user: null }]
}));

// A played slot, and an empty one waiting on another set's winner (placement 1) or loser (2)
const slot = (entrantId, score) => {
    const e = entrants[entrantId - 1];
    return { entrant: { id: e.id, name: e.name, initialSeedNum: e.initialSeedNum }, standing: { stats: { score: { value: score } } } };
};
const from = (setId, placement) => ({ prereqType: 'set', prereqId: String(setId), prereqPlacement: placement, entrant: null, standing: null });

// A finished 4-player double elimination pool, in start.gg's ROUND order (losers first)
function poolSets(idBase) {
    return [
        { id: idBase + 5, round: -2, fullRoundText: 'Losers Final', winnerId: 2, slots: [slot(2, 2), slot(3, 1)] },
        { id: idBase + 4, round: -1, fullRoundText: 'Losers Round 1', winnerId: 3, slots: [slot(4, 0), slot(3, 2)] },
        { id: idBase + 1, round: 1, fullRoundText: 'Winners Semi-Final', winnerId: 1, slots: [slot(1, 2), slot(4, 0)] },
        { id: idBase + 2, round: 1, fullRoundText: 'Winners Semi-Final', winnerId: 2, slots: [slot(2, 2), slot(3, 1)] },
        { id: idBase + 3, round: 2, fullRoundText: 'Winners Final', winnerId: 1, slots: [slot(1, 2), slot(2, 0)] },
        { id: idBase + 6, round: 3, fullRoundText: 'Grand Final', winnerId: 1, slots: [slot(1, 3), slot(2, 1)] },
    ];
}

// A 4-player single elimination pool with the semi-finals played and the final still empty. start.gg
// puts a 3rd place match ("3rd Place Tiebreak") in the round after the final, fed by the semi-finals' losers.
function singleElimSets(idBase, withThirdPlace) {
    const sets = [
        { id: idBase + 1, round: 1, fullRoundText: 'Semi-Final', winnerId: 1, slots: [slot(1, 2), slot(4, 0)] },
        { id: idBase + 2, round: 1, fullRoundText: 'Semi-Final', winnerId: 2, slots: [slot(2, 2), slot(3, 1)] },
        { id: idBase + 3, round: 2, fullRoundText: 'Final', winnerId: null, slots: [from(idBase + 1, 1), from(idBase + 2, 1)] },
    ];
    if (withThirdPlace) sets.push({ id: idBase + 4, round: 3, fullRoundText: '3rd Place Tiebreak', winnerId: null, slots: [from(idBase + 2, 2), from(idBase + 1, 2)] });
    return sets;
}

// A real pool that hasn't started (empty slots), where only the top 8 progress, with three guesses
// at what start.gg's GraphQL returns for it: every preview set, no bye sets, or no byes and no
// sets past the progression cut.
const unstarted = JSON.parse(readFileSync(new URL('./fixtures/unstarted-progressing-pool.json', import.meta.url))).sets;
const unstartedVariants = {
    all: unstarted,
    noByes: unstarted.filter(s => !s.bye),
    noByesNoUnreachable: unstarted.filter(s => !s.bye && !s.unreachable),
};
// A later-phase pool whose losers bracket starts with players from phase 1, seeded but not played
const laterPhase = JSON.parse(readFileSync(new URL('./fixtures/later-phase-pool.json', import.meta.url)));
const phaseGroupOf = { 1001: 2001, 1002: 2002, 1003: 2003, 1004: 2004, 1006: 2008, 1007: 2009, 1008: 2010 };
// Phase 1005 has three pools, which the app fetches as one phase
const poolsOf = { 1005: [2005, 2006, 2007] };
// Phases are double elimination unless listed here. 1008's sets are never asked for: the type is refused first.
const bracketTypeOf = { 1006: 'SINGLE_ELIMINATION', 1007: 'SINGLE_ELIMINATION', 1008: 'ROUND_ROBIN' };
const setsOf = { 2001: poolSets(100), 2002: poolSets(200), 2003: unstartedVariants.noByes, 2004: laterPhase.sets, 2005: poolSets(500), 2006: poolSets(600), 2007: poolSets(700),
    2008: singleElimSets(800, true), 2009: singleElimSets(900, false), 2010: singleElimSets(1000, false) };

// The event's landing page: the top 8 of a 60-entrant event, with start.gg's tied placements (5th, 5th, 7th, 7th).
// Alpha has a sponsor and Bravo an avatar; everyone else gets a colored initial.
const phaseNames = { 1001: 'Pools', 1002: 'Top 4', 1003: 'Unstarted Pool', 1004: 'Later Phase', 1005: 'Three Pools', 1006: 'Single Elim', 1007: 'Single Elim, No 3rd Place', 1008: 'Round Robin' };
const phaseStateOf = { 1003: 'CREATED', 1004: 'ACTIVE' };
const svg = (width, height, color) => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="${width}" height="${height}" fill="${color}"/></svg>`)}`;
const placements = [1, 2, 3, 4, 5, 7];
const numEntrants = 60;
const videogameId = 7;
// Each entrant's sets as start.gg lists them, newest first: [winner's entrant id, displayScore].
// Bravo lost to Alpha twice. Charlie and Players 5 to 8 lost to entrants outside the top 8, whose names
// are only in the text. Delta was disqualified against an outsider (no name anywhere), then against Charlie.
// Player 5 has a set still being played, and Player 8 a name with a dash in it.
const setsOfEntrant = {
    1: [[1, 'SPN | Alpha 3 - Bravo 2'], [1, 'Bravo 1 - SPN | Alpha 3'], [1, 'DQ']],
    2: [[1, 'SPN | Alpha 3 - Bravo 2'], [2, 'Bravo 3 - Charlie 0'], [1, 'Bravo 1 - SPN | Alpha 3'], [2, 'Player 9 0 - Bravo 2']],
    3: [[2, 'Bravo 3 - Charlie 0'], [3, 'DQ'], [3, 'Charlie 3 - Player 5 1'], [30, 'Charlie 1 - XYZ | Player 30 2'], [3, 'Charlie 2 - Player 40 0']],
    4: [[3, 'DQ'], [4, 'Delta 2 - Player 6 0'], [41, 'DQ'], [4, 'Player 50 0 - Delta 2']],
    5: [[null, null], [3, 'Charlie 3 - Player 5 1'], [5, 'Player 5 2 - Player 7 1'], [31, 'A - B | Player 31 2 - Player 5 0']],
    6: [[4, 'Delta 2 - Player 6 0'], [6, 'Player 6 2 - Player 8 - Jr 0'], [32, 'Player 6 1 - Player 32 2']],
    7: [[5, 'Player 5 2 - Player 7 1'], [33, 'Player 33 2 - Player 7 0']],
    8: [[6, 'Player 6 2 - Player 8 - Jr 0'], [34, 'Player 8 - Jr 0 - Player 34 2']],
};
const lostToShown = ['', 'Alpha ×2', 'Player 30, Bravo', 'DQ, Charlie', 'Player 31, Charlie', 'Player 32, Delta', 'Player 33, Player 5', 'Player 34, Player 6'];
// Alpha has all three socials and Bravo only Discord; Charlie has no account, and Delta's has an empty
// username and a ranking without a title, which must not show. Lucky Rank and SSBMRank (in any case) are
// series with a built-in logo; the others show the trophy.
const socialsOf = {
    1: [{ type: 'DISCORD', externalUsername: 'alpha.gg', url: null }, { type: 'TWITCH', externalUsername: 'AlphaTV', url: 'https://twitch.tv/AlphaTV' }, { type: 'TWITTER', externalUsername: 'AlphaSSB', url: 'https://twitter.com/AlphaSSB' }],
    2: [{ type: 'DISCORD', externalUsername: 'bravo#1234', url: null }],
    4: [{ type: 'TWITTER', externalUsername: '', url: null }],
    5: [{ type: 'TWITTER', externalUsername: 'player five', url: null }],
};
const rankingsOf = {
    1: [{ rank: 2, title: 'TestRank: 2025' }, { rank: 1, title: 'Lucky Rank: Active Season' }, { rank: 2, title: 'Test New Markdown: A Rather Long Regional Ranking Name 2025' }],
    2: [{ rank: 23, title: 'SSBMRANK: 2025' }],
    4: [{ rank: null, title: 'TestRank: 2025' }, { rank: 5, title: null }],
    5: [{ rank: 7, title: 'Plain Rank: 2026' }],
    6: null,
};
const socialsShown = [['X: AlphaSSB|https://twitter.com/AlphaSSB', 'Twitch: AlphaTV|https://twitch.tv/AlphaTV', 'Discord: alpha.gg, copy|'], ['Discord: bravo#1234, copy|'], [], [], ['X: player five|https://x.com/player%20five'], [], [], []];
const rankingsShown = [['2', '1', '2'], ['23'], [], [], ['7'], [], [], []];
// Each ranking's logo as "alt text, drawn size, file", or the trophy
const rankIconsShown = [['trophy', 'Lucky Rank: Active Season 16x16 lucky-rank.webp', 'trophy'], ['SSBMRANK: 2025 16x16 ssbmrank.webp'], [], [], ['trophy'], [], [], []];
const standingNames = ['SPN | Alpha', 'Bravo', 'Charlie', 'Delta', 'Player 5', 'Player 6', 'Player 7', 'Player 8 - Jr'];
// The top 8 as start.gg would answer the query: sets, socials and rankings only when they are asked for
const standingsPage = query => ({
    nodes: standingNames.map((name, i) => {
        const id = i + 1;
        const user = i == 2 ? null : { images: i == 1 ? [{ url: svg(40, 40, '#2a7'), type: 'profile', width: 40, height: 40 }] : [] };
        if (user && query.includes('authorizations(types: [TWITTER, TWITCH, DISCORD])')) user.authorizations = socialsOf[id] ?? [];
        const participant = { id: 100 + i, user };
        if (query.includes(`rankings(limit: 3, videogameId: ${videogameId})`)) participant.player = { rankings: id in rankingsOf ? rankingsOf[id] : [] };
        const entrant = { id, name, participants: [participant] };
        if (query.includes('paginatedSets(')) entrant.paginatedSets = { nodes: setsOfEntrant[id].map(([winnerId, displayScore], k, all) =>
            ({ winnerId, displayScore, completedAt: winnerId ? 1794000000 + (all.length - k) * 600 : null })) };
        return { placement: placements.findLast(p => p <= id), entrant };
    })
});
const overview = query => ({
    id: 10, name: 'Test Event', slug: 'tournament/test-tourney/event/test-event', startAt: 1794000000, state: 'COMPLETED', numEntrants, type: 1,
    videogame: { name: 'Test Game', images: [{ url: svg(96, 128, '#345'), type: 'primary' }] },
    phases: Object.entries(phaseNames).map(([id, name]) => {
        const groupIds = poolsOf[id] ?? [phaseGroupOf[id]];
        const phase = { id: Number(id), name, bracketType: bracketTypeOf[id] ?? 'DOUBLE_ELIMINATION', numSeeds: entrants.length * groupIds.length, groupCount: groupIds.length, state: phaseStateOf[id] ?? 'COMPLETED' };
        return phase;
    }),
    standings: standingsPage(query),
    prizingInfo: { enablePrizing: true, markdown: 'Paid out after top 8.', payoutType: 'percentage', payoutTotal: null, prizing: [{ id: 0, placement: 1, percent: 60 }, { id: 1, placement: 2, percent: 30 }, { id: 2, placement: 3, percent: 10 }] },
    rulesMarkdown: 'Best of 3 until top 8, then best of 5.\n\nBring your own controller.', matchRulesMarkdown: null,
});

function kindOf(query) {
    if (query.includes('tournament(slug')) return 'tournament';
    if (query.includes('entrants(query')) return 'entrants';
    if (query.includes('event(slug') && query.includes('phases')) return 'overview';
    if (query.includes('phase(id') && query.includes('slots')) return 'phaseSets';
    if (query.includes('phase(id')) return 'phase';
    if (query.includes('phaseGroup(id')) return 'sets';
    if (query.includes('set(id')) return 'setScores';
    return 'other';
}

// A set as start.gg would answer the query: displayScore ("Alpha 2 - Delta 0", or "DQ") when it's
// asked for, and the slots' standing only when that is asked for
function asQueried(set, query) {
    const scores = set.slots.map(slot => slot.standing?.stats?.score?.value);
    if (query.includes('displayScore')) {
        set.displayScore = scores.some(v => v == null) ? null
            : scores.includes(-1) ? 'DQ'
            : set.slots.map((slot, i) => `${slot.entrant.name} ${scores[i]}`).join(' - ');
    }
    if (!query.includes('standing')) for (const slot of set.slots) delete slot.standing;
    return set;
}
const allSets = () => Object.values(setsOf).flat();

function answer(query) {
    switch (kindOf(query)) {
        case 'tournament':
            return { data: { tournament: {
                images: [], rules: null, id: 1, name: 'Test Tourney', slug: 'tournament/test-tourney', venueAddress: null,
                startAt: 1794000000, primaryContact: null, primaryContactType: null,
                events: [{ name: 'Test Event', slug: 'tournament/test-tourney/event/test-event', numEntrants: entrants.length,
                    startAt: 1794000000, type: 1, videogame: { id: videogameId, name: 'Test Game', images: [] }, standings: { nodes: [] } }]
            } } };
        case 'entrants':
            return { data: { event: { id: 10, name: 'Test Event', phases: Object.entries(phaseNames).map(([id, name]) => ({ id: Number(id), name })),
                entrants: { nodes: structuredClone(entrants) } } } };
        case 'overview':
            return { data: { event: overview(query) } };
        case 'phase': {
            const phaseId = Number(query.match(/phase\(id: (\d+)\)/)[1]);
            const groupIds = poolsOf[phaseId] ?? [phaseGroupOf[phaseId]];
            const total = groupIds.reduce((n, id) => n + setsOf[id].length, 0);
            return { data: { phase: { id: phaseId, bracketType: bracketTypeOf[phaseId] ?? 'DOUBLE_ELIMINATION', sets: { pageInfo: { total } }, phaseGroups: { pageInfo: { total: groupIds.length }, nodes: groupIds.map((id, i) =>
                ({ id, displayIdentifier: String.fromCharCode(65 + i), sets: { pageInfo: { total: setsOf[id].length } } })) } } } };
        }
        case 'phaseSets': {
            // start.gg sorts a phase's sets by round across all its pools
            const phaseId = Number(query.match(/phase\(id: (\d+)\)/)[1]);
            const page = Number(query.match(/page: (\d+)/)[1]);
            const perPage = Number(query.match(/perPage: (\d+)/)[1]);
            const all = (poolsOf[phaseId] ?? [phaseGroupOf[phaseId]]).flatMap(id => structuredClone(setsOf[id]).map(({ bye, unreachable, ...set }) => ({ ...set, phaseGroup: { id } })));
            const order = r => r < 0 ? r : 1000 + r;
            const nodes = all.map((set, i) => ({ set, i })).sort((a, b) => order(a.set.round) - order(b.set.round) || a.i - b.i).map(x => x.set);
            return { data: { phase: { sets: { nodes: nodes.slice((page - 1) * perPage, page * perPage).map(set => asQueried(set, query)) } } } };
        }
        case 'sets': {
            const groupId = Number(query.match(/phaseGroup\(id: (\d+)\)/)[1]);
            const page = Number(query.match(/page: (\d+)/)[1]);
            const perPage = Number(query.match(/perPage: (\d+)/)[1]);
            const nodes = structuredClone(setsOf[groupId]).slice((page - 1) * perPage, page * perPage)
                .map(({ bye, unreachable, ...set }) => asQueried(set, query));
            return { data: { phaseGroup: { sets: { nodes } } } };
        }
        case 'setScores': {
            // Aliased lookups: s0: set(id: "101") { slots { standing { ... } } }
            const data = {};
            for (const [, alias, id] of query.matchAll(/(\w+): set\(id: "?([^")]+)"?\)/g)) {
                const set = allSets().find(set => String(set.id) === id);
                data[alias] = set ? { slots: set.slots.map(slot => ({ standing: structuredClone(slot.standing ?? null) })) } : null;
            }
            return { data };
        }
        default:
            return { errors: [{ message: 'unknown query' }] };
    }
}

// The query text with its GraphQL variables written in, so the fake can read slugs, ids and pages
// the same way whether the app sends variables (this branch) or writes them into the text (older builds)
function withVariables(query, variables) {
    if (!variables) return query;
    return query.replace(/^\s*query\s*\w*\s*\([^)]*\)/, 'query')
        .replace(/\$(\w+)/g, (all, name) => name in variables ? JSON.stringify(variables[name]) : all);
}

// Opens a page against the fake start.gg. `respond(query, n)` may return { status, body } to override
// the n-th request (counting from 1); otherwise the normal answer goes back. `fonts` lets the icon and
// text fonts load, for screenshots that look like the real page. `loggedIn: false` opens it as a visitor.
async function openPage(browser, respond = () => null, contextOptions = {}, { fonts = false, loggedIn = true } = {}) {
    const context = await browser.newContext(contextOptions);
    // Older builds keep the login in localStorage; this branch asks the server
    if (loggedIn) await context.addInitScript(() => {
        localStorage.setItem('oauth_access_token', 'test-token');
        localStorage.setItem('oauth_refresh_token', 'test-refresh');
        localStorage.setItem('oauth_token_expiry', String(Date.now() + 7 * 86400000));
    });
    await context.route(/\/api\/auth\/session$/, route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ loggedIn }) }));
    const page = await context.newPage();
    const log = [];
    let pending = 0;
    let lastActivity = Date.now();
    if (!fonts) await page.route(/fonts\.(googleapis|gstatic)\.com/, route => route.abort());
    // start.gg directly (before the shared cache) or through the site's /api/gql
    await page.route(/api\.start\.gg\/gql\/alpha|\/api\/gql$/, async route => {
        if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
        pending++;
        const { query: text, variables } = route.request().postDataJSON();
        const query = withVariables(text, variables);
        const n = log.length + 1;
        const override = respond(query, n);
        log.push({ n, at: Date.now(), kind: kindOf(query), status: override?.status ?? 200, query });
        await new Promise(r => setTimeout(r, 50));
        await route.fulfill({ status: override?.status ?? 200, headers: { ...cors, 'content-type': 'application/json' },
            body: JSON.stringify(override?.body ?? answer(query)) });
        pending--;
        lastActivity = Date.now();
    });
    const quiet = async (ms = 1500, timeout = 120000) => {
        const start = Date.now();
        while (Date.now() - start < timeout) {
            if (pending === 0 && Date.now() - lastActivity > ms) return true;
            await page.waitForTimeout(200);
        }
        return false;
    };
    return { context, page, log, quiet };
}

const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, OPTIONS' };
const count = (log, from = 0) => {
    const out = { total: 0 };
    for (const r of log.slice(from)) { out.total++; out[r.kind] = (out[r.kind] ?? 0) + 1; }
    return out;
};
const snackText = page => page.locator('app-snack-bar').innerText().catch(() => '');
const spinnerShown = page => page.locator('app-snack-bar mat-spinner').isVisible().catch(() => false);
const tags = page => page.locator('.set-tag').allInnerTexts().catch(() => []);

// What each standing card on the landing page shows
const standingsShown = page => page.evaluate(() => [...document.querySelectorAll('.standing')].map(card => {
    const text = selector => (card.querySelector(selector)?.innerText ?? '').replace(/\s+/g, ' ').trim();
    return {
        name: text('.standing-placement') + ' ' + text('.standing-name'),
        lostTo: text('.standing-lost-to'),
        socials: [...card.querySelectorAll('.standing-social')].map(el => `${el.getAttribute('title') ?? el.getAttribute('aria-label')}|${el.getAttribute('href') ?? ''}`),
        rankings: [...card.querySelectorAll('.standing-ranking')].map(el => el.textContent.trim()),
        rankIconsDrawn: [...card.querySelectorAll('.standing-ranking svg')].every(icon => icon.getBoundingClientRect().width >= 12 && icon.querySelector('path').getBBox().width > 15),
        rankIcons: [...card.querySelectorAll('.standing-ranking')].map(el => {
            const image = el.querySelector('img');
            if (!image) return el.querySelector('svg path') ? 'trophy' : 'nothing';
            const box = image.getBoundingClientRect();
            return `${image.alt} ${Math.round(box.width)}x${Math.round(box.height)} ${image.complete && image.naturalWidth ? image.currentSrc.split('/').pop() : 'not loaded'}`;
        }),
        socialsRow: !!card.querySelector('.standing-socials'),
        rankingsRow: !!card.querySelector('.standing-rankings'),
        titles: [...card.querySelectorAll('.standing-name, .standing-lost-to')].map(el => el.getAttribute('title')),
        discordText: [...card.querySelectorAll('button.standing-social')].map(el => el.innerText.trim() + el.getBoundingClientRect().width).join(),
        iconsDrawn: [...card.querySelectorAll('.standing-social svg')].every(icon => icon.getBoundingClientRect().width >= 12 && icon.querySelector('path').getBBox().width > 15),
    };
}));
// Where each standing card is and how its lines sit: the grid order, the card sizes, the name's place in
// its card, whether the rankings are on a line below the socials, and whether a long line is cut short
const standingsLayout = page => page.evaluate(() => [...document.querySelectorAll('.standing')].map(card => {
    const box = card.getBoundingClientRect();
    const rect = selector => card.querySelector(selector)?.getBoundingClientRect();
    const round = value => Math.round(value * 10) / 10;
    // The lines themselves: on a phone each icon's tap area reaches 6 px past its line
    const name = rect('.standing-name'), social = rect('.standing-socials'), ranking = rect('.standing-rankings');
    const lostTo = card.querySelector('.standing-lost-to');
    const placement = card.querySelector('.standing-placement'), avatar = rect('.standing-profile-image');
    // How far below the card's middle each part's middle is
    const offCenter = r => r && round((r.top + r.bottom) / 2 - (box.top + box.bottom) / 2);
    return {
        centers: [offCenter(placement?.getBoundingClientRect()), offCenter(avatar), offCenter(rect('.standing-info'))],
        placementSize: placement && parseFloat(getComputedStyle(placement).fontSize), avatarSize: avatar && [round(avatar.width), round(avatar.height)],
        infoLeft: round(rect('.standing-info').left - box.left), lineLefts: [...card.querySelectorAll('.standing-info > *')].map(el => round(el.getBoundingClientRect().left - box.left)),
        left: round(box.left), top: round(box.top), width: round(box.width), height: round(box.height),
        nameLeft: name && round(name.left - box.left), nameTop: name && round(name.top - box.top),
        rankingsBelowSocials: social && ranking ? ranking.top >= social.bottom && Math.abs(ranking.left - social.left) < 1 : null,
        inside: [...card.querySelectorAll('.standing-info *')].every(el => el.getBoundingClientRect().bottom <= box.bottom && el.getBoundingClientRect().right <= box.right + 0.5),
        lostToLines: lostTo ? Math.round(lostTo.getBoundingClientRect().height / parseFloat(getComputedStyle(lostTo).lineHeight)) : 0,
        lostToCut: !!lostTo && lostTo.scrollWidth > lostTo.clientWidth,
    };
}));
const within = (values, px = 1) => Math.max(...values) - Math.min(...values) <= px;
// Every card the same size, with the name starting at the same place across in each and nothing spilling out of a card
const sameCards = cards => cards.length === 8 && within(cards.map(c => c.height)) && within(cards.map(c => c.width)) && within(cards.map(c => c.nameLeft))
    && cards.every(c => c.inside && c.lostToLines <= 1);
// The placement, the picture and the text block each sit in the middle of the card's height, within 2 px; the placement
// is 24 px and the picture 52 px; and the lines of text start at the same place across
const centeredCards = cards => cards.length === 8 && cards.every(c => c.centers.every(off => off !== undefined && Math.abs(off) <= 2)
    && c.placementSize === 24 && c.avatarSize[0] === 52 && c.avatarSize[1] === 52 && within(c.lineLefts.map(left => left - c.infoLeft), 0.5));
// The rankings sit on their own line under the socials in each card that has both (Alpha, Bravo and Player 5)
const rankingsOwnLine = cards => JSON.stringify(cards.map(c => c.rankingsBelowSocials)) === JSON.stringify([true, true, null, null, true, null, null, null]);
// Waits until every ranking logo has loaded
const rankImagesSettled = page => page.waitForFunction(() => [...document.querySelectorAll('.standing-ranking img')].every(image => image.complete && image.naturalWidth), null, { timeout: 5000 }).catch(() => { });
// Which of the landing page's optional parts an overview query asks for
const detailsAsked = query => [['pools', 'phaseGroups('], ['sets', 'paginatedSets('], ['socials', 'authorizations('], ['rankings', 'rankings(']].filter(([, text]) => query.includes(text)).map(([name]) => name).join(' ');
const overviewQueries = log => log.filter(r => r.kind === 'overview').map(r => r.query);
const tooComplex = { body: { errors: [{ message: 'Your query complexity is too high. A maximum of 1000 objects may be returned by each request. (actual: 1400)' }] } };

// --screenshots <dir>: only take e2e/screenshots.mjs's screenshots, for e2e/visual-diff.mjs
const screenshotsAt = process.argv.indexOf('--screenshots');
if (screenshotsAt > 0) {
    const { takeScreenshots } = await import('./screenshots.mjs');
    await takeScreenshots({ appUrl, eventPath, openPage, outDir: process.argv[screenshotsAt + 1] });
    process.exit(0);
}

const report = { app: appUrl, checks: [] };
const check = (name, ok, detail) => report.checks.push({ name, ok: !!ok, detail });
const browser = await chromium.launch();

try {
    // 1. Load a bracket, switch phase, switch back
    {
        const { context, page, log, quiet } = await openPage(browser);
        await page.goto(appUrl + eventPath + '/1001');
        await quiet();
        report.firstLoad = count(log);
        check('first load draws the bracket', (await tags(page)).includes('Alpha'), await tags(page));
        check('a small pool takes one sets request (no sample first)', report.firstLoad.sets === 1, report.firstLoad);

        let mark = log.length;
        await page.locator('button:has(mat-icon[fonticon="arrow_forward"])').click();
        await quiet();
        report.phaseSwitch = count(log, mark);
        check('phase switch draws the second phase', (await page.locator('text=Top 4').count()) > 0 && (await tags(page)).includes('Alpha'), await tags(page));
        check('phase switch skips tournament and entrants', !report.phaseSwitch.tournament && !report.phaseSwitch.entrants, report.phaseSwitch);

        mark = log.length;
        await page.locator('button:has(mat-icon[fonticon="arrow_back"])').click();
        await quiet();
        report.phaseSwitchBack = count(log, mark);
        await context.close();
    }

    // 2. start.gg rate-limits the first 2 requests, then recovers
    {
        const limited = { status: 429, body: { success: false, message: 'Rate limit exceeded - api-token' } };
        const { context, page, log, quiet } = await openPage(browser, (q, n) => n <= 2 ? limited : null);
        const start = Date.now();
        await page.goto(appUrl + eventPath + '/1001');
        let sawNotice = false;
        while (Date.now() - start < 60000) {
            if ((await snackText(page)).includes('busy')) sawNotice = true;
            if ((await tags(page)).includes('Alpha')) break;
            await page.waitForTimeout(250);
        }
        await quiet();
        report.rateLimitRecovery = { requests: count(log), seconds: Math.round((Date.now() - start) / 1000) };
        check('recovers from a short rate limit and draws the bracket', (await tags(page)).includes('Alpha'));
        check('tells the user it is waiting on start.gg', sawNotice);
        await context.close();
    }

    // 3. start.gg rate-limits everything: watch for 90 s
    {
        const limited = { status: 429, body: { success: false, message: 'Rate limit exceeded - api-token' } };
        const { context, page, log } = await openPage(browser, () => limited);
        await page.goto(appUrl + eventPath + '/1001');
        let gaveUpAt = null;
        const start = Date.now();
        while (Date.now() - start < 90000) {
            if (!gaveUpAt && (await snackText(page)).includes('rate limiting')) gaveUpAt = Math.round((Date.now() - start) / 1000);
            await page.waitForTimeout(500);
        }
        const perMinute = log.filter(r => r.at - log[0].at < 60000).length;
        report.rateLimitStorm = { requestsIn90s: log.length, requestsInFirstMinute: perMinute, gaveUpAfterSeconds: gaveUpAt, spinnerStillShown: await spinnerShown(page) };
        check('a lasting rate limit costs only a few retries', log.length <= 10, log.length);
        check('a lasting rate limit ends in a message, not a spinner', gaveUpAt !== null && !(await spinnerShown(page)), await snackText(page));
        await context.close();
    }

    // 4. A GraphQL error (like the 1000-object cap) on the phase query
    {
        const tooBig = { status: 200, body: { success: false, errors: [{ message: 'Query complexity too high. A maximum of 1000 objects may be returned by each request. (actual: 1235)' }] } };
        const { context, page, quiet } = await openPage(browser, q => kindOf(q) === 'phase' ? tooBig : null);
        await page.goto(appUrl + eventPath + '/1001');
        await quiet();
        await page.waitForTimeout(1000);
        const text = await snackText(page);
        report.graphqlError = { snackbar: text, spinnerStillShown: await spinnerShown(page) };
        check('a GraphQL error shows a message and stops the spinner', text.includes('complexity') && !(await spinnerShown(page)), text);
        await context.close();
    }

    // 5. The tournament page alone
    {
        const { context, page, log, quiet } = await openPage(browser);
        await page.goto(appUrl + '/tournament/test-tourney');
        await quiet();
        report.tournamentPage = count(log);
        await context.close();
    }

    // 6. Phone: tapping the Event Link box opens the keyboard, which shrinks the page height.
    //    The sidebar must stay open.
    {
        const { context, page } = await openPage(browser);
        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto(appUrl + '/');
        await page.locator('mat-toolbar button:has(mat-icon:text("menu"))').click();
        await page.waitForTimeout(500);
        const openBefore = await page.locator('mat-sidenav.mat-drawer-opened').count() > 0;
        await page.locator('mat-sidenav input').click();
        await page.setViewportSize({ width: 390, height: 500 });
        await page.waitForTimeout(800);
        const openAfter = await page.locator('mat-sidenav.mat-drawer-opened').count() > 0;
        report.mobileKeyboard = { openBefore, openAfter };
        check('phone: opening the keyboard keeps the sidebar open', openBefore && openAfter, report.mobileKeyboard);
        await context.close();
    }

    // 7. A pool that hasn't started yet, for each guess at the data
    report.unstartedPool = {};
    for (const [variant, sets] of Object.entries(unstartedVariants)) {
        setsOf[2003] = sets;
        const { context, page, quiet } = await openPage(browser);
        const errors = [];
        page.on('pageerror', e => errors.push(String(e.message).slice(0, 200)));
        // Font requests are blocked on purpose, so their load errors don't count
        page.on('console', m => { if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) errors.push(m.text().slice(0, 200)); });
        await page.goto(appUrl + eventPath + '/1003');
        await quiet();
        await page.waitForTimeout(1000);
        const drawn = await page.locator('.set').count();
        await page.screenshot({ path: `e2e-out/unstarted-${variant}.png`, fullPage: true }).catch(() => { });
        const text = await snackText(page);
        report.unstartedPool[variant] = { sets: sets.length, drawn, snackbar: text, errors: errors.slice(0, 5) };
        check(`unstarted pool (${variant}) draws`, drawn > 0 && !errors.length && !(await spinnerShown(page)), report.unstartedPool[variant]);
        await context.close();
    }

    // 8. Phones open in the phone layout: menu button shown, sidebar closed
    report.phoneStart = {};
    const safari = await webkit.launch();
    try {
        for (const [name, engine, device] of [['Pixel 7', browser, devices['Pixel 7']], ['iPhone 13', safari, devices['iPhone 13']]]) {
            const { context, page } = await openPage(engine, () => null, device);
            await page.goto(appUrl + eventPath + '/1001');
            await page.waitForTimeout(1500);
            const menuShown = await page.locator('mat-toolbar button:has(mat-icon:text("menu"))').isVisible();
            const sidebarOpen = await page.locator('mat-sidenav.mat-drawer-opened').count() > 0;
            report.phoneStart[name] = { menuShown, sidebarOpen };
            check(`${name}: opens in the phone layout`, menuShown && !sidebarOpen, report.phoneStart[name]);
            await context.close();
        }
    } finally {
        await safari.close();
    }

    // 9. Show Projected on a later phase: every projected set matches the hand-worked answer
    {
        const { context, page, quiet } = await openPage(browser);
        await context.addInitScript(() => localStorage.setItem('showProjected', 'true'));
        const errors = [];
        page.on('pageerror', e => errors.push(String(e.message).slice(0, 200)));
        await page.goto(appUrl + eventPath + '/1004');
        await quiet();
        await page.waitForTimeout(1000);
        const pairs = await page.locator('.set').evaluateAll(sets => sets.map(set =>
            [...set.querySelectorAll('.set-tag')].map(tag => tag.textContent.replace(/\u200e/g, '').trim()).filter(Boolean)));
        const key = pair => [...pair].sort().join(' vs ');
        const got = pairs.filter(p => p.length == 2).map(key).sort();
        const want = laterPhase.expectedProjectedPairs.map(key).sort();
        const missing = want.filter(w => { const i = got.indexOf(w); if (i == -1) return true; got.splice(i, 1); return false; });
        report.laterPhaseProjected = { sets: pairs.length, missing, extra: got, errors };
        check('later phase: projected sets match', !missing.length && !errors.length, report.laterPhaseProjected);
        await page.screenshot({ path: 'e2e-out/later-phase-projected.png' }).catch(() => { });
        await context.close();
    }

    // 10. Phone: searching an entrant scrolls the bracket to them, even as the keyboard closes
    report.phoneSearch = {};
    const safari2 = await webkit.launch();
    try {
        for (const [name, engine, device] of [['Pixel 7', browser, devices['Pixel 7']], ['iPhone 13', safari2, devices['iPhone 13']]]) {
            const { context, page, quiet } = await openPage(engine, () => null, device);
            const errors = [];
            page.on('pageerror', e => errors.push(String(e.message).slice(0, 200)));
            try {
                await page.goto(appUrl + eventPath + '/1004');
                await quiet();
                await page.waitForTimeout(1000);
                // The entrant whose first slot is farthest from the starting view
                const target = await page.evaluate(() => {
                    const seen = new Set();
                    let best = null;
                    for (const slot of document.querySelectorAll('[entrantid]')) {
                        const id = slot.getAttribute('entrantid');
                        if (!id || seen.has(id)) continue;
                        seen.add(id);
                        const r = slot.getBoundingClientRect();
                        const tag = slot.querySelector('.set-tag')?.textContent.replace(/\u200e/g, '').trim();
                        if (tag && (!best || r.top + r.left > best.far)) best = { id, tag, far: r.top + r.left };
                    }
                    return best;
                });
                const inView = () => page.evaluate(id => {
                    const box = document.querySelector('mat-sidenav-content').getBoundingClientRect();
                    const r = document.querySelector(`[entrantid="${id}"]`).getBoundingClientRect();
                    return r.top >= box.top && r.bottom <= box.bottom && r.left >= box.left && r.right <= box.right;
                }, target.id);
                const before = await inView();
                // iOS zooms in on a tapped text box under 16px unless the viewport has maximum-scale=1
                const viewport = await page.evaluate(() => document.querySelector('meta[name=viewport]').content);
                const size = page.viewportSize();
                await page.locator('.search-entrant-form input').tap();
                await page.setViewportSize({ width: size.width, height: Math.round(size.height * 0.55) }); // keyboard opens
                await page.locator('.search-entrant-form input').fill(target.tag);
                await page.waitForTimeout(400);
                await page.locator('mat-option', { hasText: target.tag }).first().tap();
                await page.waitForTimeout(100);
                // The keyboard stays open while the search box has focus
                const keyboardClosed = await page.evaluate(() => !document.activeElement?.matches('.search-entrant-form input'));
                await page.setViewportSize(size); // keyboard closes
                await page.waitForTimeout(2000);
                const after = await inView();
                report.phoneSearch[name] = { target: target.tag, before, keyboardClosed, after, viewport, errors };
                check(`${name}: searching an entrant closes the keyboard and scrolls to them`, !before && keyboardClosed && after && !errors.length, report.phoneSearch[name]);
                check(`${name}: maximum-scale=1 on iOS only, so tapping a text box doesn't zoom and Android keeps pinch zoom`, viewport.includes('maximum-scale=1') === (name === 'iPhone 13'), viewport);
                await page.screenshot({ path: `e2e-out/phone-search-${name.replace(/ /g, '-')}.png` }).catch(() => { });
            } catch (e) {
                report.phoneSearch[name] = { crashed: String(e.message).slice(0, 300) };
                check(`${name}: searching an entrant scrolls to them`, false, report.phoneSearch[name]);
            }
            await context.close();
        }
    } finally {
        await safari2.close();
    }

    // 11. Doubles: start.gg refuses pages that pass the 1000-object cap. Here a set costs 50 objects and
    //     the refusal gives the count, so one retry fits; entrant refusals give no count (more than 50),
    //     so those pages halve
    {
        const normal = await openPage(browser);
        await normal.page.goto(appUrl + eventPath + '/1001');
        await normal.quiet();
        await normal.page.waitForTimeout(1000);
        const want = (await tags(normal.page)).length;
        await normal.context.close();

        const tooBig = actual => ({ status: 200, body: { success: false, errors: [{ message: `Your query complexity is too high. A maximum of 1000 objects may be returned by each request.${actual ? ` (actual: ${actual})` : ''}` }] } });
        const perPage = q => Number(q.match(/perPage: (\d+)/)?.[1] ?? 0);
        const { context, page, log, quiet } = await openPage(browser, q =>
            kindOf(q) === 'sets' && perPage(q) * 50 > 1000 ? tooBig(perPage(q) * 50)
                : kindOf(q) === 'entrants' && perPage(q) > 50 ? tooBig(null) : null);
        const errors = [];
        page.on('pageerror', e => errors.push(String(e.message).slice(0, 200)));
        await page.goto(appUrl + eventPath + '/1001');
        await quiet();
        await page.waitForTimeout(1000);
        const got = (await tags(page)).length;
        const text = await snackText(page);
        report.doublesComplexity = { want, got, snackbar: text, requests: count(log), errors };
        check('doubles: oversized pages are retried smaller (sets in one retry) and the bracket draws',
            want > 0 && got === want && report.doublesComplexity.requests.sets === 2 && !text.includes('complexity') && !errors.length, report.doublesComplexity);
        await context.close();
    }

    // 12. The back-to-top button: hidden at the top, shows at the bottom right after scrolling, takes you back
    report.backToTop = {};
    const safari3 = await webkit.launch();
    try {
        for (const [name, engine, device] of [['Desktop', browser, {}], ['Pixel 7', browser, devices['Pixel 7']], ['iPhone 13', safari3, devices['iPhone 13']]]) {
            const { context, page, quiet } = await openPage(engine, () => null, device);
            try {
                await page.goto(appUrl + eventPath + '/1004');
                await quiet();
                await page.waitForTimeout(1000);
                const button = page.locator('.scroll-to-top-button');
                const hiddenAtTop = !(await button.isVisible());
                await page.evaluate(() => document.querySelector('mat-sidenav-content').scrollTo(0, 600));
                await page.waitForTimeout(500);
                const shownAfterScroll = await button.isVisible();
                const box = await button.boundingBox();
                const view = page.viewportSize();
                const bottomRight = !!box && box.x > view.width / 2 && box.y > view.height / 2;
                if (shownAfterScroll) await button.click();
                await page.waitForTimeout(1500);
                const backAtTop = await page.evaluate(() => document.querySelector('mat-sidenav-content').scrollTop === 0);
                const hiddenAgain = !(await button.isVisible());
                report.backToTop[name] = { hiddenAtTop, shownAfterScroll, bottomRight, backAtTop, hiddenAgain };
                check(`${name}: back-to-top button shows after scrolling, sits bottom right, and goes back`, hiddenAtTop && shownAfterScroll && bottomRight && backAtTop && hiddenAgain, report.backToTop[name]);
            } catch (e) {
                report.backToTop[name] = { crashed: String(e.message).slice(0, 300) };
                check(`${name}: back-to-top button shows after scrolling, sits bottom right, and goes back`, false, report.backToTop[name]);
            }
            await context.close();
        }
    } finally {
        await safari3.close();
    }

    // 13. Character picks: matched to sides by entrant, two per side in doubles, and missing ones skipped
    {
        // Each team (entrant) has two players. Picks come shuffled; set 101 has a game where only the
        // bottom side reported, and one pick with no character.
        const icon = (entrantId, n) => ({ images: [{ type: 'stockIcon', url: `https://icons.test/${entrantId}-${n}.png` }] });
        const withGames = body => {
            for (const set of body.data.phaseGroup.sets.nodes) {
                const [a, b] = set.slots.map(slot => slot.entrant.id);
                const pick = (id, n) => ({ entrant: { id }, character: icon(id, n) });
                set.games = [{ winnerId: set.winnerId, stage: { name: 'Stage' }, selections: [pick(b, 1), pick(a, 1), pick(b, 2), pick(a, 2)] }];
                if (set.id === 101) set.games.push({ winnerId: b, stage: null, selections: [pick(b, 1), { entrant: { id: b }, character: null }] });
            }
            return body;
        };
        const { context, page, quiet } = await openPage(browser, q =>
            kindOf(q) === 'sets' && q.includes('phaseGroup(id: 2001)') ? { body: withGames(answer(q)) } : null);
        const errors = [];
        page.on('pageerror', e => errors.push(String(e.message).slice(0, 200)));
        await page.route('https://icons.test/**', route => route.fulfill({ status: 404 }));
        await page.goto(appUrl + eventPath + '/1001');
        await quiet();
        await page.waitForTimeout(1000);
        // In the bracket: each slot's icon belongs to that slot's entrant
        const bracket = await page.locator('.set').evaluateAll(sets => sets.map(set => ({
            ids: [...set.querySelectorAll('[entrantid]')].map(slot => slot.getAttribute('entrantid')),
            icons: [...set.querySelectorAll('img.set-image')].map(img => img.getAttribute('src')),
        })));
        const bracketOk = bracket.length > 0 && bracket.every(set => set.icons.length === 2 && set.icons.every((src, k) => src.includes(`/${set.ids[k]}-`)));
        // In the popup for set 101 (Alpha vs Delta): two icons per side in game 1, only Delta's in game 2
        await page.locator('.set', { hasText: 'Delta' }).filter({ hasText: 'Alpha' }).first().click();
        await page.waitForTimeout(800);
        const games = await page.locator('mat-dialog-content mat-card-content > div').evaluateAll(games => games.map(game =>
            [...game.querySelectorAll('.game-icon')].map(side => [...side.querySelectorAll('img')].map(img => img.getAttribute('src').match(/\/(\d+)-/)[1]))));
        report.characterPicks = { bracket: bracket.slice(0, 3), games, errors };
        const popupOk = JSON.stringify(games) === JSON.stringify([[['1', '1'], ['4', '4']], [[], ['4']]]);
        check('character picks: each side shows its own picks, doubles shows both, missing ones skipped', bracketOk && popupOk && !errors.length, report.characterPicks);
        await page.screenshot({ path: 'e2e-out/character-picks.png' }).catch(() => { });
        await context.close();
    }

    // 14. A phase with three pools: one whole-phase fetch, every pool drawn like a pool fetched alone
    {
        const { context, page, log, quiet } = await openPage(browser, q =>
            kindOf(q) === 'phaseSets' && Number(q.match(/perPage: (\d+)/)[1]) > 7 ? { body: { errors: [{ message: 'Your query complexity is too high.' }] } } : null);
        const errors = [];
        page.on('pageerror', e => errors.push(String(e.message).slice(0, 200)));
        await page.goto(appUrl + eventPath + '/1005');
        await quiet();
        await page.waitForTimeout(1000);
        // Each pool's tags, in drawing order, should match pool 1001 (the same 4-player pool) exactly
        const pools = await page.getByText(/^\s*Pool [A-C]\s*$/).count();
        const drawn = await tags(page);
        const single = await openPage(browser);
        await single.page.goto(appUrl + eventPath + '/1001');
        await single.quiet();
        await single.page.waitForTimeout(1000);
        const one = await tags(single.page);
        await single.context.close();
        const requests = count(log);
        const want = [...one, ...one, ...one];
        report.phaseSets = { requests, drawn: drawn.length, want: want.length, sameOrder: JSON.stringify(drawn) === JSON.stringify(want), pools, errors };
        check('three-pool phase: fetched as one phase (smaller pages after a refusal), every pool drawn the same',
            report.phaseSets.sameOrder && want.length > 0 && pools === 3 && (requests.phaseSets ?? 0) >= 1 && !requests.sets && !errors.length, report.phaseSets);
        await page.screenshot({ path: 'e2e-out/three-pools.png', fullPage: true }).catch(() => { });
        await context.close();
    }

    // 15. Scores come from displayScore; a line the app can't read is looked up separately, and DQ works
    {
        // Set 101 (Alpha 2 - Delta 0) gets text no name matches; set 102 (Bravo beats Charlie) becomes a DQ
        const twist = body => {
            for (const set of body.data.phaseGroup.sets.nodes) {
                if (set.id === 101) set.displayScore = 'Alpha?? 2 - ??? 0';
                if (set.id === 102) set.displayScore = 'DQ';
            }
            return body;
        };
        const { context, page, log, quiet } = await openPage(browser, q =>
            kindOf(q) === 'sets' && q.includes('phaseGroup(id: 2001)') ? { body: twist(answer(q)) } : null);
        const errors = [];
        page.on('pageerror', e => errors.push(String(e.message).slice(0, 200)));
        await page.goto(appUrl + eventPath + '/1001');
        await quiet();
        await page.waitForTimeout(1000);
        const shown = await page.locator('.set').evaluateAll(sets => sets.map(set => {
            const names = [...set.querySelectorAll('.set-tag')].map(tag => tag.textContent.trim());
            const scores = [...set.querySelectorAll('.set-scores .set-row')].map(row => row.textContent.trim());
            return names.map((name, i) => `${name} ${scores[i] ?? ''}`).join(' - ');
        }));
        const want = ['Alpha 2 - Delta 0', 'Bravo 0 - Charlie DQ', 'Alpha 2 - Bravo 0', 'Bravo 2 - Charlie 1', 'Delta 0 - Charlie 2', 'Alpha 3 - Bravo 1'];
        const requests = count(log);
        report.displayScore = { shown, requests, errors };
        check('scores read from displayScore; an unreadable one is looked up once; DQ shows',
            want.every(w => shown.includes(w)) && requests.setScores === 1 && requests.sets === 1 && !errors.length, report.displayScore);
        await context.close();
    }

    // 16. Single elimination: only the winners side is drawn, the 3rd place match comes after the final
    //     with no line from it, and Show Projected fills the final and 3rd place match from the semis.
    //     A round robin phase gets a message instead of a spinner, and double elimination keeps both sides.
    report.singleElim = {};
    const pairsOf = page => page.locator('.set').evaluateAll(sets => sets.map(set =>
        [...set.querySelectorAll('.set-tag')].map(tag => tag.textContent.replace(/\u200e/g, '').trim()).filter(Boolean).join(' vs ')));
    const sidesOf = page => page.locator('#full-round-text-row').count();
    for (const [name, phaseId, rounds, later] of [
        ['with 3rd place', 1006, ['Semi-Final', 'Final', '3rd Place Tiebreak'], ['Alpha vs Bravo', 'Charlie vs Delta']],
        ['without 3rd place', 1007, ['Semi-Final', 'Final'], ['Alpha vs Bravo']],
    ]) {
        for (const projected of [false, true]) {
            const { context, page, quiet } = await openPage(browser);
            if (projected) await context.addInitScript(() => localStorage.setItem('showProjected', 'true'));
            const errors = [];
            page.on('pageerror', e => errors.push(String(e.message).slice(0, 200)));
            await page.goto(appUrl + eventPath + '/' + phaseId);
            await quiet();
            await page.waitForTimeout(1000);
            const got = {
                sides: await sidesOf(page),
                rounds: (await page.locator('.full-round-text').allInnerTexts()).map(t => t.trim()),
                pairs: await pairsOf(page),
                // Lines in the block columns right of the final: none should join it to the 3rd place match
                linesAfterFinal: await page.locator('#set-block-column-container').evaluateAll(cols => cols.slice(4).reduce((n, col) =>
                    n + col.querySelectorAll('.straight-block, .first-block-column-first-row, .first-block-column-second-row').length, 0)),
                spinner: await spinnerShown(page), errors,
            };
            const want = { sides: 1, rounds, pairs: ['Alpha vs Delta', 'Bravo vs Charlie', ...(projected ? later : later.map(() => ''))], linesAfterFinal: 0, spinner: false, errors: [] };
            const key = `${name}${projected ? ', projected' : ''}`;
            report.singleElim[key] = got;
            check(`single elim ${key}: one side, rounds in order, every set drawn, no line into the 3rd place match`, JSON.stringify(got) === JSON.stringify(want), got);
            await page.screenshot({ path: `e2e-out/single-elim-${key.replace(/[^a-z0-9]+/gi, '-')}.png`, fullPage: true }).catch(() => { });
            await context.close();
        }
    }
    {
        const { context, page, quiet } = await openPage(browser);
        await page.goto(appUrl + eventPath + '/1008');
        await quiet();
        await page.waitForTimeout(1000);
        const text = await snackText(page);
        report.roundRobin = { snackbar: text, spinnerStillShown: await spinnerShown(page) };
        check('round robin: a message, not a spinner', text.includes('round robin') && !(await spinnerShown(page)), report.roundRobin);
        await context.close();
    }
    {
        const { context, page, quiet } = await openPage(browser);
        await page.goto(appUrl + eventPath + '/1001');
        await quiet();
        await page.waitForTimeout(1000);
        report.doubleElimSides = { sides: await sidesOf(page), sets: await page.locator('.set').count() };
        check('double elim: still draws both sides and every set', report.doubleElimSides.sides === 2 && report.doubleElimSides.sets === 6, report.doubleElimSides);
        await context.close();
    }
    // 17. The event's landing page: header, standings and phases in two requests; a phase, a pool, the
    //     phase menu and the back link all lead where they say; back and forward work; and every other
    //     way to an event URL (tournament page, sidebar, Event Link box) ends on the landing page.
    {
        const landingPath = '/tournament/test-tourney/event/test-event';
        const texts = (page, selector) => page.locator(selector).allInnerTexts().then(all => all.map(t => t.replace(/\s+/g, ' ').trim()));
        const atLanding = async page => new URL(page.url()).pathname === landingPath && (await texts(page, '.event-title'))[0] === 'Test Event';
        const phaseShown = async page => (await texts(page, '.phase-menu-button'))[0]?.replace(/ ?arrow_drop_down$/, '');
        const { context, page, log, quiet: idle } = await openPage(browser, () => null, { colorScheme: 'dark' }, { fonts: true });
        // A click or a step through the history starts its requests a moment later
        const quiet = async ms => { await page.waitForTimeout(400); return idle(ms); };
        const errors = [];
        page.on('pageerror', e => errors.push(String(e.message).slice(0, 200)));
        try {
            await page.setViewportSize({ width: 1280, height: 1500 });
            await page.goto(appUrl + landingPath);
            await quiet();
            await rankImagesSettled(page);
            const requests = count(log);
            const landing = {
                requests,
                title: (await texts(page, '.event-title'))[0],
                header: (await texts(page, '.event-header .meta-row'))[0],
                standings: await standingsShown(page),
                showMore: await page.locator('.show-more').count() + await page.getByText('Show more').count(),
                detailsAsked: overviewQueries(log).map(detailsAsked),
                phases: await texts(page, '.phase-name'),
                phaseDetails: (await texts(page, '.phase-details'))[4],
                poolLinks: await page.locator('.pool-chip, .pool-list, .phase-card a[href*="/1005/"]').count(),
                prizing: (await texts(page, '.payout')).join(', '),
            };
            report.eventLanding = { landing };
            check('event landing: header, top 8 and every phase, in two requests',
                requests.total === 2 && requests.tournament === 1 && requests.overview === 1 && landing.title === 'Test Event'
                && landing.header.includes('Completed') && landing.header.includes('60 entrants') && landing.header.includes('Test Game')
                && JSON.stringify(landing.standings.map(s => s.name)) === JSON.stringify(['1st SPN Alpha', '2nd Bravo', '3rd Charlie', '4th Delta', '5th Player 5', '5th Player 6', '7th Player 7', '7th Player 8 - Jr'])
                && JSON.stringify(landing.phases) === JSON.stringify(Object.values(phaseNames))
                && landing.phaseDetails === 'Double Elimination · 12 entrants · 3 pools' && landing.poolLinks === 0 && landing.prizing.includes('60%'), landing);
            check('event landing: each of the top 8 shows who they lost to, oldest loss first, and the winner shows none',
                JSON.stringify(landing.standings.map(s => s.lostTo)) === JSON.stringify(lostToShown.map(names => names && 'Lost to: ' + names)), landing.standings.map(s => s.lostTo));
            check('event landing: a ranking of a built-in series shows its logo at 16 px with the ranking\'s name as alt text, and any other shows the trophy',
                JSON.stringify(landing.standings.map(s => s.rankIcons)) === JSON.stringify(rankIconsShown), landing.standings.map(s => s.rankIcons));
            check('event landing: socials are icons alone (X and Twitch links, Discord a 15 px button), rankings are a logo or a trophy and the rank, and empty ones are hidden',
                JSON.stringify(landing.standings.map(s => s.socials)) === JSON.stringify(socialsShown) && JSON.stringify(landing.standings.map(s => s.rankings)) === JSON.stringify(rankingsShown)
                && landing.standings.filter(s => s.socialsRow).length === 3 && landing.standings.filter(s => s.rankingsRow).length === 3 && landing.standings[0].discordText === '15' && landing.standings[0].iconsDrawn && landing.standings[0].rankIconsDrawn, landing.standings);
            const cards = await standingsLayout(page);
            report.eventLanding.cards = cards;
            // 1st | 2nd, 3rd | 4th, 5th | 5th, 7th | 7th
            check('event landing: the top 8 read across each row and then down, two to a row',
                cards.length === 8 && cards.every((c, i) => Math.abs(c.left - cards[i % 2].left) <= 1 && Math.abs(c.top - cards[i - i % 2].top) <= 1)
                && cards[1].left > cards[0].left + cards[0].width && [2, 4, 6].every(i => cards[i].top >= cards[i - 2].top + cards[i - 2].height), cards.map(c => [c.left, c.top]));
            check('event landing: all 8 cards are the same size within 1 px, whatever they hold',
                sameCards(cards), cards);
            check('event landing: in each card the 24 px placement, the 52 px picture and the text block are centered top to bottom within 2 px',
                centeredCards(cards), cards.map(c => [c.centers, c.placementSize, c.avatarSize, c.lineLefts]));
            check('event landing: the rankings are on their own line below the socials', rankingsOwnLine(cards), cards.map(c => c.rankingsBelowSocials));
            check('event landing: a name and a lost-to line carry their full text as a title',
                JSON.stringify(landing.standings.map(s => s.titles)) === JSON.stringify(standingNames.map((name, i) => [name.replace('SPN | ', 'SPN '), ...(lostToShown[i] ? ['Lost to: ' + lostToShown[i]] : [])])), landing.standings.map(s => s.titles));
            // A ranking's name shows on hover, and on keyboard focus
            const rankingButtons = page.locator('.standing-ranking');
            const tooltip = async () => (await texts(page, '.mat-mdc-tooltip')).join('|');
            const tooltips = { hover: [] };
            for (const i of [0, 1, 2, 3]) {
                await rankingButtons.nth(i).hover();
                await page.waitForTimeout(400);
                tooltips.hover.push(await tooltip());
            }
            await page.mouse.move(5, 5);
            await page.waitForTimeout(400);
            tooltips.afterLeaving = await tooltip();
            await page.locator('a.standing-social').nth(1).focus();
            await page.keyboard.press('Tab');
            await page.waitForTimeout(400);
            tooltips.discordFocus = await tooltip();
            await page.keyboard.press('Tab');
            await page.waitForTimeout(400);
            tooltips.focus = await tooltip();
            const card = await page.locator('.standing').first().boundingBox();
            await page.screenshot({ path: 'e2e-out/ranking-tooltip-desktop.png', clip: { x: card.x - 10, y: card.y - 10, width: card.width + 20, height: card.height + 70 } }).catch(() => { });
            await page.keyboard.press('Escape');
            await page.evaluate(() => document.activeElement?.blur());
            // The Discord icon shows the username on hover, and a click copies it and says so for a moment
            await page.evaluate(() => { window.copiedTexts = []; navigator.clipboard.writeText = async text => { window.copiedTexts.push(text); }; });
            const discord = page.locator('button.standing-social').first();
            await discord.hover();
            await page.waitForTimeout(400);
            tooltips.discordHover = await tooltip();
            await discord.click();
            await page.waitForTimeout(400);
            tooltips.discordClicked = await tooltip();
            await page.screenshot({ path: 'e2e-out/discord-copied-desktop.png', clip: { x: card.x - 10, y: card.y - 10, width: card.width + 20, height: card.height + 70 } }).catch(() => { });
            await page.waitForTimeout(2200);
            tooltips.discordLater = await tooltip();
            tooltips.copiedTexts = await page.evaluate(() => window.copiedTexts);
            await page.mouse.move(5, 5);
            await page.waitForTimeout(400);
            report.eventLanding.rankingTooltips = tooltips;
            check('event landing: the Discord icon shows the username in a tooltip on hover and on keyboard focus, and a click copies it and says "Copied" for 2 seconds',
                tooltips.discordHover === 'Discord: alpha.gg' && tooltips.discordFocus === 'Discord: alpha.gg' && tooltips.discordClicked === 'Copied alpha.gg'
                && tooltips.discordLater === 'Discord: alpha.gg' && JSON.stringify(tooltips.copiedTexts) === '["alpha.gg"]', tooltips);
            check('event landing: a ranking shows its full name in a tooltip on hover and on keyboard focus',
                JSON.stringify(tooltips.hover) === JSON.stringify([...rankingsOf[1], ...rankingsOf[2]].map(r => r.title)) && tooltips.afterLeaving === '' && tooltips.focus === 'TestRank: 2025', tooltips);
            check('event landing: the one overview request asks for the sets, socials and rankings but no pools, and there is no Show more',
                JSON.stringify(landing.detailsAsked) === JSON.stringify(['sets socials rankings']) && landing.showMore === 0, { detailsAsked: landing.detailsAsked, showMore: landing.showMore });
            await page.waitForTimeout(1500); // the "loaded" notice goes away
            await page.screenshot({ path: 'e2e-out/event-landing-desktop.png' }).catch(() => { });
            await page.locator('.standings-list').screenshot({ path: 'e2e-out/standings-desktop.png' }).catch(() => { });
            await page.locator('.phase-list').screenshot({ path: 'e2e-out/phases-desktop.png' }).catch(() => { });
            await page.emulateMedia({ colorScheme: 'light' });
            await page.reload();
            await quiet();
            await page.waitForTimeout(1500);
            await page.screenshot({ path: 'e2e-out/event-landing-desktop-light.png' }).catch(() => { });
            await page.emulateMedia({ colorScheme: 'dark' });
            await page.reload();
            await quiet();
            await page.setViewportSize({ width: 1280, height: 720 });

            // The standings are all there is: scrolling to the bottom and hovering a card asks for nothing more
            let mark = log.length;
            await page.locator('.standing').last().hover();
            await page.mouse.wheel(0, 3000);
            await quiet(800);
            report.eventLanding.afterLoad = { standings: await page.locator('.standing').count(), requests: count(log, mark) };
            check('event landing: the standings stay at 8 and make no request after the page loads',
                report.eventLanding.afterLoad.standings === 8 && report.eventLanding.afterLoad.requests.total === 0, report.eventLanding.afterLoad);

            // A phase opens its bracket; the link at the top goes back to the event; so does the browser
            await page.locator('.phase-link', { hasText: 'Top 4' }).click();
            await quiet();
            const openedPhase = { url: new URL(page.url()).pathname, phase: await phaseShown(page), drawn: (await tags(page)).includes('Alpha'), backLink: (await texts(page, '.event-back'))[0] };
            await page.locator('.event-back').click();
            await quiet();
            const backByLink = await atLanding(page);
            await page.goBack();
            await quiet();
            const backToBracket = new URL(page.url()).pathname === eventPath + '/1002' && await phaseShown(page) === 'Top 4' && (await tags(page)).includes('Alpha');
            await page.goBack();
            await quiet();
            const backToLanding = await atLanding(page) && await page.locator('.phase-card').count() === 8;
            await page.goForward();
            await quiet();
            const forwardToBracket = new URL(page.url()).pathname === eventPath + '/1002' && (await tags(page)).includes('Alpha');
            report.eventLanding.navigation = { openedPhase, backByLink, backToBracket, backToLanding, forwardToBracket };
            check('event landing: a phase opens its bracket, the link back returns to the event, and back and forward work',
                openedPhase.url === eventPath + '/1002' && openedPhase.phase === 'Top 4' && openedPhase.drawn && openedPhase.backLink.includes('Test Event')
                && backByLink && backToBracket && backToLanding && forwardToBracket, report.eventLanding.navigation);

            // The phase menu jumps from Top 4 to Single Elim, four phases on; the arrows stay
            mark = log.length;
            await page.locator('.phase-menu-button').click();
            await page.waitForTimeout(500);
            const items = await texts(page, '.phase-menu-item');
            await page.screenshot({ path: 'e2e-out/phase-menu.png' }).catch(() => { });
            await page.locator('.phase-menu-item').nth(5).click();
            await quiet();
            const menu = {
                items, url: new URL(page.url()).pathname, phase: await phaseShown(page), rounds: (await texts(page, '.full-round-text')).slice(0, 2),
                arrows: await page.locator('button:has(mat-icon[fonticon="arrow_back"]), button:has(mat-icon[fonticon="arrow_forward"])').count(), requests: count(log, mark),
            };
            report.eventLanding.phaseMenu = menu;
            check('phase menu: lists every phase, marks the current one, and jumps to a phase that is not next door',
                JSON.stringify(items) === JSON.stringify(Object.values(phaseNames).map(name => name === 'Top 4' ? 'check Top 4' : name))
                && menu.url === eventPath + '/1006' && menu.phase === 'Single Elim' && menu.rounds.join() === 'Semi-Final,Final' && menu.arrows === 2
                && !menu.requests.tournament && !menu.requests.entrants, menu);

            // A pool's own URL still opens its phase scrolled down to that pool
            await page.goto(appUrl + eventPath + '/1005/2007');
            await quiet();
            await page.waitForTimeout(500);
            const pool = await page.evaluate(() => {
                const box = document.querySelector('mat-sidenav-content');
                const el = document.getElementById('pool-2007');
                return { scrollTop: Math.round(box.scrollTop), top: el ? Math.round(el.getBoundingClientRect().top - box.getBoundingClientRect().top) : null, viewHeight: box.clientHeight };
            });
            pool.url = new URL(page.url()).pathname;
            report.eventLanding.pool = pool;
            check('bracket URLs: a pool URL opens its phase, scrolled to that pool', pool.url === eventPath + '/1005/2007' && pool.scrollTop > 0 && pool.top !== null && pool.top >= 0 && pool.top < pool.viewHeight - 100, pool);

            // /brackets with no phase, and start.gg's ?filter= form, still open a bracket
            await page.goto(appUrl + eventPath);
            await quiet();
            const noPhase = await phaseShown(page);
            await page.goto(appUrl + eventPath + '?filter=' + encodeURIComponent('{"phaseId":1002,"perPage":10}'));
            await quiet();
            const filtered = await phaseShown(page);
            report.eventLanding.bracketUrls = { noPhase, filtered };
            check('bracket URLs: /brackets opens the first phase and /brackets?filter= opens its phase', noPhase === 'Pools' && filtered === 'Top 4', report.eventLanding.bracketUrls);

            // The sidebar's event link, the tournament page's event link and the Event Link box
            await page.locator('mat-sidenav a[mat-list-item]', { hasText: 'Test Event' }).click();
            await quiet();
            const fromSidebar = await atLanding(page);
            await page.goto(appUrl + '/tournament/test-tourney');
            await quiet();
            await page.locator('.event-name').click();
            await quiet();
            const fromTournament = await atLanding(page);
            await page.locator('.back-link').click();
            await quiet();
            const backToTournament = new URL(page.url()).pathname === '/tournament/test-tourney' && await page.locator('.tournament-name').count() === 1;
            await page.locator('mat-sidenav input').fill('https://www.start.gg/tournament/test-tourney/event/test-event/overview');
            await page.locator('mat-sidenav input').press('Enter');
            await quiet();
            const fromSearch = (await texts(page, '.event-title'))[0] === 'Test Event';
            await page.locator('mat-sidenav input').fill('https://www.start.gg/tournament/test-tourney/event/test-event/brackets/1002/2002');
            await page.locator('mat-sidenav input').press('Enter');
            await quiet();
            const bracketFromSearch = await phaseShown(page) === 'Top 4';
            report.eventLanding.links = { fromSidebar, fromTournament, backToTournament, fromSearch, bracketFromSearch, errors };
            check('event links in the sidebar, the tournament page and the Event Link box open the landing page; a bracket link still opens the bracket',
                fromSidebar && fromTournament && backToTournament && fromSearch && bracketFromSearch && !errors.length, report.eventLanding.links);
        } catch (e) {
            report.eventLanding = { ...report.eventLanding, crashed: String(e.message).slice(0, 300), errors };
            check('event landing page', false, report.eventLanding);
        }
        await context.close();
    }

    // 18. The landing page on a phone: one column, nothing wider than the screen, and a tap on a phase opens it.
    //     An event that hasn't started shows its phases and no standings.
    {
        const landingPath = '/tournament/test-tourney/event/test-event';
        const { context, page, quiet: idle } = await openPage(browser, () => null, { ...devices['Pixel 7'], colorScheme: 'dark' }, { fonts: true });
        const quiet = async ms => { await page.waitForTimeout(400); return idle(ms); };
        try {
            const size = page.viewportSize();
            await page.goto(appUrl + landingPath);
            await quiet();
            await rankImagesSettled(page);
            const layout = await page.evaluate(() => {
                const lefts = [...document.querySelectorAll('.standing')].map(el => Math.round(el.getBoundingClientRect().left));
                const content = document.querySelector('mat-sidenav-content');
                // Nothing in a card (a long ranking, a Discord name) sticks out of it
                const cardsFit = [...document.querySelectorAll('.standing')].every(card => [...card.querySelectorAll('*')].every(el => el.getBoundingClientRect().right <= card.getBoundingClientRect().right + 0.5));
                const rankIcons = [...document.querySelectorAll('.standing-ranking')].map(el => el.querySelector('img') ? 'logo' : 'trophy').join(' ');
                return { cardsFit, rankIcons, oneColumn: lefts.length === 8 && lefts.every(left => left === lefts[0]), fits: content.scrollWidth <= content.clientWidth, sidebarOpen: !!document.querySelector('mat-sidenav.mat-drawer-opened') };
            });
            const cards = await standingsLayout(page);
            report.eventLandingPhone = { layout, cards };
            check('phone: the 8 cards run 1st to 8th down one column, all the same size within 1 px, with the rankings on their own line below the socials',
                cards.every((c, i) => !i || c.top >= cards[i - 1].top + cards[i - 1].height) && sameCards(cards) && rankingsOwnLine(cards), cards);
            check('phone: in each card the 24 px placement, the 52 px picture and the text block are centered top to bottom within 2 px',
                centeredCards(cards), cards.map(c => [c.centers, c.placementSize, c.avatarSize, c.lineLefts]));
            await page.waitForTimeout(1500);
            await page.screenshot({ path: 'e2e-out/event-landing-phone.png' }).catch(() => { });
            await page.locator('.standings-list').screenshot({ path: 'e2e-out/standings-phone.png' }).catch(() => { });
            await page.locator('.phase-list').screenshot({ path: 'e2e-out/phases-phone.png' }).catch(() => { });
            // A tap on a ranking shows its name, and a tap elsewhere puts it away
            const tooltip = async () => (await page.locator('.mat-mdc-tooltip').allInnerTexts()).join('|').trim();
            await page.locator('.standing-ranking').nth(2).tap();
            await page.waitForTimeout(500);
            const tapped = await tooltip();
            await page.screenshot({ path: 'e2e-out/ranking-tooltip-phone.png' }).catch(() => { });
            await page.locator('.section-heading').first().tap();
            await page.waitForTimeout(500);
            const tappedAway = await tooltip();
            // A tap on the Discord icon copies the username and says which
            await page.evaluate(() => { window.copiedTexts = []; navigator.clipboard.writeText = async text => { window.copiedTexts.push(text); }; });
            await page.locator('button.standing-social').first().tap();
            await page.waitForTimeout(500);
            const discordTapped = [await tooltip(), ...await page.evaluate(() => window.copiedTexts)];
            await page.screenshot({ path: 'e2e-out/discord-copied-phone.png' }).catch(() => { });
            await page.locator('.section-heading').first().tap();
            await page.waitForTimeout(500);
            check('phone: a tap on the Discord icon copies the username and shows "Copied" with the name', JSON.stringify(discordTapped) === '["Copied alpha.gg","alpha.gg"]', discordTapped);
            await page.setViewportSize({ width: size.width, height: 2600 });
            await page.waitForTimeout(300);
            await page.screenshot({ path: 'e2e-out/event-landing-phone-full.png' }).catch(() => { });
            await page.setViewportSize(size);
            await page.locator('.phase-link', { hasText: 'Single Elim, No 3rd Place' }).tap();
            await quiet();
            const opened = new URL(page.url()).pathname === eventPath + '/1007' && (await tags(page)).includes('Alpha');
            await page.locator('.phase-menu-button').tap();
            await page.waitForTimeout(500);
            const menuItems = await page.locator('.phase-menu-item').count();
            await page.screenshot({ path: 'e2e-out/phase-menu-phone.png' }).catch(() => { });
            report.eventLandingPhone = { ...layout, cards, tapped, tappedAway, opened, menuItems };
            check('phone: the landing page is one column that fits the screen, rankings show their logo or the trophy, a tap on a ranking shows its name, a phase opens on tap, and the phase menu opens',
                layout.rankIcons === 'trophy logo trophy logo trophy' && tapped === rankingsOf[1][2].title && tappedAway === '' && layout.oneColumn && layout.fits && layout.cardsFit && !layout.sidebarOpen && opened && menuItems === 8, report.eventLandingPhone);
        } catch (e) {
            report.eventLandingPhone = { crashed: String(e.message).slice(0, 300) };
            check('phone: event landing page', false, report.eventLandingPhone);
        }
        await context.close();
    }
    {
        const upcoming = q => {
            const event = overview(q);
            event.state = 'CREATED';
            event.phases = event.phases.slice(0, 2).map(phase => ({ ...phase, state: 'CREATED' }));
            event.standings = { nodes: [] };
            event.prizingInfo.enablePrizing = false;
            event.rulesMarkdown = null;
            return { data: { event } };
        };
        const { context, page, quiet } = await openPage(browser, q => kindOf(q) === 'overview' ? { body: upcoming(q) } : null, { colorScheme: 'dark' }, { fonts: true });
        try {
            await page.goto(appUrl + '/tournament/test-tourney/event/test-event');
            await quiet();
            report.eventLandingUpcoming = {
                header: (await page.locator('.event-header .meta-row').innerText()).replace(/\s+/g, ' '), standings: await page.locator('.standing').count(),
                phases: await page.locator('.phase-card').count(), headings: await page.locator('.section-heading').allInnerTexts(),
            };
            await page.waitForTimeout(1500);
            await page.screenshot({ path: 'e2e-out/event-landing-upcoming.png' }).catch(() => { });
            check('event landing: an event that has not started shows its phases, no standings, and no default prizing',
                report.eventLandingUpcoming.header.includes('Upcoming') && report.eventLandingUpcoming.standings === 0 && report.eventLandingUpcoming.phases === 2
                && report.eventLandingUpcoming.headings.join() === 'Brackets', report.eventLandingUpcoming);
        } catch (e) {
            report.eventLandingUpcoming = { crashed: String(e.message).slice(0, 300) };
            check('event landing: an event that has not started', false, report.eventLandingUpcoming);
        }
        await context.close();
    }

    // 19. start.gg refuses the overview for being too big: the page asks again with less each time
    //     (socials and rankings go first, then the sets behind "Lost to").
    {
        report.eventLandingTooComplex = {};
        for (const refusals of [1, 2]) {
            let asked = 0;
            const { context, page, log, quiet } = await openPage(browser, q => kindOf(q) === 'overview' && ++asked <= refusals ? tooComplex : null, { colorScheme: 'dark' });
            try {
                await page.goto(appUrl + '/tournament/test-tourney/event/test-event');
                await quiet();
                const shown = await standingsShown(page);
                const result = report.eventLandingTooComplex[`refused${refusals}`] = {
                    requests: count(log), asked: overviewQueries(log).map(detailsAsked), standings: shown.length, lostTo: shown.filter(s => s.lostTo).length,
                    extras: shown.filter(s => s.extrasRow).length, phases: await page.locator('.phase-card').count(), snack: await snackText(page),
                };
                if (refusals === 1) check('event landing: a refused overview is asked again without socials and rankings, and still shows who each lost to',
                    JSON.stringify(result.asked) === JSON.stringify(['sets socials rankings', 'sets']) && result.standings === 8 && result.lostTo === 7 && result.extras === 0 && result.phases === 8, result);
                else check('event landing: an overview refused twice ends as the plain top 8 and phases',
                    JSON.stringify(result.asked) === JSON.stringify(['sets socials rankings', 'sets', '']) && result.standings === 8 && result.lostTo === 0 && result.extras === 0 && result.phases === 8, result);
            } catch (e) {
                check(`event landing: overview refused ${refusals} times`, false, String(e.message).slice(0, 300));
            }
            await context.close();
        }
    }

    // 20. A teams event: who each team lost to, and no socials or rankings, which are not asked for
    {
        const teamOf = name => name.replace('SPN | ', '') + ' / Partner ' + name.at(-1);
        const teams = q => {
            const event = overview(q);
            event.type = 5;
            event.standings.nodes.forEach(({ entrant }) => {
                entrant.name = teamOf(entrant.name);
                entrant.participants = [entrant.participants[0], { id: entrant.id + 200, user: null }];
                entrant.paginatedSets?.nodes.forEach(set => {
                    if (set.displayScore && set.displayScore !== 'DQ') set.displayScore = set.displayScore.replace(/^(.+) (\d+) - (.+) (\d+)$/, (_, a, x, b, y) => `${teamOf(a)} ${x} - ${teamOf(b)} ${y}`);
                });
            });
            return { data: { event } };
        };
        const tournament = q => {
            const body = answer(q);
            body.data.tournament.events[0].type = 5;
            return body;
        };
        const { context, page, log, quiet } = await openPage(browser, q => kindOf(q) === 'overview' ? { body: teams(q) } : kindOf(q) === 'tournament' ? { body: tournament(q) } : null, { colorScheme: 'dark' }, { fonts: true });
        try {
            await page.setViewportSize({ width: 1280, height: 1100 });
            await page.goto(appUrl + '/tournament/test-tourney/event/test-event');
            await quiet();
            const shown = await standingsShown(page);
            report.eventLandingTeams = { requests: count(log), asked: overviewQueries(log).map(detailsAsked), names: shown.map(s => s.name), lostTo: shown.map(s => s.lostTo), extras: shown.filter(s => s.extrasRow).length };
            await page.waitForTimeout(1500);
            await page.locator('.standings-list').screenshot({ path: 'e2e-out/standings-teams.png' }).catch(() => { });
            check('event landing: a teams event shows who each team lost to, and asks for no socials or rankings',
                report.eventLandingTeams.requests.total === 2 && JSON.stringify(report.eventLandingTeams.asked) === JSON.stringify(['sets'])
                && report.eventLandingTeams.names[0] === '1st Alpha / Partner a' && report.eventLandingTeams.extras === 0
                && JSON.stringify(report.eventLandingTeams.lostTo.slice(0, 5)) === JSON.stringify(['', 'Lost to: Alpha / Partner a ×2', 'Lost to: XYZ | Player 30 / Partner 0, Bravo / Partner o', 'Lost to: DQ, Charlie / Partner e', 'Lost to: A - B | Player 31 / Partner 1, Charlie / Partner e']), report.eventLandingTeams);
        } catch (e) {
            report.eventLandingTeams = { crashed: String(e.message).slice(0, 300) };
            check('event landing: a teams event', false, report.eventLandingTeams);
        }
        await context.close();
    }

    // Logging in is optional: a button in the header on desktop and in the menu on a phone, where the
    // menu lies over the page. Every page ends with the credit to start.gg and a link to /privacy.
    {
        report.loginUi = {};
        const menuButton = 'mat-toolbar button:has(mat-icon:text("menu"))';
        const visibleText = async locator => (await locator.isVisible().catch(() => false)) ? (await locator.innerText()).replace(/\s+/g, ' ').trim() : null;
        // The Material icon font is blocked here, so an icon's name is in the text: "login Log in with start.gg"
        const label = text => text?.replace(/^(login|logout)\s*/, '') ?? null;
        for (const loggedIn of [false, true]) {
            const state = loggedIn ? 'logged in' : 'logged out';
            const want = loggedIn ? 'Log out' : 'Log in with start.gg';
            const [mine, other] = loggedIn ? ['logout', 'login'] : ['login', 'logout'];
            try {
                const { context, page } = await openPage(browser, () => null, { viewport: { width: 1280, height: 900 } }, { loggedIn });
                await page.goto(appUrl + '/');
                await page.waitForTimeout(800);
                const desktop = {
                    button: label(await visibleText(page.locator(`mat-toolbar .header-${mine}`))),
                    otherButton: await page.locator(`mat-toolbar .header-${other}`).count(),
                    menuButton: await page.locator(menuButton).count(),
                    inMenu: await page.locator('mat-sidenav .sidenav-account').count(),
                    discord: await page.locator('mat-toolbar').getByText('discord', { exact: false }).count(),
                    sidenavMode: await page.locator('mat-sidenav').evaluate(el => el.classList.contains('mat-drawer-side') ? 'side' : 'over'),
                    contentLeft: await page.locator('mat-sidenav-content').evaluate(el => Math.round(el.getBoundingClientRect().left)),
                };
                report.loginUi[`desktop, ${state}`] = desktop;
                check(`desktop, ${state}: the header has "${want}" and no Discord button, and the sidebar stays beside the page`,
                    desktop.button === want && !desktop.otherButton && !desktop.menuButton && !desktop.inMenu && !desktop.discord && desktop.sidenavMode === 'side' && desktop.contentLeft >= 250 && desktop.contentLeft <= 252, desktop);
                await context.close();
            } catch (e) {
                check(`desktop, ${state}: header`, false, String(e.message).slice(0, 300));
            }

            try {
                const { context, page } = await openPage(browser, () => null, devices['Pixel 7'], { loggedIn });
                await page.goto(appUrl + '/');
                await page.waitForTimeout(800);
                const inHeader = await page.locator('mat-toolbar .header-auth').count();
                await page.locator(menuButton).click();
                await page.waitForTimeout(700);
                const phone = await page.evaluate(() => {
                    const box = el => el?.getBoundingClientRect();
                    const sidenav = document.querySelector('mat-sidenav');
                    const account = box(document.querySelector('mat-sidenav .sidenav-account button'));
                    return {
                        opened: sidenav.classList.contains('mat-drawer-opened'),
                        mode: sidenav.classList.contains('mat-drawer-over') ? 'over' : 'side',
                        backdrop: !!document.querySelector('.mat-drawer-backdrop.mat-drawer-shown'),
                        contentLeft: Math.round(box(document.querySelector('mat-sidenav-content')).left),
                        contentWidth: Math.round(box(document.querySelector('mat-sidenav-content')).width),
                        windowWidth: innerWidth,
                        pageWidth: document.documentElement.scrollWidth,
                        // The button is on screen, inside the menu
                        buttonOnScreen: !!account && account.top >= 0 && account.bottom <= innerHeight && account.left >= 0 && account.right <= box(sidenav).right + 1,
                        // The search box didn't take focus, which would open the keyboard
                        focusedInput: document.activeElement?.tagName === 'INPUT',
                    };
                });
                phone.inHeader = inHeader;
                phone.button = label(await visibleText(page.locator(`mat-sidenav .menu-${mine}`)));
                phone.otherButton = await page.locator(`mat-sidenav .menu-${other}`).count();
                // A tap on the page beside the menu closes it
                await page.mouse.click(phone.windowWidth - 30, 400);
                await page.waitForTimeout(700);
                phone.closedByBackdrop = await page.locator('mat-sidenav.mat-drawer-opened').count() === 0;
                report.loginUi[`phone, ${state}`] = phone;
                check(`phone, ${state}: the menu has "${want}" and the header does not`, phone.button === want && !phone.otherButton && !phone.inHeader && phone.buttonOnScreen, phone);
                check(`phone, ${state}: the menu lies over the page with a backdrop, does not push the page sideways or focus the search box, and a tap beside it closes it`,
                    phone.opened && phone.mode === 'over' && phone.backdrop && phone.contentLeft === 0 && phone.contentWidth === phone.windowWidth && phone.pageWidth <= phone.windowWidth
                    && !phone.focusedInput && phone.closedByBackdrop, phone);
                await context.close();
            } catch (e) {
                check(`phone, ${state}: menu`, false, String(e.message).slice(0, 300));
            }
        }

        // The footer, on each kind of page and both layouts
        const pages = { home: '/', bracket: eventPath + '/1001', tournament: '/tournament/test-tourney', 'event landing': '/tournament/test-tourney/event/test-event', privacy: '/privacy' };
        for (const [size, device] of [['desktop', { viewport: { width: 1280, height: 900 } }], ['phone', devices['Pixel 7']]]) {
            const { context, page, quiet } = await openPage(browser, () => null, device);
            for (const [name, path] of Object.entries(pages)) {
                try {
                    await page.goto(appUrl + path);
                    await quiet(800);
                    const footer = await page.evaluate(async () => {
                        const content = document.querySelector('mat-sidenav-content');
                        const el = content.querySelector('footer.site-footer');
                        if (!el) return null;
                        content.scrollTo({ top: content.scrollHeight, left: 0, behavior: 'instant' });
                        await new Promise(r => setTimeout(r, 200));
                        const box = el.getBoundingClientRect(), view = content.getBoundingClientRect();
                        const last = [...content.children].at(-1);
                        return {
                            text: el.innerText.replace(/\s+/g, ' ').trim(),
                            links: [...el.querySelectorAll('a')].map(a => `${a.innerText.trim()}|${a.getAttribute('href')}`),
                            isLast: last === el,
                            // Inside the visible part of the page once scrolled to the end, and flush with its bottom
                            inView: box.left >= view.left - 1 && box.right <= view.left + content.clientWidth + 1 && box.top >= view.top,
                            fromBottom: Math.round(view.top + content.clientHeight - box.bottom),
                            height: Math.round(box.height),
                            // Nothing wider than the window, and on pages other than a bracket nothing to scroll sideways
                            pageWidth: document.documentElement.scrollWidth, windowWidth: innerWidth,
                            contentOverflow: content.scrollWidth - content.clientWidth,
                        };
                    });
                    report.loginUi[`footer, ${size}, ${name}`] = footer;
                    check(`${size}, ${name}: the page ends with "Data from start.gg" and a Privacy link, inside the window, and nothing overflows sideways`,
                        footer && footer.text === 'Data from start.gg · Privacy' && JSON.stringify(footer.links) === '["start.gg|https://www.start.gg","Privacy|/privacy"]'
                        && footer.isLast && footer.inView && Math.abs(footer.fromBottom) <= 1 && footer.height <= 60 && footer.pageWidth <= footer.windowWidth
                        && (name === 'bracket' || footer.contentOverflow <= 0), footer);
                } catch (e) {
                    check(`${size}, ${name}: footer`, false, String(e.message).slice(0, 300));
                }
            }

            // The privacy page, reached from the footer's link
            try {
                await page.goto(appUrl + '/');
                await page.locator('footer.site-footer a', { hasText: 'Privacy' }).click();
                await page.waitForTimeout(600);
                const privacy = await page.evaluate(() => {
                    const article = document.querySelector('app-privacy');
                    return {
                        url: location.pathname,
                        heading: article?.querySelector('h1')?.innerText,
                        text: article?.innerText.replace(/\s+/g, ' ') ?? '',
                        links: [...(article?.querySelectorAll('a') ?? [])].map(a => a.getAttribute('href')),
                    };
                });
                const said = ['Last updated November 12, 2026', "You don't need an account", 'Logging in is optional', 'user.identity', 'session cookie', 'Logging out deletes', 'a few seconds to a few minutes', 'No analytics and no ads'].filter(t => !privacy.text.includes(t));
                report.loginUi[`privacy, ${size}`] = { url: privacy.url, heading: privacy.heading, links: privacy.links, missing: said };
                check(`${size}: the footer's Privacy link opens /privacy, which says what the site keeps and links to start.gg and the GitHub issues`,
                    privacy.url === '/privacy' && privacy.heading === 'Privacy' && !said.length
                    && JSON.stringify(privacy.links) === '["https://www.start.gg","https://github.com/santiagopinto2/bracketgg/issues"]', report.loginUi[`privacy, ${size}`]);
            } catch (e) {
                check(`${size}: privacy page`, false, String(e.message).slice(0, 300));
            }
            await context.close();
        }
    }
} finally {
    await browser.close();
}

report.passed = report.checks.every(c => c.ok);
console.log(JSON.stringify(report, null, 2));
if (!reportOnly && !report.passed) process.exit(1);
