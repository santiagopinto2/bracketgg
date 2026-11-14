// The Attendees page and the attendee dialog, for e2e/api-calls.mjs: what the fake start.gg answers
// to their queries, and the checks.
//
// Two tournaments. "Attendee Open" (att-tourney) has 130 attendees and three events: Solo Cup (120
// singles entrants, seeded, over), Duo Cup (30 two-player teams, being played), and Side Event (12
// entrants in two divisions, so no phase holds them all, not seeded yet). "Test Tourney" is
// api-calls.mjs's own, whose brackets the fake can draw: its four entrants and one spectator are its
// attendees, so a pool link from the dialog can be followed into a bracket.

const svg = (color) => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="${color}"/></svg>`)}`;
const FRIDAY_10AM_PST = 1708106400; // Fri Feb 16 2024, 10:00 in Los Angeles (18:00 UTC)
const HOUR = 3600;

const tourney = {
    id: 2, name: 'Attendee Open', slug: 'tournament/att-tourney', timezone: 'America/Los_Angeles', numAttendees: 130,
    events: [
        { id: 501, name: 'Solo Cup', short: 'solo-cup', type: 1, state: 'COMPLETED', numEntrants: 120,
            phases: [{ id: 5001, name: 'R1 Pools', numSeeds: 120, groupCount: 8 }, { id: 5002, name: 'Top 8', numSeeds: 8, groupCount: 1 }] },
        { id: 502, name: 'Duo Cup', short: 'duo-cup', type: 5, state: 'ACTIVE', numEntrants: 30,
            phases: [{ id: 5003, name: 'Bracket', numSeeds: 30, groupCount: 1 }] },
        { id: 503, name: 'Side Event', short: 'side-event', type: 1, state: 'CREATED', numEntrants: 12,
            phases: [{ id: 5004, name: 'Division A', numSeeds: 6, groupCount: 1 }, { id: 5005, name: 'Division B', numSeeds: 6, groupCount: 1 }] },
    ],
};
const eventSlug = event => `${tourney.slug}/event/${event.short}`;

// The 130 attendees in player id order. Alpha has a sponsor, a picture, every account, and three
// rankings; Bravo only Discord and no picture; Charlie nothing at all, not even a user. Players 1 to
// 120 entered Solo Cup (player 120 is seed 1, Alpha seed 120), 1 to 60 Duo Cup (seed 1 is Alpha and
// Bravo, "The Aces"), and 1 to 12 Side Event. The last ten entered nothing.
const people = Array.from({ length: 130 }, (_, k) => {
    const n = k + 1;
    const person = { n, id: 9000 + n, gamerTag: n === 1 ? 'Alpha' : n === 2 ? 'Bravo' : n === 3 ? 'Charlie' : n > 120 ? `Guest ${n}` : `Player ${n}`, prefix: n === 1 ? 'SPN' : n === 4 ? '' : null,
        rankings: [], user: n === 3 ? null : { images: [], authorizations: [] },
        events: [...(n <= 60 ? [502] : []), ...(n <= 12 ? [503] : []), ...(n <= 120 ? [501] : [])] };
    if (n === 1) {
        person.user = { images: [{ url: svg('#2a7'), width: 40, height: 40 }], authorizations: [
            { type: 'DISCORD', externalUsername: 'alpha.gg', url: null }, { type: 'TWITTER', externalUsername: 'AlphaSSB', url: 'https://twitter.com/AlphaSSB' }, { type: 'TWITCH', externalUsername: 'AlphaTV', url: 'https://twitch.tv/AlphaTV' }] };
        person.rankings = [{ rank: 2, title: 'TestRank: 2025' }, { rank: 1, title: 'Lucky Rank: Active Season' }, { rank: null, title: 'No Rank: 2025' }];
    }
    if (n === 2) person.user.authorizations = [{ type: 'DISCORD', externalUsername: 'bravo#1234', url: null }];
    return person;
});
const soloSeed = person => 121 - person.n;
const duoSeed = person => Math.ceil(person.n / 2);

// Test Tourney's attendees: api-calls.mjs's four entrants (entrant ids 1 to 4, in its event 10) and a spectator
const testPeople = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo'].map((gamerTag, k) => ({ n: k + 1, id: 8001 + k, gamerTag, prefix: k === 0 ? 'SPN' : null, rankings: [],
    user: { images: [], authorizations: [] }, events: k < 4 ? [10] : [] }));

// A participant as the list queries ask for it
const asRow = person => ({ id: person.id, gamerTag: person.gamerTag, prefix: person.prefix, player: { rankings: person.rankings }, user: person.user, events: person.events.map(id => ({ id })) });
const matches = (person, search) => !search || person.gamerTag.toLowerCase().includes(search.toLowerCase());

// What the query asks for, read from its text with the variables written in (api-calls.mjs's withVariables)
const asked = query => ({
    slug: query.match(/tournament\(slug: "([^"]+)"\)/)?.[1],
    page: Number(query.match(/\bpage: (\d+)/)?.[1]),
    perPage: Number(query.match(/\bperPage: (\d+)/)?.[1]),
    search: query.match(/searchString: "([^"]*)"/)?.[1] ?? '',
    eventId: Number(query.match(/eventIds: \[(\d+)\]/)?.[1]) || null,
    phaseId: Number(query.match(/phase\(id: (\d+)\)/)?.[1]),
    participantId: Number(query.match(/participant\(id: (\d+)\)/)?.[1]),
});
const pageOf = (all, { page, perPage }) => ({ pageInfo: { total: all.length }, nodes: all.slice((page - 1) * perPage, page * perPage) });

// The kind of an attendee query, or null for any other
export function attendeeKind(query) {
    if (query.includes('participant(id')) return 'attendeeDetails';
    if (query.includes('participants(query')) return 'attendees';
    if (query.includes('sortBy: "seedNum"')) return 'attendeeSeeds';
    return null;
}

// Attendee Open as the tournament query asks for it, or null for another tournament
export function attendeeTournament(query) {
    if (!query.includes(`tournament(slug: "att-tourney")`)) return null;
    return { data: { tournament: {
        images: [], rules: null, id: tourney.id, name: tourney.name, slug: tourney.slug, venueAddress: null, startAt: FRIDAY_10AM_PST, timezone: tourney.timezone,
        numAttendees: tourney.numAttendees, primaryContact: null, primaryContactType: null,
        events: tourney.events.map(event => ({ id: event.id, name: event.name, slug: eventSlug(event), numEntrants: event.numEntrants, startAt: FRIDAY_10AM_PST, type: event.type, state: event.state,
            videogame: { id: 7, name: 'Test Game', images: [] }, standings: { nodes: [] } })),
    } } };
}

// An Attendee Open event's phases as the event phases query asks for them, or null for another event
export function attendeeEventPhases(query) {
    const event = tourney.events.find(event => query.includes(`event(slug: "${eventSlug(event)}")`));
    if (!event) return null;
    return { data: { event: { id: event.id, name: event.name, type: event.type, phases: event.phases.map(phase => ({ ...phase, progressingInData: [] })) } } };
}

// An attendee's entries in Attendee Open, as the details query asks for them
function entrantsOf(person) {
    const entrants = [];
    // start.gg lists phases in no useful order: here the last one first
    if (person.events.includes(501)) {
        const seed = soloSeed(person), pool = (seed - 1) % 8;
        const seeds = [{ seedNum: seed, phase: { id: 5001, name: 'R1 Pools', groupCount: 8, phaseOrder: 1 }, phaseGroup: { id: 6001 + pool, displayIdentifier: `A${pool + 1}`, startAt: FRIDAY_10AM_PST + 2 * HOUR } }];
        // The top 8 has no start time on start.gg
        if (seed <= 8) seeds.unshift({ seedNum: seed, phase: { id: 5002, name: 'Top 8', groupCount: 1, phaseOrder: 2 }, phaseGroup: { id: 6100, displayIdentifier: '1', startAt: null } });
        entrants.push({ id: 7000 + seed, name: person.prefix ? `${person.prefix} | ${person.gamerTag}` : person.gamerTag, initialSeedNum: seed, event: { id: 501 }, standing: { placement: seed, isFinal: true },
            participants: [{ id: person.id, gamerTag: person.gamerTag }], seeds });
    }
    if (person.events.includes(502)) {
        const seed = duoSeed(person);
        const team = people.filter(other => duoSeed(other) === seed);
        entrants.push({ id: 8000 + seed, name: seed === 1 ? 'The Aces' : team.map(p => p.gamerTag).join(' / '), initialSeedNum: seed, event: { id: 502 }, standing: { placement: seed, isFinal: false },
            participants: team.map(p => ({ id: p.id, gamerTag: p.gamerTag })),
            seeds: [{ seedNum: seed, phase: { id: 5003, name: 'Bracket', groupCount: 1, phaseOrder: 1 }, phaseGroup: { id: 6200, displayIdentifier: '1', startAt: FRIDAY_10AM_PST + 4 * HOUR } }] });
    }
    if (person.events.includes(503)) entrants.push({ id: 8500 + person.n, name: person.gamerTag, initialSeedNum: null, event: { id: 503 }, standing: null, participants: [{ id: person.id, gamerTag: person.gamerTag }], seeds: [] });
    return entrants;
}

// A Test Tourney entrant's entry: 1st of 4, in "Top 4" (one pool, no time on start.gg, listed first)
// and before it in "Three Pools", pool C, Friday 10:00 AM in Los Angeles
const testEntrantsOf = person => person.events.length ? [{ id: person.n, name: person.gamerTag, initialSeedNum: person.n, event: { id: 10 }, standing: { placement: person.n, isFinal: true },
    participants: [{ id: person.id, gamerTag: person.gamerTag }],
    seeds: [{ seedNum: person.n, phase: { id: 1002, name: 'Top 4', groupCount: 1, phaseOrder: 2 }, phaseGroup: { id: 2002, displayIdentifier: '1', startAt: null } },
        { seedNum: person.n, phase: { id: 1005, name: 'Three Pools', groupCount: 3, phaseOrder: 1 }, phaseGroup: { id: 2007, displayIdentifier: 'C', startAt: FRIDAY_10AM_PST } }] }] : [];

export function attendeeAnswer(kind, query) {
    const q = asked(query);
    if (kind === 'attendees') {
        const all = (q.slug === 'att-tourney' ? people : q.slug === 'test-tourney' ? testPeople : []).filter(person => matches(person, q.search) && (!q.eventId || person.events.includes(q.eventId)));
        return { data: { tournament: { participants: pageOf(all.map(asRow), q) } } };
    }
    if (kind === 'attendeeSeeds') {
        // Seeds in seed order; a search's matches in an order of start.gg's own (here: backwards)
        let seeds;
        if (q.phaseId === 5001) seeds = people.filter(p => p.events.includes(501)).map(p => ({ seedNum: soloSeed(p), entrant: { id: 7000 + soloSeed(p) }, team: [p] }));
        else if (q.phaseId === 5003) seeds = Array.from({ length: 30 }, (_, k) => ({ seedNum: k + 1, entrant: { id: 8001 + k }, team: people.filter(p => p.events.includes(502) && duoSeed(p) === k + 1) }));
        else seeds = testPeople.filter(p => p.events.length).map(p => ({ seedNum: p.n, entrant: { id: p.n }, team: [p] }));
        seeds = seeds.filter(seed => seed.team.some(person => matches(person, q.search))).sort((a, b) => a.seedNum - b.seedNum);
        if (q.search) seeds.reverse();
        return { data: { phase: { seeds: pageOf(seeds.map(seed => ({ seedNum: seed.seedNum, entrant: { ...seed.entrant, participants: seed.team.map(asRow) } })), q) } } };
    }
    if (kind === 'attendeeDetails') {
        const person = people.find(p => p.id === q.participantId), testPerson = testPeople.find(p => p.id === q.participantId);
        return { data: { participant: person ? { id: person.id, entrants: entrantsOf(person) } : testPerson ? { id: testPerson.id, entrants: testEntrantsOf(testPerson) } : null } };
    }
    return { errors: [{ message: 'unknown query' }] };
}

const page1 = '/tournament/att-tourney/attendees';

// What the list shows: each row's seed, name, socials, rankings, and events, and the lines around the list
const listShown = page => page.evaluate(() => {
    const text = el => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
    return {
        count: text(document.querySelector('.att-count > span')),
        foot: text(document.querySelector('.att-foot')),
        empty: text(document.querySelector('.att-empty-title')),
        picked: document.querySelector('.att-event select')?.selectedOptions[0]?.textContent.trim(),
        rows: [...document.querySelectorAll('.att-row')].map(row => ({
            seed: row.querySelector('.att-seed') ? text(row.querySelector('.att-seed')) : null,
            name: [text(row.querySelector('.att-sponsor')), text(row.querySelector('.att-tag'))].filter(part => part).join(' | '),
            picture: row.querySelector('.att-avatar img') ? 'picture' : text(row.querySelector('.att-avatar')),
            socials: [...row.querySelectorAll('.att-social')].map(el => `${el.getAttribute('title') ?? el.getAttribute('aria-label')}|${el.getAttribute('href') ?? ''}`),
            rankings: [...row.querySelectorAll('.att-ranking')].map(el => `${text(el)} ${el.querySelector('img') ? el.querySelector('img').getAttribute('src').split('/').pop() : 'trophy'}`),
            events: [...row.querySelectorAll('.att-events a')].map(a => `${text(a)}|${a.getAttribute('href')}`),
            noEvents: text(row.querySelector('.att-no-events')),
        })),
    };
});
const pagesAsked = (log, kind, from = 0) => log.slice(from).filter(r => r.kind === kind).map(r => { const q = asked(r.query); return `${q.page}x${q.perPage}${q.search ? ' "' + q.search + '"' : ''}${q.eventId ? ' event ' + q.eventId : ''}${kind === 'attendeeSeeds' ? ' phase ' + q.phaseId : ''}`; });
const toEnd = page => page.locator('mat-sidenav-content').evaluate(el => el.scrollTo({ top: el.scrollHeight, behavior: 'instant' }));
// The page with nothing more on its way. A scroll, a keystroke or a click asks start.gg a moment
// later (the search box waits for the typing to stop), so this gives the request time to start first.
const whenIdle = (page, idle) => async ms => { await page.waitForTimeout(700); return idle(ms); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// What the open dialog shows
const dialogShown = page => page.evaluate(() => {
    const text = el => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
    const dialog = document.querySelector('app-attendee-dialog');
    if (!dialog) return null;
    return {
        name: [text(dialog.querySelector('.dlg-sponsor')), text(dialog.querySelector('.dlg-tag'))].filter(part => part).join(' | '),
        picture: dialog.querySelector('.dlg-avatar img') ? 'picture' : text(dialog.querySelector('.dlg-avatar')),
        pills: [...dialog.querySelectorAll('.dlg-pill')].map(el => `${text(el)}|${el.getAttribute('href') ?? ''}`),
        ranks: [...dialog.querySelectorAll('.dlg-rank')].map(text),
        heading: text(dialog.querySelector('.dlg-section')),
        none: text(dialog.querySelector('.dlg-none')),
        entries: [...dialog.querySelectorAll('.dlg-entry')].map(entry => ({
            event: `${text(entry.querySelector('.dlg-entry-name')).replace(/\s*chevron_right$/, '')}|${entry.querySelector('.dlg-entry-name').getAttribute('href')}`,
            team: text(entry.querySelector('.dlg-team > span')),
            seed: [...entry.querySelectorAll('.dlg-entry-sub > span')].map(text).filter(part => part).join(' · '),
            place: [...entry.querySelectorAll('.dlg-place > *')].map(text).join(' '),
            state: text(entry.querySelector('.dlg-state')),
            phases: [...entry.querySelectorAll('.dlg-phase')].map(phase => [text(phase.querySelector('.dlg-phase-name')), text(phase.querySelector('.dlg-pool')), text(phase.querySelector('.dlg-phase-time')), phase.getAttribute('href')]),
            note: text(entry.querySelector('.dlg-note')),
        })),
    };
});
const openRow = async (page, quiet, tag) => {
    await page.locator('.att-row', { has: page.locator('.att-tag', { hasText: new RegExp(`^\\s*${tag}\\s*$`) }) }).first().locator('.att-name').click();
    await page.locator('app-attendee-dialog').waitFor({ timeout: 5000 });
    await quiet(600);
};
const closeDialog = async page => {
    await page.locator('.dlg-close').click();
    await page.locator('app-attendee-dialog').waitFor({ state: 'detached', timeout: 5000 });
};

export async function attendeeChecks({ browser, openPage, appUrl, eventPath, check, report, count, devices }) {
    report.attendees = {};
    const out = report.attendees;
    const guarded = async (name, run) => {
        try {
            await run();
        } catch (e) {
            out[`${name} crashed`] = String(e.message).slice(0, 400);
            check(`attendees: ${name}`, false, out[`${name} crashed`]);
        }
    };

    // The list: order, endless scroll, search, the event filter
    {
        const { context, page, log, quiet: idle } = await openPage(browser, () => null, { viewport: { width: 1280, height: 900 } });
        const quiet = whenIdle(page, idle);
        const errors = [];
        page.on('pageerror', e => errors.push(String(e.message).slice(0, 200)));
        await guarded('list', async () => {
            await page.goto(appUrl + page1);
            await quiet();
            const first = await listShown(page);
            out.first = { ...first, rows: first.rows.slice(0, 4), rowCount: first.rows.length, requests: count(log), pages: pagesAsked(log, 'attendees') };
            check('attendees: the page opens with the first 50 in player id order and the tournament\'s count, from one tournament and one list request',
                first.count === '130 attendees' && first.rows.length === 50 && same(first.rows.slice(0, 4).map(r => r.name), ['SPN | Alpha', 'Bravo', 'Charlie', 'Player 4'])
                && first.foot === 'Showing 50 of 130' && first.picked === 'All events' && first.rows.every(r => r.seed === null)
                && out.first.requests.tournament === 1 && same(out.first.pages, ['1x50']) && out.first.requests.total === 2, out.first);
            const [alpha, bravo, charlie] = first.rows;
            check('attendees: a row shows the picture or a colored initial, the sponsor and tag, the accounts (Twitch, X, Discord), the rankings with their logos, and the events entered as links, by name',
                alpha.picture === 'picture' && bravo.picture === 'B' && charlie.picture === 'C'
                && same(alpha.socials, ['Twitch: AlphaTV|https://twitch.tv/AlphaTV', 'X: AlphaSSB|https://twitter.com/AlphaSSB', 'Discord: alpha.gg, copy|'])
                && same(alpha.rankings, ['2 trophy', '1 lucky-rank.webp']) && same(bravo.socials, ['Discord: bravo#1234, copy|']) && !bravo.rankings.length && !charlie.socials.length
                && same(alpha.events, ['Duo Cup|/tournament/att-tourney/event/duo-cup', 'Side Event|/tournament/att-tourney/event/side-event', 'Solo Cup|/tournament/att-tourney/event/solo-cup'])
                && same(first.rows[49].events, ['Duo Cup|/tournament/att-tourney/event/duo-cup', 'Solo Cup|/tournament/att-tourney/event/solo-cup']), { alpha, bravo, charlie, last: first.rows[49] });
            await page.screenshot({ path: 'e2e-out/attendees.png' }).catch(() => { });

            // Endless scroll: 50 more each time the end comes into view
            let mark = log.length;
            await toEnd(page);
            await quiet();
            const second = await listShown(page);
            await toEnd(page);
            await quiet();
            const third = await listShown(page);
            await toEnd(page);
            await quiet();
            out.scroll = { rows: [second.rows.length, third.rows.length], foots: [second.foot, third.foot], pages: pagesAsked(log, 'attendees', mark), last: third.rows.at(-1), sentinel: await page.locator('.att-sentinel').count() };
            check('attendees: scrolling to the end loads the next 50, one request each, until all are shown; an attendee with no events says so',
                same(out.scroll.rows, [100, 130]) && same(out.scroll.foots, ['Showing 100 of 130', 'All 130 shown']) && same(out.scroll.pages, ['2x50', '3x50'])
                && out.scroll.last.name === 'Guest 130' && out.scroll.last.noEvents === 'No events' && !out.scroll.last.events.length && out.scroll.sentinel === 0, out.scroll);

            // Search: start.gg is asked once the typing stops
            mark = log.length;
            await page.locator('.att-search input').pressSequentially('player 11', { delay: 20 });
            await quiet();
            const found = await listShown(page);
            const scrolledUp = await page.locator('mat-sidenav-content').evaluate(el => el.scrollTop);
            out.search = { count: found.count, names: found.rows.map(r => r.name), foot: found.foot, pages: pagesAsked(log, 'attendees', mark), scrolledUp };
            check('attendees: the search box asks start.gg once after the typing stops, and the count and list follow',
                found.count === '11 attendees match "player 11"' && same(out.search.names, ['Player 11', ...Array.from({ length: 10 }, (_, k) => `Player ${110 + k}`)])
                && found.foot === 'All 11 shown' && same(out.search.pages, ['1x50 "player 11"']) && scrolledUp === 0, out.search);

            await page.locator('.att-search input').fill('zzz');
            await quiet();
            const nothing = await listShown(page);
            const buttons = await page.locator('.att-button').allInnerTexts();
            await page.locator('.att-button', { hasText: 'Clear search' }).click();
            await quiet();
            const cleared = await listShown(page);
            out.noResults = { count: nothing.count, empty: nothing.empty, rows: nothing.rows.length, buttons, after: { count: cleared.count, rows: cleared.rows.length, box: await page.locator('.att-search input').inputValue() } };
            check('attendees: a search with no matches says so, and "Clear search" brings the list back',
                nothing.count === '0 attendees match "zzz"' && nothing.empty === 'No attendees match "zzz"' && !nothing.rows.length && same(buttons, ['Clear search'])
                && cleared.count === '130 attendees' && cleared.rows.length === 50 && out.noResults.after.box === '', out.noResults);

            // One event: its seed order, from the seeds of the phase that holds every entrant
            mark = log.length;
            await page.locator('.att-event select').selectOption({ label: 'Solo Cup' });
            await quiet();
            const solo = await listShown(page);
            out.solo = { url: new URL(page.url()).pathname + new URL(page.url()).search, count: solo.count, rows: solo.rows.slice(0, 3), rowCount: solo.rows.length, foot: solo.foot, requests: count(log, mark), pages: pagesAsked(log, 'attendeeSeeds', mark) };
            check('attendees: picking an event lists its entrants in seed order with their seeds, counts them, and puts the event in the address',
                out.solo.url === page1 + '?event=solo-cup' && solo.count === '120 attendees in Solo Cup, in seed order' && solo.rows.length === 50
                && same(solo.rows.slice(0, 3).map(r => `${r.seed} ${r.name}`), ['1 Player 120', '2 Player 119', '3 Player 118']) && solo.foot === 'Showing 50 of 120'
                && out.solo.requests.eventPhases === 1 && same(out.solo.pages, ['1x50 phase 5001']) && out.solo.requests.total === 2, out.solo);

            mark = log.length;
            await page.locator('.att-search input').fill('player 11');
            await quiet();
            const soloFound = await listShown(page);
            out.soloSearch = { count: soloFound.count, rows: soloFound.rows.map(r => `${r.seed} ${r.name}`), pages: pagesAsked(log, 'attendeeSeeds', mark) };
            check('attendees: a search inside an event keeps the seeds, in seed order when the matches fit one page',
                soloFound.count === '11 attendees match "player 11" in Solo Cup' && same(out.soloSearch.rows, [...Array.from({ length: 10 }, (_, k) => `${2 + k} Player ${119 - k}`), '110 Player 11'])
                && same(out.soloSearch.pages, ['1x50 "player 11" phase 5001']), out.soloSearch);
            await page.locator('.att-search input').fill('zzz');
            await quiet();
            const soloNothing = { empty: (await listShown(page)).empty, buttons: await page.locator('.att-button').allInnerTexts() };
            await page.locator('.att-button', { hasText: 'Search all events' }).click();
            await quiet();
            const allEvents = await listShown(page);
            out.soloNoResults = { ...soloNothing, after: { url: new URL(page.url()).search, count: allEvents.count, picked: allEvents.picked } };
            check('attendees: no matches inside an event offers "Search all events"',
                soloNothing.empty === 'No attendees match "zzz" in Solo Cup' && same(soloNothing.buttons, ['Clear search', 'Search all events'])
                && out.soloNoResults.after.url === '' && allEvents.count === '0 attendees match "zzz"' && allEvents.picked === 'All events', out.soloNoResults);
            await page.locator('.att-button', { hasText: 'Clear search' }).click();
            await quiet();

            // A teams event: its teams in seed order, a row per player
            mark = log.length;
            await page.locator('.att-event select').selectOption({ label: 'Duo Cup' });
            await quiet();
            const duo = await listShown(page);
            out.duo = { count: duo.count, rows: duo.rows.slice(0, 4).map(r => `${r.seed} ${r.name}`), rowCount: duo.rows.length, foot: duo.foot, pages: pagesAsked(log, 'attendeeSeeds', mark) };
            check('attendees: a teams event counts its teams and lists them in seed order, a row per player, 25 teams a request',
                duo.count === '30 teams in Duo Cup, in seed order' && same(out.duo.rows, ['1 SPN | Alpha', '1 Bravo', '2 Charlie', '2 Player 4']) && duo.rows.length === 50
                && duo.foot === 'Showing 25 of 30 teams' && same(out.duo.pages, ['1x25 phase 5003']), out.duo);
            await toEnd(page);
            await quiet();
            const duoAll = await listShown(page);
            out.duo.all = { rows: duoAll.rows.length, foot: duoAll.foot, pages: pagesAsked(log, 'attendeeSeeds', mark) };
            check('attendees: the rest of a teams event loads on scroll', duoAll.rows.length === 60 && duoAll.foot === 'All 30 shown' && same(out.duo.all.pages, ['1x25 phase 5003', '2x25 phase 5003']), out.duo.all);

            // An event no phase holds all of: its attendees from the tournament's list, without seeds
            mark = log.length;
            await page.locator('.att-event select').selectOption({ label: 'Side Event' });
            await quiet();
            const side = await listShown(page);
            out.side = { count: side.count, rows: side.rows.slice(0, 2).map(r => `${r.seed} ${r.name}`), rowCount: side.rows.length, foot: side.foot, attendees: pagesAsked(log, 'attendees', mark), seeds: pagesAsked(log, 'attendeeSeeds', mark) };
            check('attendees: an event split into divisions lists its attendees in player id order, without seeds',
                side.count === '12 attendees in Side Event' && same(out.side.rows, ['null SPN | Alpha', 'null Bravo']) && side.rows.length === 12 && side.foot === 'All 12 shown'
                && same(out.side.attendees, ['1x50 event 503']) && !out.side.seeds.length, out.side);
            check('attendees: no script errors on the list', !errors.length, errors);
        });
        await context.close();
    }

    // A page start.gg refuses for its size is asked for again, smaller
    {
        let refused = 0;
        const { context, page, log, quiet: idle } = await openPage(browser, query => attendeeKind(query) === 'attendeeSeeds' && asked(query).perPage > 20 && ++refused
            ? { body: { errors: [{ message: 'Your query complexity is too high. A maximum of 1000 objects may be returned by each request. (actual: 1400)' }] } } : null, { viewport: { width: 1280, height: 900 } });
        const quiet = whenIdle(page, idle);
        await guarded('too complex', async () => {
            await page.goto(appUrl + page1 + '?event=duo-cup');
            await quiet();
            const first = await listShown(page);
            await toEnd(page);
            await quiet();
            const all = await listShown(page);
            out.tooComplex = { refused, picked: first.picked, count: first.count, rows: [first.rows.length, all.rows.length], seeds: all.rows.map(r => r.seed).join(), foot: all.foot, pages: pagesAsked(log, 'attendeeSeeds') };
            check('attendees: a refused page shrinks to fit and the list goes on from where it was, with every team once; the address picks the event',
                refused === 1 && first.picked === 'Duo Cup' && first.count === '30 teams in Duo Cup, in seed order' && same(out.tooComplex.rows, [34, 60])
                && out.tooComplex.seeds === Array.from({ length: 30 }, (_, k) => `${k + 1},${k + 1}`).join() && all.foot === 'All 30 shown'
                && same(out.tooComplex.pages, ['1x25 phase 5003', '1x17 phase 5003', '2x17 phase 5003']), out.tooComplex);
        });
        await context.close();
    }

    // The dialog
    {
        const { context, page, log, quiet: idle } = await openPage(browser, () => null, { viewport: { width: 1280, height: 900 }, timezoneId: 'Europe/Berlin' }, { fonts: true });
        const quiet = whenIdle(page, idle);
        const errors = [];
        page.on('pageerror', e => errors.push(String(e.message).slice(0, 200)));
        await guarded('dialog', async () => {
            await page.goto(appUrl + page1);
            await quiet();
            let mark = log.length;
            await openRow(page, quiet, 'Alpha');
            const alpha = await dialogShown(page);
            const box = await page.locator('.mat-mdc-dialog-surface').evaluate(el => { const r = el.getBoundingClientRect(); return { width: Math.round(r.width), centered: Math.abs((r.left + r.right) / 2 - innerWidth / 2) < 2, radius: getComputedStyle(el).borderTopLeftRadius }; });
            out.dialog = { alpha, box, requests: count(log, mark) };
            await page.screenshot({ path: 'e2e-out/attendee-dialog.png' }).catch(() => { });
            const want = [
                // Being played: a state, no placement. The team has a name of its own.
                { event: 'Duo Cup|/tournament/att-tourney/event/duo-cup', team: 'The Aces, with Bravo', seed: 'Seed 1 · 30 teams', place: '', state: 'In Progress',
                    phases: [['Bracket', '', 'Fri 2:00 PM PST', '/tournament/att-tourney/event/duo-cup/brackets/5003/6200?player=8001']], note: '' },
                // Not seeded yet
                { event: 'Side Event|/tournament/att-tourney/event/side-event', team: '', seed: '', place: '', state: 'Upcoming', phases: [],
                    note: 'Not seeded yet. The seed and pools show here once the organizers publish them.' },
                // Over: the final placement
                { event: 'Solo Cup|/tournament/att-tourney/event/solo-cup', team: '', seed: 'Seed 120 · 120 entrants', place: '120th of 120', state: '',
                    phases: [['R1 Pools', 'Pool A8', 'Fri 12:00 PM PST', '/tournament/att-tourney/event/solo-cup/brackets/5001/6008?player=7120']], note: '' },
            ];
            check('attendee dialog: the row\'s info, then a block per event by name with the team, the seed, and the placement or state, then each phase with its pool and start time in the tournament\'s time zone, from one request',
                alpha.name === 'SPN | Alpha' && alpha.picture === 'picture' && same(alpha.pills, ['AlphaTV|https://twitch.tv/AlphaTV', 'AlphaSSB|https://twitter.com/AlphaSSB', 'alpha.gg|'])
                && same(alpha.ranks, ['2TestRank: 2025', '1Lucky Rank: Active Season']) && alpha.heading === 'Events' && same(alpha.entries, want)
                && same(out.dialog.requests, { total: 1, attendeeDetails: 1 }) && box.width === 600 && box.centered && box.radius === '12px', out.dialog);

            // Opening the same attendee again asks nothing
            await closeDialog(page);
            mark = log.length;
            await openRow(page, quiet, 'Alpha');
            const again = await dialogShown(page);
            out.dialog.again = { same: same(again, alpha), requests: count(log, mark) };
            check('attendee dialog: opening an attendee again reuses their details', out.dialog.again.same && out.dialog.again.requests.total === 0, out.dialog.again);
            await closeDialog(page);

            // A top 8 player: the phase with no time on start.gg comes after the one before it, and shows none
            await page.locator('.att-event select').selectOption({ label: 'Solo Cup' });
            await quiet();
            await openRow(page, quiet, 'Player 120');
            const top = await dialogShown(page);
            out.dialog.top = top.entries.find(entry => entry.event.startsWith('Solo Cup'));
            check('attendee dialog: phases are in the order they are played, and a pool with no time on start.gg shows none',
                out.dialog.top?.place === '1st of 120' && same(out.dialog.top.phases, [['R1 Pools', 'Pool A1', 'Fri 12:00 PM PST', '/tournament/att-tourney/event/solo-cup/brackets/5001/6001?player=7001'],
                    ['Top 8', '', '', '/tournament/att-tourney/event/solo-cup/brackets/5002/6100?player=7001']]), out.dialog.top);
            const placeColor = await page.locator('.dlg-place-num').first().evaluate(el => getComputedStyle(el).color);
            await closeDialog(page);

            // An attendee with no events: nothing to load
            await page.locator('.att-event select').selectOption({ label: 'All events' });
            await page.locator('.att-search input').fill('guest 130');
            await quiet();
            mark = log.length;
            await openRow(page, quiet, 'Guest 130');
            const guest = await dialogShown(page);
            out.dialog.guest = { name: guest.name, picture: guest.picture, heading: guest.heading, none: guest.none, entries: guest.entries.length, requests: count(log, mark) };
            check('attendee dialog: an attendee with no events says so and asks start.gg nothing',
                guest.name === 'Guest 130' && guest.picture === 'G' && guest.heading === 'Events' && guest.none === 'Registered for Attendee Open without entering an event.' && !guest.entries.length && out.dialog.guest.requests.total === 0, out.dialog.guest);

            // Both themes
            const colors = () => page.evaluate(() => { const style = selector => getComputedStyle(document.querySelector(selector)); return { list: style('.att-list').backgroundColor, row: style('.att-tag').color, dialog: style('.mat-mdc-dialog-surface').backgroundColor, dialogText: style('.dlg-tag').color, field: style('.att-field').backgroundColor }; });
            const dark = await colors();
            await page.keyboard.press('Escape');
            await page.locator('app-attendee-dialog').waitFor({ state: 'detached', timeout: 5000 });
            await page.locator('.theme-toggle').click();
            await openRow(page, quiet, 'Guest 130');
            const light = await colors();
            await page.screenshot({ path: 'e2e-out/attendee-dialog-light.png' }).catch(() => { });
            await closeDialog(page);
            await page.locator('.theme-toggle').click();
            out.themes = { dark, light, placeColor };
            check('attendees: the list and the dialog take the theme\'s colors, dark and light',
                same(dark, { list: 'rgb(63, 63, 63)', row: 'rgb(255, 255, 255)', dialog: 'rgb(66, 66, 66)', dialogText: 'rgb(255, 255, 255)', field: 'rgb(63, 63, 63)' })
                && same(light, { list: 'rgb(255, 255, 255)', row: 'rgb(28, 30, 33)', dialog: 'rgb(255, 255, 255)', dialogText: 'rgb(28, 30, 33)', field: 'rgb(255, 255, 255)' })
                && placeColor === 'rgb(255, 215, 0)', out.themes);
            check('attendees: no script errors with the dialog', !errors.length, errors);
        });
        await context.close();
    }

    // The links to the page, and from the dialog into a bracket
    {
        const { context, page, log, quiet: idle } = await openPage(browser, () => null, { viewport: { width: 1280, height: 900 } });
        const quiet = whenIdle(page, idle);
        const errors = [];
        page.on('pageerror', e => errors.push(String(e.message).slice(0, 200)));
        const at = () => { const url = new URL(page.url()); return url.pathname + url.search; };
        await guarded('links', async () => {
            // The tournament page: the sidebar's link with the count, and the count beside the date
            await page.goto(appUrl + '/tournament/test-tourney');
            await quiet();
            const side = await page.locator('mat-sidenav .attendees-link').evaluate(el => {
                const text = selector => el.querySelector(selector)?.textContent.trim();
                const count = el.querySelector('.attendees-count').getBoundingClientRect(), label = el.querySelector('.attendees-text').getBoundingClientRect(), item = el.getBoundingClientRect();
                const home = document.querySelector('mat-sidenav .home-section').getBoundingClientRect(), firstEvent = [...document.querySelectorAll('mat-sidenav a[mat-list-item]')].find(a => a.textContent.includes('Test Event')).getBoundingClientRect();
                return { text: text('.attendees-text'), count: text('.attendees-count'), href: el.getAttribute('href'), countRight: count.left > label.left + 60 && count.right <= item.right && count.right >= item.right - 24,
                    countSmaller: parseFloat(getComputedStyle(el.querySelector('.attendees-count')).fontSize) < parseFloat(getComputedStyle(el.querySelector('.attendees-text')).fontSize),
                    countColor: getComputedStyle(el.querySelector('.attendees-count')).color, underHome: item.top >= home.bottom - 1 && item.bottom <= firstEvent.top, active: el.classList.contains('attendees-active') };
            });
            const meta = await page.locator('.meta-row a.attendees-link').evaluate(el => ({ text: el.textContent.trim(), href: el.getAttribute('href') }));
            await page.locator('.meta-row a.attendees-link').click();
            await quiet();
            const list = await listShown(page);
            const active = await page.locator('mat-sidenav .attendees-link').evaluate(el => el.classList.contains('attendees-active'));
            out.links = { side, meta, at: at(), count: list.count, names: list.rows.map(r => r.name), back: await page.locator('.back-link').getAttribute('href'), active };
            check('attendees: the sidebar has "Attendees" under Home with the tournament\'s count small and dim on the right, and the tournament page\'s count links to the page',
                side.text === 'Attendees' && side.count === '5' && side.href === '/tournament/test-tourney/attendees' && side.countRight && side.countSmaller && side.countColor === 'rgb(169, 169, 169)' && side.underHome && !side.active
                && meta.text === '5 attendees' && meta.href === '/tournament/test-tourney/attendees' && out.links.at === '/tournament/test-tourney/attendees' && list.count === '5 attendees'
                && same(out.links.names, ['SPN | Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo']) && out.links.back === '/tournament/test-tourney' && active, out.links);

            // The event page's entrant count opens the page with that event picked
            await page.goto(appUrl + '/tournament/test-tourney/event/test-event');
            await quiet();
            const entrantsLink = await page.locator('.event-header a.entrants-link').evaluate(el => ({ text: el.textContent.trim(), href: el.getAttribute('href') }));
            await page.locator('.event-header a.entrants-link').click();
            await quiet();
            const picked = await listShown(page);
            out.eventLink = { entrantsLink, at: at(), picked: picked.picked, count: picked.count, rows: picked.rows.map(r => `${r.seed} ${r.name}`) };
            check('attendees: an event page\'s entrant count opens the page with that event picked, in seed order',
                entrantsLink.text === '60 entrants' && entrantsLink.href === '/tournament/test-tourney/attendees?event=test-event' && out.eventLink.at === '/tournament/test-tourney/attendees?event=test-event'
                && picked.picked === 'Test Event' && picked.count === '4 attendees in Test Event, in seed order' && same(out.eventLink.rows, ['1 SPN | Alpha', '2 Bravo', '3 Charlie', '4 Delta']), out.eventLink);

            // The dialog's links: the event's name to its page, a pool to its phase at that pool with the player's first set outlined
            await openRow(page, quiet, 'Bravo');
            const bravo = await dialogShown(page);
            out.poolLink = { entries: bravo.entries };
            const mark = log.length;
            await page.locator('.dlg-phase', { hasText: 'Three Pools' }).click();
            // The outline fades after a few seconds, so it is read as soon as it shows
            for (const start = Date.now(); Date.now() - start < 15000; await page.waitForTimeout(100)) if (await page.locator('.set-arrived').count()) break;
            const arrived = await page.evaluate(() => {
                const set = document.querySelector('.set-arrived');
                if (!set) return null;
                const view = document.querySelector('mat-sidenav-content').getBoundingClientRect(), r = set.getBoundingClientRect();
                return { pool: set.closest('[data-pool-index]')?.id, names: [...set.querySelectorAll('.set-tag')].map(el => el.textContent.trim()), inView: r.top >= view.top && r.bottom <= view.bottom,
                    outline: getComputedStyle(set).boxShadow !== 'none' };
            });
            await quiet();
            Object.assign(out.poolLink, { at: at(), arrived, dialogOpen: await page.locator('app-attendee-dialog').count(), firstPool: log.slice(mark).find(r => r.kind === 'poolSlices')?.query.match(/phaseGroup\(id: "?(\d+)/)?.[1] });
            check('attendee dialog: a pool opens its phase at that pool, loaded first, scrolled to, and with the player\'s first set there outlined',
                same(bravo.entries, [{ event: 'Test Event|/tournament/test-tourney/event/test-event', team: '', seed: 'Seed 2 · 4 entrants', place: '2nd of 4', state: '',
                    phases: [['Three Pools', 'Pool C', 'Fri 10:00 AM PST', eventPath + '/1005/2007?player=2'], ['Top 4', '', '', eventPath + '/1002/2002?player=2']], note: '' }])
                && out.poolLink.at === eventPath + '/1005/2007?player=2' && arrived?.pool === 'pool-2007' && arrived.names.includes('Bravo') && arrived.inView && arrived.outline
                && out.poolLink.dialogOpen === 0 && out.poolLink.firstPool === '2007', out.poolLink);
            await page.screenshot({ path: 'e2e-out/attendee-pool-link.png' }).catch(() => { });

            // Back returns to the Attendees page with the event still picked
            await page.goBack();
            await quiet();
            const back = await listShown(page);
            await openRow(page, quiet, 'Alpha');
            await page.locator('.dlg-entry-name').click();
            await quiet();
            out.backAndEvent = { back: { picked: back.picked, rows: back.rows.length }, eventPage: at(), dialogOpen: await page.locator('app-attendee-dialog').count() };
            check('attendee dialog: back from the bracket returns to the list with its event picked, and the event\'s name opens its page',
                back.picked === 'Test Event' && back.rows.length === 4 && out.backAndEvent.eventPage === '/tournament/test-tourney/event/test-event' && out.backAndEvent.dialogOpen === 0, out.backAndEvent);
            check('attendees: no script errors following the links', !errors.length, errors);
        });
        await context.close();
    }

    // A phone: the events go under the name, the dialog is a sheet from the bottom, the link is in the menu
    {
        const { context, page, quiet: idle } = await openPage(browser, () => null, devices['Pixel 7'], { fonts: true });
        const quiet = whenIdle(page, idle);
        await guarded('phone', async () => {
            await page.goto(appUrl + page1);
            await quiet();
            const layout = await page.evaluate(() => {
                const row = document.querySelector('.att-row');
                const who = row.querySelector('.att-who').getBoundingClientRect(), events = row.querySelector('.att-events a').getBoundingClientRect(), avatar = row.querySelector('.att-avatar').getBoundingClientRect();
                const controls = document.querySelector('.att-controls').getBoundingClientRect(), search = document.querySelector('.att-search').getBoundingClientRect(), picker = document.querySelector('.att-event').getBoundingClientRect();
                const social = row.querySelector('.att-social').getBoundingClientRect();
                return { eventsUnderName: events.top >= who.bottom - 1 && Math.abs(events.left - who.left) < 2, pictureLeft: avatar.right <= who.left, fits: document.documentElement.scrollWidth <= innerWidth,
                    controlsFit: search.left >= 0 && picker.right <= innerWidth && Math.abs(search.top - picker.top) < 2 && controls.width <= innerWidth, thumb: Math.round(social.height) >= 26,
                    sidebarOpen: document.querySelector('mat-sidenav').classList.contains('mat-drawer-opened') };
            });
            await page.screenshot({ path: 'e2e-out/attendees-phone.png' }).catch(() => { });
            // The controls stay at the top while the list scrolls
            await page.locator('mat-sidenav-content').evaluate(el => el.scrollTo({ top: 600, behavior: 'instant' }));
            await page.waitForTimeout(300);
            const stuck = await page.evaluate(() => Math.round(document.querySelector('.att-controls').getBoundingClientRect().top - document.querySelector('mat-sidenav-content').getBoundingClientRect().top));
            await page.locator('mat-sidenav-content').evaluate(el => el.scrollTo({ top: 0, behavior: 'instant' }));
            await openRow(page, quiet, 'Alpha');
            await page.waitForTimeout(600);
            const sheet = await page.locator('.mat-mdc-dialog-surface').evaluate(el => {
                const r = el.getBoundingClientRect(), body = document.querySelector('.dlg-body');
                return { atBottom: Math.abs(r.bottom - innerHeight) < 2, fullWidth: Math.round(r.left) === 0 && Math.round(r.width) === innerWidth, under90: r.height <= innerHeight * 0.9 + 1, radius: getComputedStyle(el).borderTopLeftRadius,
                    grab: getComputedStyle(document.querySelector('.dlg-grab')).display, entries: document.querySelectorAll('.dlg-entry').length, bodyScrolls: body.scrollHeight >= body.clientHeight, bodyInside: body.getBoundingClientRect().bottom <= r.bottom + 1 };
            });
            await page.screenshot({ path: 'e2e-out/attendee-dialog-phone.png' }).catch(() => { });
            await closeDialog(page);
            await page.locator('mat-toolbar button:has(mat-icon:text("menu"))').click();
            await page.waitForTimeout(700);
            const menu = await page.locator('mat-sidenav .attendees-link').evaluate(el => ({ text: el.querySelector('.attendees-text').textContent.trim(), count: el.querySelector('.attendees-count').textContent.trim(), visible: el.getBoundingClientRect().width > 0 }));
            out.phone = { layout, stuck, sheet, menu };
            check('attendees on a phone: the events go under the name, the page fits the screen, the search and filter stay at the top, the dialog is a sheet from the bottom, and the link is in the menu',
                layout.eventsUnderName && layout.pictureLeft && layout.fits && layout.controlsFit && layout.thumb && !layout.sidebarOpen && stuck === 0
                && sheet.atBottom && sheet.fullWidth && sheet.under90 && sheet.radius === '18px' && sheet.grab === 'block' && sheet.entries === 3 && sheet.bodyInside
                && menu.text === 'Attendees' && menu.count === '130' && menu.visible, out.phone);
        });
        await context.close();
    }
}
