// The tournament page, for e2e/api-calls.mjs: what the fake start.gg answers to its queries, and the checks.
//
// Three tournaments. "Showcase Open" (tp-tourney) is over: ten events over three days, singles and
// teams, two of them big, three streams, and a venue. "Small Weekly" (tp-upcoming) hasn't started: one
// event, online, no streams. "Live Local" (tp-live) is being played: one event in progress, one finished.
import { mkdirSync } from 'node:fs';

const svg = (width, height, color) => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="${width}" height="${height}" fill="${color}"/></svg>`)}`;
const FRIDAY_10AM_PST = 1708106400; // Fri Feb 16 2024, 10:00 in Los Angeles
const HOUR = 3600;
const ADDRESS = '150 W Test St, San Jose, CA 95113, USA';
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const placements = [1, 2, 3, 4, 5, 5, 7, 7];
// Standings as start.gg answers: Ace has a sponsor and a picture, Comet a sponsor and no user at all.
// A team's players come in the other order than its name's, as start.gg can send them; on a team
// Echo and Flint have pictures too.
const pictureColors = { Ace: '#2a7', Echo: '#b63', Flint: '#36b' };
const participantsOf = (name, k) => {
    const tags = name.split(' / ');
    const players = tags.map((tag, p) => {
        const color = tags.length > 1 ? pictureColors[tag] : name.includes('Ace') ? pictureColors.Ace : null;
        return { id: 9100 + k * 2 + p, gamerTag: tag.split(' | ').pop(), user: tag.includes('Comet') ? null : { images: color ? [{ url: svg(40, 40, color), width: 40, height: 40 }] : [] } };
    });
    return players.reverse();
};
const standings = (names, { isFinal = true, places = placements } = {}) => ({ nodes: names.map((name, k) => ({
    placement: places[k], isFinal,
    entrant: { id: 9000 + k, name, participants: participantsOf(name, k) },
})) });
const game = (id, name, displayName, color) => ({ id, name, displayName, images: [{ url: svg(96, 128, color), type: 'primary' }] });
const phases = (firstId, ...names) => names.map((name, k) => ({ id: firstId + k, name }));
const podium = name => [`${name} One`, `${name} Two`, `${name} Three`];

const bros = game(1, 'Super Test Bros.', 'Test Bros.', '#345');
const topEightOf = {
    601: ['SPN | Ace', 'Blaze', 'RED | Comet', 'Dash', 'Echo', 'TM | Flint', 'Gale', 'Halo'],
    602: ['Ivy', 'XY | Jinx', 'Kite', 'Lux', 'Mako', 'Nova', 'Onyx', 'Pike'],
    702: ['Rook', 'Sage', 'Tusk', 'Umbra'],
};
// short: the end of the event's slug. at: hours after the tournament starts.
const showcaseEvents = [
    { id: 601, name: 'Alpha Singles', short: 'alpha-singles', type: 1, numEntrants: 512, at: 0, videogame: bros, phases: phases(6101, 'R1 Pools', 'Top 64', 'Top 8'), top: topEightOf[601] },
    { id: 602, name: 'Beta Singles', short: 'beta-singles', type: 1, numEntrants: 256, at: 2, videogame: game(2, 'Test Fighter 6', 'Test Fighter', '#734'), phases: phases(6201, 'Pools', 'Top 8'), top: topEightOf[602] },
    { id: 603, name: 'Alpha Doubles', short: 'alpha-doubles', type: 5, numEntrants: 120, at: 0, videogame: bros, phases: phases(6301, 'Bracket'), top: ['Ace / Blaze', 'Comet / Dash', 'Echo / Flint'] },
    { id: 604, name: 'Gamma Singles', short: 'gamma-singles', type: 1, numEntrants: 96, at: 9, videogame: game(3, 'Puzzle Test', 'Puzzle Test', '#473'), phases: phases(6401, 'Day 1', 'Day 2', 'Top 24', 'Top 8', 'Finals'), top: podium('Gamma') },
    { id: 605, name: 'Delta Teams', short: 'delta-teams', type: 5, numEntrants: 40, at: 24, videogame: game(4, 'Squad Test', 'Squad Test', '#547'), phases: phases(6501, 'Bracket'), top: podium('Delta') },
    { id: 606, name: 'Epsilon Singles', short: 'epsilon-singles', type: 1, numEntrants: 64, at: 26, videogame: game(5, 'Test Kart', 'Test Kart', '#755'), phases: phases(6601, 'Bracket', 'Top 8'), top: podium('Epsilon') },
    { id: 607, name: 'Zeta Singles', short: 'zeta-singles', type: 1, numEntrants: 48, at: 26, videogame: game(6, 'Test Tennis', 'Test Tennis', '#557'), phases: phases(6701, 'Bracket'), top: podium('Zeta') },
    // start.gg left this one "created" with no standings, as it does for events run elsewhere
    { id: 608, name: 'Eta Singles', short: 'eta-singles', type: 1, numEntrants: 32, at: 28, state: 'CREATED', videogame: game(7, 'Test Blocks', 'Test Blocks', '#575'), phases: phases(6801, 'Bracket'), top: [] },
    { id: 609, name: 'Theta Singles', short: 'theta-singles', type: 1, numEntrants: 24, at: 48, videogame: game(8, 'Test Dance', 'Test Dance', '#377'), phases: phases(6901, 'Bracket'), top: podium('Theta') },
    { id: 610, name: 'Iota Doubles', short: 'iota-doubles', type: 5, numEntrants: 12, at: 50, videogame: game(8, 'Test Dance', 'Test Dance', '#377'), phases: phases(7001, 'Bracket'), top: podium('Iota') },
];

const tournaments = {
    'tp-tourney': {
        id: 3, name: 'Showcase Open', state: 3, startAt: FRIDAY_10AM_PST, endAt: FRIDAY_10AM_PST + 62 * HOUR - 60, timezone: 'America/Los_Angeles',
        images: [{ url: svg(1200, 300, '#8b1a1a'), type: 'banner' }, { url: svg(200, 200, '#e0243a'), type: 'profile' }],
        venueName: null, venueAddress: ADDRESS, city: 'San Jose', addrState: 'CA', countryCode: 'US', lat: 37.329, lng: -121.889, hashtag: 'SO', isOnline: false, numAttendees: 1234,
        owner: { player: { gamerTag: 'Dr. T' }, images: [] },
        streams: [
            { streamName: 'showcase_main', streamSource: 'TWITCH', streamLogo: svg(60, 60, '#c33'), isOnline: false, followerCount: 22912 },
            { streamName: 'showcase_2', streamSource: 'TWITCH', streamLogo: null, isOnline: true, followerCount: 138 },
            { streamName: 'ShowcaseTube', streamSource: 'YOUTUBE', streamLogo: null, isOnline: false, followerCount: 500 },
        ],
        events: showcaseEvents,
    },
    'tp-upcoming': {
        id: 4, name: 'Small Weekly', state: 1, startAt: 4102444800, endAt: 4102444800 + 4 * HOUR, timezone: 'America/New_York', // Thu Dec 31 2099, 7 PM in New York
        images: [], venueName: null, venueAddress: null, city: null, addrState: null, countryCode: null, lat: null, lng: null, hashtag: null, isOnline: true, numAttendees: 9,
        owner: null, streams: null,
        events: [{ id: 801, name: 'Weekly Singles', short: 'weekly-singles', type: 1, numEntrants: 9, at: 0, state: 'CREATED', videogame: { id: 1, name: 'Super Test Bros.', displayName: 'Test Bros.', images: [] }, phases: phases(8101, 'Bracket'), top: [] }],
    },
    'tp-live': {
        id: 5, name: 'Live Local', state: 1, startAt: FRIDAY_10AM_PST, endAt: FRIDAY_10AM_PST + 10 * HOUR, timezone: 'America/Los_Angeles',
        images: [{ url: svg(200, 200, '#246'), type: 'profile' }], venueName: 'The Test Hall', venueAddress: ADDRESS, city: 'San Jose', addrState: 'CA', countryCode: 'US', lat: 37.329, lng: -121.889, hashtag: null, isOnline: false, numAttendees: 48,
        owner: { player: { gamerTag: 'Local TO' }, images: [] },
        streams: [{ streamName: 'livelocal', streamSource: 'TWITCH', streamLogo: null, isOnline: true, followerCount: 1 }],
        events: [
            // Being played: everyone still in shares a placement, and none is final
            { id: 701, name: 'Main Singles', short: 'main-singles', type: 1, numEntrants: 40, at: 0, state: 'ACTIVE', videogame: bros, phases: phases(7101, 'Pools', 'Top 8'), top: ['Vex', 'Wren', 'Yara'], provisional: true },
            { id: 702, name: 'Side Singles', short: 'side-singles', type: 1, numEntrants: 16, at: 1, videogame: bros, phases: phases(7201, 'Bracket'), top: topEightOf[702] },
        ],
    },
};
const slugOf = (key, event) => `tournament/${key}/event/${event.short}`;

// One of this file's tournaments as the tournament query asks for it, or null for another tournament.
// The short query (no top 3, no phases) gets neither.
export function tournamentPageTournament(query) {
    const key = query.match(/tournament\(slug: "(tp-[\w-]+)"\)/)?.[1];
    const t = tournaments[key];
    if (!t) return null;
    const full = query.includes('standings(');
    return { data: { tournament: { ...t, rules: null, slug: `tournament/${key}`, primaryContact: null, primaryContactType: null,
        events: t.events.map(({ short, at, top, provisional, ...event }) => ({ ...event, slug: slugOf(key, { short }), startAt: t.startAt + at * HOUR, state: event.state ?? 'COMPLETED',
            ...(full ? { standings: provisional ? standings(top, { isFinal: false, places: [9, 9, 9] }) : standings(top.slice(0, 3)) } : { phases: undefined })
        })) } } };
}

export function tournamentPageKind(query) {
    return query.includes('event(id') ? 'tournamentResults' : null;
}

// The top 8 of the events the results query names, under the aliases it gives them
export function tournamentResultsAnswer(query) {
    const data = {};
    for (const [, alias, id] of query.matchAll(/(\w+): event\(id: "?(\d+)"?\)/g)) data[alias] = { id: Number(id), standings: standings(topEightOf[id] ?? []) };
    return { data };
}

// What the page shows, as plain texts
const pageShown = page => page.evaluate(() => {
    const text = el => el ? el.textContent.replace(/\s+/g, ' ').trim() : null;
    const all = (selector, root = document) => [...root.querySelectorAll(selector)];
    const visible = el => { const box = el.getBoundingClientRect(); return box.width > 0 && box.height > 0; };
    const href = el => el?.getAttribute('href') ?? null;
    const root = document.querySelector('.tp-page');
    if (!root) return null;
    // "3rd RED Comet": the placement, the sponsor, the tag
    const row = el => !el ? null : [text(el.querySelector('.pl, .place')), text(el.querySelector('.team')), text(el.querySelector('b'))].filter(Boolean).join(' ');
    const scroller = document.querySelector('mat-sidenav-content');
    // A row's pictures: each one's color, or the initials shown without one
    const faces = el => all('.av', el).map(av => av.querySelector('img') ? decodeURIComponent(av.querySelector('img').src).match(/fill="(#\w+)"/)?.[1] ?? 'picture' : av.dataset.i);
    const width = el => el ? el.getBoundingClientRect().width : null;
    return {
        podFaces: Object.fromEntries(all('.ev', root).map(card => [text(card.querySelector('.ev-name')), all('.pod li', card).map(faces)])),
        podFaceWidths: [width(root.querySelector('.pod li > .av')), width(root.querySelector('.pod li > .avs'))],
        name: text(root.querySelector('.tournament-name')),
        chips: all('.hero-chips .chip', root).filter(visible).map(text),
        meta: all('.hero-meta li', root).map(text),
        stats: all('.stats > *', root).map(el => `${text(el.querySelector('b'))} ${text(el.querySelector('span'))}`),
        attendeesHref: href(root.querySelector('.stats a.attendees-link')),
        startgg: href(root.querySelector('.hero-actions a')),
        tabs: all('.tabs > *', root).map(el => text(el).replace(/\s*([\d,]+)$/, ' $1')),
        attendeesTab: href(root.querySelector('.tabs a')),
        results: all('.result', root).filter(visible).map(card => ({
            name: text(card.querySelector('h3')), link: href(card.querySelector('h3 a')), sub: text(card.querySelector('.result-title p')), bracket: href(card.querySelector('header .jump')),
            champion: row(card.querySelector('.champ-text strong')), places: all('.places li', card).map(row),
        })),
        resultTabs: all('#tp-results .seg button', root).filter(visible).map(b => text(b) + (b.classList.contains('on') ? '*' : '')),
        eventCount: text(root.querySelector('.ev-count')),
        events: all('.ev', root).map(card => ({
            name: text(card.querySelector('.ev-name')), href: href(card), game: text(card.querySelector('.ev-game')), n: `${text(card.querySelector('.ev-n b'))} ${text(card.querySelector('.ev-n span'))}`,
            pod: all('.pod li', card).map(row), note: text(card.querySelector('.pod-none')), trail: text(card.querySelector('.trail'))?.replace(/\s*›\s*/g, '›') ?? null, when: text(card.querySelector('.ev-when')),
        })),
        eventColumns: new Set(all('.ev', root).map(card => Math.round(card.getBoundingClientRect().left))).size,
        more: text(root.querySelector('.more')),
        kinds: all('.kinds button', root).map(b => text(b) + (b.classList.contains('on') ? '*' : '')),
        sort: root.querySelector('.sort select')?.value ?? null,
        where: text(root.querySelector('.where')),
        directions: href(root.querySelector('.directions')),
        streams: all('.streams li', root).map(li => ({ name: text(li.querySelector('.s-name b')), detail: text(li.querySelector('small')), state: text(li.querySelector('.s-state')), href: href(li.querySelector('a')) })),
        scheduleNote: text(root.querySelector('.panel-note')),
        schedule: all('.schedule .sday, .schedule .slot', root).map(el => el.matches('.sday') ? text(el) : `${text(el.querySelector('time'))}: ${all('li', el).map(text).join(', ')}`),
        scheduleLink: href(root.querySelector('.schedule .slot a')),
        // Nothing wider than the page; the tabs scroll sideways on their own, and the blurred pictures are clipped
        fits: scroller.scrollWidth <= scroller.clientWidth + 1 && all('*', root).every(el => !visible(el) || el.closest('.ambient, .tabs, .champ-bg') || el.getBoundingClientRect().right <= scroller.getBoundingClientRect().right + 0.5),
        font: getComputedStyle(root).fontFamily.split(',')[0].replace(/["']/g, ''),
    };
});

const tooComplex = { body: { errors: [{ message: 'Your query complexity is too high. A maximum of 1000 objects may be returned by each request. (actual: 1400)' }] } };
const eventNames = shown => shown.events.map(e => e.name);

export async function tournamentPageChecks({ browser, openPage, appUrl, check, report, count, devices }) {
    report.tournamentPageNew = {};
    const out = report.tournamentPageNew;
    const guarded = async (name, run) => {
        try {
            await run();
        } catch (e) {
            out[`${name} crashed`] = String(e.message).slice(0, 400);
            check(`tournament page: ${name}`, false, out[`${name} crashed`]);
        }
    };
    const base = '/tournament/tp-tourney';
    const wide = { viewport: { width: 1600, height: 1000 }, colorScheme: 'dark' };
    const phone = { ...devices['Pixel 7'], colorScheme: 'dark' };

    // A finished tournament on a wide desktop: the header, results, events, and the side panels
    {
        const { context, page, log, quiet } = await openPage(browser, () => null, wide, { fonts: true });
        const errors = [];
        page.on('pageerror', e => errors.push(String(e.message).slice(0, 200)));
        await guarded('desktop', async () => {
            await page.goto(appUrl + base);
            await quiet();
            const shown = await pageShown(page);
            out.desktop = { requests: count(log), ...shown };
            check('tournament page: one request for the tournament and one for the top 8 of its two biggest events',
                same(out.desktop.requests, { total: 2, tournament: 1, tournamentResults: 1 }) && /e0: event\(id: 601\)[\s\S]*e1: event\(id: 602\)/.test(log.find(r => r.kind === 'tournamentResults')?.query ?? ''), out.desktop.requests);
            check('tournament page: the header has the name, a "Completed" chip, the dates, the city, the organizer, and the stat numbers',
                shown.name === 'Showcase Open' && same(shown.chips, ['Completed', 'In person', '#SO']) && same(shown.meta, ['February 16 to 18, 2024', 'San Jose, CA', 'Run by Dr. T'])
                && same(shown.stats, ['1,234 Attendees', '10 Events', '8 Games', '3 Streams']) && shown.startgg === 'https://www.start.gg/tournament/tp-tourney',
                { name: shown.name, chips: shown.chips, meta: shown.meta, stats: shown.stats, startgg: shown.startgg });
            check('tournament page: Attendees is a number up top and a tab, both links to the Attendees page',
                shown.attendeesHref === base + '/attendees' && shown.attendeesTab === base + '/attendees'
                && same(shown.tabs, ['Overview', 'Results', 'Events 10', 'Attendees 1,234', 'Streams 3', 'Schedule', 'Location']), { stat: shown.attendeesHref, tab: shown.attendeesTab, tabs: shown.tabs });
            check('tournament page: Results shows the two biggest events, the champion first and 2nd to 8th below, with links to the event and its last bracket',
                same(shown.results, [
                    { name: 'Alpha Singles', link: base + '/event/alpha-singles', sub: '512 entrants · 3 phases', bracket: base + '/event/alpha-singles/brackets/6103', champion: 'SPN Ace',
                        places: ['2nd Blaze', '3rd RED Comet', '4th Dash', '5th Echo', '5th TM Flint', '7th Gale', '7th Halo'] },
                    { name: 'Beta Singles', link: base + '/event/beta-singles', sub: '256 entrants · 2 phases', bracket: base + '/event/beta-singles/brackets/6202', champion: 'Ivy',
                        places: ['2nd XY Jinx', '3rd Kite', '4th Lux', '5th Mako', '5th Nova', '7th Onyx', '7th Pike'] },
                ]) && !shown.resultTabs.length, { results: shown.results, tabs: shown.resultTabs });
            check('tournament page: the eight biggest events as cards in two columns, each with its game, top 3, phases, and start time',
                shown.eventCount === '10' && same(eventNames(shown), ['Alpha Singles', 'Beta Singles', 'Alpha Doubles', 'Gamma Singles', 'Epsilon Singles', 'Zeta Singles', 'Delta Teams', 'Eta Singles'])
                && shown.eventColumns === 2 && shown.more === 'Show all 10 events'
                && same(shown.events[0], { name: 'Alpha Singles', href: base + '/event/alpha-singles', game: 'Super Test Bros. · Singles', n: '512 entrants', pod: ['1st SPN Ace', '2nd Blaze', '3rd RED Comet'], note: null, trail: 'R1 Pools›Top 64›Top 8', when: 'Fri 10:00 AM' })
                && same(shown.events[2], { name: 'Alpha Doubles', href: base + '/event/alpha-doubles', game: 'Super Test Bros. · Teams', n: '120 teams', pod: ['1st Ace / Blaze', '2nd Comet / Dash', '3rd Echo / Flint'], note: null, trail: 'Bracket', when: 'Fri 10:00 AM' })
                && shown.events[3].trail === '5 phases' && shown.events[3].when === 'Fri 7:00 PM' && shown.events[7].note === 'No results reported' && !shown.events[7].pod.length,
                { count: shown.eventCount, columns: shown.eventColumns, more: shown.more, events: shown.events });
            check('tournament page: a team in a top 3 has its first two players\' pictures in the order of its name, in the room of a single player\'s one',
                same(shown.podFaces['Alpha Doubles'], [['#2a7', 'B'], ['C', 'D'], ['#b63', '#36b']]) && same(shown.podFaces['Alpha Singles'], [['#2a7'], ['BL'], ['CO']])
                && same(shown.podFaceWidths, [22, 22]), { doubles: shown.podFaces['Alpha Doubles'], singles: shown.podFaces['Alpha Singles'], widths: shown.podFaceWidths });
            check('tournament page: When and Where has the dates with the time zone, the address, and a directions link, and no map',
                ['February 16 to 18, 2024', 'Friday 10:00 AM to Sunday 11:59 PM', 'Pacific Standard Time (PST)', '150 W Test St', 'San Jose, CA 95113', 'Get directions'].every(part => shown.where.includes(part))
                && shown.directions === 'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(ADDRESS) && await page.locator('.tp-page .where svg.map, .tp-page .where iframe, .tp-page .where canvas').count() === 0,
                { where: shown.where, directions: shown.directions });
            check('tournament page: Streams lists the live one first, then by followers, with Twitch links',
                same(shown.streams, [
                    { name: 'showcase_2', detail: 'Twitch · 138 followers', state: 'Live', href: 'https://www.twitch.tv/showcase_2' },
                    { name: 'showcase_main', detail: 'Twitch · 22.9K followers', state: 'Offline', href: 'https://www.twitch.tv/showcase_main' },
                    { name: 'ShowcaseTube', detail: 'YouTube · 500 followers', state: 'Offline', href: null },
                ]), shown.streams);
            check('tournament page: Schedule lists start times by day in the tournament\'s time zone, each event a link',
                shown.scheduleNote === 'When each event starts, in Pacific Time (PST).' && same(shown.schedule, [
                    'Friday, February 16', '10:00 AM: Alpha Singles, Alpha Doubles', '12:00 PM: Beta Singles', '7:00 PM: Gamma Singles',
                    'Saturday, February 17', '10:00 AM: Delta Teams', '12:00 PM: Epsilon Singles, Zeta Singles', '2:00 PM: Eta Singles',
                    'Sunday, February 18', '10:00 AM: Theta Singles', '12:00 PM: Iota Doubles',
                ]) && shown.scheduleLink === base + '/event/alpha-singles', { note: shown.scheduleNote, schedule: shown.schedule, link: shown.scheduleLink });
            check('tournament page: nothing is wider than the page, and the text is in the page\'s own font', shown.fits && shown.font === 'Archivo', { fits: shown.fits, font: shown.font });

            // Show all, the filters, and the sort menu
            await page.locator('.tp-page .more').click();
            const everything = await pageShown(page);
            await page.locator('.tp-page .kinds button', { hasText: 'Teams' }).click();
            const teams = await pageShown(page);
            await page.locator('.tp-page .kinds button', { hasText: 'Singles' }).click();
            const singles = await pageShown(page);
            await page.locator('.tp-page .kinds button', { hasText: 'All' }).click();
            await page.locator('.tp-page .sort select').selectOption('name');
            const byName = await pageShown(page);
            await page.locator('.tp-page .sort select').selectOption('time');
            const byTime = await pageShown(page);
            await page.locator('.tp-page .more').click();
            const fewer = await pageShown(page);
            out.list = { everything: { names: eventNames(everything), more: everything.more }, teams: { names: eventNames(teams), count: teams.eventCount, more: teams.more, kinds: teams.kinds },
                singles: { names: eventNames(singles), count: singles.eventCount }, byName: eventNames(byName), byTime: eventNames(byTime), fewer: { count: fewer.events.length, more: fewer.more } };
            check('tournament page: "Show all" lists every event, and "Show fewer" goes back to eight',
                everything.events.length === 10 && same(eventNames(everything).slice(8), ['Theta Singles', 'Iota Doubles']) && everything.more === 'Show fewer' && fewer.events.length === 8 && fewer.more === 'Show all 10 events', out.list);
            check('tournament page: the Singles and Teams filters keep only their events and count them',
                same(eventNames(teams), ['Alpha Doubles', 'Delta Teams', 'Iota Doubles']) && teams.eventCount === '3' && teams.more === null && same(teams.kinds, ['All', 'Singles', 'Teams*'])
                && same(eventNames(singles), ['Alpha Singles', 'Beta Singles', 'Gamma Singles', 'Epsilon Singles', 'Zeta Singles', 'Eta Singles', 'Theta Singles']) && singles.eventCount === '7', out.list);
            check('tournament page: the sort menu orders the events by name and by start time',
                same(eventNames(byName), ['Alpha Doubles', 'Alpha Singles', 'Beta Singles', 'Delta Teams', 'Epsilon Singles', 'Eta Singles', 'Gamma Singles', 'Iota Doubles', 'Theta Singles', 'Zeta Singles'])
                && same(eventNames(byTime), ['Alpha Singles', 'Alpha Doubles', 'Beta Singles', 'Gamma Singles', 'Delta Teams', 'Epsilon Singles', 'Zeta Singles', 'Eta Singles', 'Theta Singles', 'Iota Doubles']), out.list);

            // The tabs: a jump scrolls to its section and the bar stays at the top; Attendees opens its page
            await page.locator('.tp-page .tabs button', { hasText: 'Schedule' }).click();
            await page.waitForTimeout(1200);
            const jumped = await page.evaluate(() => {
                const scroller = document.querySelector('mat-sidenav-content'), tabs = document.querySelector('.tp-page .tabs');
                return { scrolled: scroller.scrollTop > 100, tabsAtTop: Math.abs(tabs.getBoundingClientRect().top - scroller.getBoundingClientRect().top) < 1.5,
                    chosen: document.querySelector('.tp-page .tabs .on')?.textContent.trim(), scheduleInView: document.querySelector('#tp-schedule').getBoundingClientRect().top < innerHeight };
            });
            await page.locator('.tp-page .tabs a').click();
            await quiet();
            const attendeesPage = new URL(page.url()).pathname;
            out.tabs = { ...jumped, attendeesPage };
            check('tournament page: a tab scrolls to its section while the tabs stay at the top, and the Attendees tab opens the Attendees page',
                jumped.scrolled && jumped.tabsAtTop && jumped.chosen === 'Schedule' && jumped.scheduleInView && attendeesPage === base + '/attendees', out.tabs);
            check('tournament page: no script errors', !errors.length, errors);
        });
        await context.close();
    }

    // A phone: one column, one result at a time with a switch between the events
    {
        const { context, page, quiet } = await openPage(browser, () => null, phone, { fonts: true });
        await guarded('phone', async () => {
            await page.goto(appUrl + base);
            await quiet();
            const first = await pageShown(page);
            await page.locator('#tp-results .seg button', { hasText: 'Test Fighter' }).click();
            const second = await pageShown(page);
            out.phone = { chips: first.chips, fits: first.fits, eventColumns: first.eventColumns, first: { results: first.results.map(r => r.name), tabs: first.resultTabs }, second: { results: second.results.map(r => r.name), champion: second.results[0]?.champion, tabs: second.resultTabs } };
            check('tournament page on a phone: one column, nothing wider than the screen, and a switch between the two results',
                first.fits && first.eventColumns === 1 && same(first.chips, ['Completed', '#SO']) && same(out.phone.first, { results: ['Alpha Singles'], tabs: ['Test Bros.*', 'Test Fighter'] })
                && same(out.phone.second, { results: ['Beta Singles'], champion: 'Ivy', tabs: ['Test Bros.', 'Test Fighter*'] }), out.phone);
        });
        await context.close();
    }

    // A small tournament that hasn't started: no results, no streams, one event, nothing to filter
    {
        const { context, page, log, quiet } = await openPage(browser, () => null, wide, { fonts: true });
        await guarded('upcoming', async () => {
            await page.goto(appUrl + '/tournament/tp-upcoming');
            await quiet();
            const shown = await pageShown(page);
            out.upcoming = { requests: count(log), ...shown, sections: await page.locator('#tp-results, #tp-streams').count() };
            check('tournament page: a tournament that has not started says "Upcoming" and has no Results or Streams, and asks for no top 8',
                same(out.upcoming.requests, { total: 1, tournament: 1 }) && same(shown.chips, ['Upcoming', 'Online']) && same(shown.meta, ['December 31, 2099', 'Online']) && same(shown.stats, ['9 Attendees', '1 Event', '1 Game'])
                && out.upcoming.sections === 0 && same(shown.tabs, ['Overview', 'Events 1', 'Attendees 9', 'Schedule', 'Location']), out.upcoming);
            check('tournament page: its one event is a card that says "Not started", with no filters or sort menu',
                same(shown.events.map(e => [e.name, e.note, e.pod.length, e.when]), [['Weekly Singles', 'Not started', 0, 'Thu 7:00 PM']]) && !shown.kinds.length && shown.sort === null && shown.more === null, shown.events);
            check('tournament page: an online tournament shows its times and time zone, and no address',
                ['December 31, 2099', 'Thursday 7:00 PM to 11:00 PM', 'Eastern Standard Time (EST)', 'This tournament is played online.'].every(part => shown.where.includes(part)) && shown.directions === null, shown.where);
        });
        await context.close();
    }

    // A tournament being played: only the finished event has results
    {
        const { context, page, log, quiet } = await openPage(browser, () => null, wide, { fonts: true });
        await guarded('live', async () => {
            await page.goto(appUrl + '/tournament/tp-live');
            await quiet();
            const shown = await pageShown(page);
            out.live = { requests: count(log), asked: log.find(r => r.kind === 'tournamentResults')?.query.match(/event\(id: \d+\)/g), ...shown };
            check('tournament page: a tournament with an event in progress says "Live", and Results has only the finished event',
                shown.chips[0] === 'Live' && same(shown.results.map(r => [r.name, r.champion, r.places]), [['Side Singles', 'Rook', ['2nd Sage', '3rd Tusk', '4th Umbra']]]) && same(out.live.asked, ['event(id: 702)'])
                && same(shown.events.map(e => [e.name, e.note, e.pod.length]), [['Main Singles', 'In progress', 0], ['Side Singles', null, 3]]) && shown.streams[0]?.state === 'Live'
                && shown.where.includes('The Test Hall') && shown.where.includes(ADDRESS), out.live);
        });
        await context.close();
    }

    // start.gg refuses the tournament for its size: the events still show, without their top 3 and phases
    {
        const { context, page, log, quiet } = await openPage(browser, q => tournamentPageKind(q) === null && q.includes('tournament(slug') && q.includes('standings(') ? tooComplex : null, wide);
        await guarded('too complex', async () => {
            await page.goto(appUrl + base);
            await quiet();
            const shown = await pageShown(page);
            out.tooComplex = { requests: count(log), name: shown?.name, events: shown?.events.length, pods: shown?.events.filter(e => e.pod.length || e.note).length, results: shown?.results.length, snack: await page.locator('app-snack-bar').innerText().catch(() => '') };
            check('tournament page: a tournament too big for one request loads again without the top 3 and phases',
                out.tooComplex.requests.tournament === 2 && out.tooComplex.requests.total === 2 && shown.name === 'Showcase Open' && shown.events.length === 8 && out.tooComplex.pods === 0 && shown.results.length === 0
                && !/complexity/i.test(out.tooComplex.snack), out.tooComplex);
        });
        await context.close();
    }

    // The top 8 fails to load: the result cards keep the top 3 they already had
    {
        const { context, page, quiet } = await openPage(browser, q => tournamentPageKind(q) ? { status: 500, body: { message: 'oops' } } : null, wide);
        await guarded('results failed', async () => {
            await page.goto(appUrl + base);
            await quiet();
            const shown = await pageShown(page);
            out.resultsFailed = shown.results.map(r => [r.name, r.champion, r.places]);
            check('tournament page: when the top 8 fails to load, Results still shows each event\'s top 3',
                same(out.resultsFailed, [['Alpha Singles', 'SPN Ace', ['2nd Blaze', '3rd RED Comet']], ['Beta Singles', 'Ivy', ['2nd XY Jinx', '3rd Kite']]]), out.resultsFailed);
        });
        await context.close();
    }

    // The whole page, top to bottom, in both themes: e2e-out/tournament-page/
    {
        const dir = 'e2e-out/tournament-page';
        mkdirSync(dir, { recursive: true });
        const sizes = {
            wide: { viewport: { width: 1600, height: 2300 } },
            desktop: { viewport: { width: 1280, height: 2900 } },
            phone: { ...devices['Pixel 7'], viewport: { width: 412, height: 5200 } },
        };
        const pages = { finished: base, upcoming: '/tournament/tp-upcoming', live: '/tournament/tp-live' };
        out.screenshots = {};
        for (const [pageName, path] of Object.entries(pages)) {
            for (const [size, device] of Object.entries(sizes)) {
                for (const scheme of ['dark', 'light']) {
                    // The finished tournament at every size in both themes; the others in dark at two sizes
                    if (pageName !== 'finished' && (scheme === 'light' || size === 'wide')) continue;
                    const file = `${pageName}-${size}-${scheme}`;
                    const { context, page, quiet } = await openPage(browser, () => null, { ...device, colorScheme: scheme, reducedMotion: 'reduce' }, { fonts: true });
                    try {
                        if (scheme === 'light') await page.addInitScript(() => localStorage.setItem('bgg-theme', 'light'));
                        await page.goto(appUrl + path);
                        await quiet();
                        await page.waitForFunction(() => document.fonts.status === 'loaded', null, { timeout: 15000 }).catch(() => { });
                        await page.waitForTimeout(500);
                        await page.screenshot({ path: `${dir}/${file}.png`, animations: 'disabled' });
                        out.screenshots[file] = 'ok';
                    } catch (e) {
                        out.screenshots[file] = String(e.message).slice(0, 200);
                    }
                    await context.close();
                }
            }
        }
    }
}
