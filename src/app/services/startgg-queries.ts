// Every query the app sends to start.gg, as fixed texts with GraphQL variables for slugs, ids and pages.
//
// The site's server (server/gql-allowlist.js) loads this file too and runs only these exact texts, so
// a visitor's request can't make it ask start.gg for anything else. Keep this file free of imports and
// of TypeScript that Node's type stripping can't read (enums, namespaces, parameter properties).

// Sets asked for per entrant in the landing page's top 8, to find who they lost to
export const SETS_PER_STANDING = 50;

// The most sets one scores request looks up (setScoresQuery)
export const MAX_SET_SCORES = 100;

export const tournamentQuery = `query Tournament($slug: String!) {
                tournament(slug: $slug) {
                    images {
                        url
                        type
                    }
                    rules
                    id
                    name
                    slug
                    venueAddress
                    startAt
                    timezone
                    numAttendees
                    primaryContact
                    primaryContactType
                    events {
                        id
                        name
                        slug
                        numEntrants
                        startAt
                        type
                        state
                        videogame {
                            id
                            name
                            images {
                                url
                                type
                            }
                        }
                        standings(query: {
                            page: 1
                            perPage: 3
                        }) {
                            nodes {
                                placement
                                entrant {
                                    name
                                    participants {
                                        id
                                        user {
                                            images(type: "profile") {
                                                url
                                                width
                                                height
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }`;

// What a bracket page needs to know of its event: about 10 objects. `progressingInData` names the
// phases each phase takes players from, and how many (one object per phase it names). It tells which
// later phases a phase sends players on to; start.gg fills it in before the event starts (checked 2026-11-13).
export const eventPhasesQuery = `query EventPhases($slug: String!) {
                event(slug: $slug) {
                    id
                    name
                    type
                    phases {
                        id
                        name
                        numSeeds
                        groupCount
                        progressingInData {
                            origin
                            numProgressing
                        }
                    }
                }
            }`;

// One page of a phase's seeds with where each comes from: the pool of an earlier phase, and the
// placement there, that fills it (`progressionSource`), the pool of this phase it plays in, and the
// entrant once start.gg has placed one. The bracket view asks this of the phases that take players
// from the shown phase, to draw the tags that say where a pool's players go next. 4 objects per seed
// (Genesis X R2 Pools: 240 seeds cost 961, the other 144 cost 577; measured 2026-11-13).
export const phaseProgressionsQuery = `query PhaseProgressions($phaseId: ID!, $page: Int!, $perPage: Int!) {
                phase(id: $phaseId) {
                    seeds(query: {
                        page: $page
                        perPage: $perPage
                    }) {
                        nodes {
                            entrant {
                                id
                            }
                            phaseGroup {
                                id
                                displayIdentifier
                            }
                            progressionSource {
                                originPlacement
                                originOrder
                                originPhaseGroup {
                                    id
                                }
                            }
                        }
                    }
                }
            }`;

// One page of a bracket phase's players with their profile pictures, for the bracket view. About 3
// of start.gg's objects per player, 5 per two-player team (300 cost 901 and 1501, measured
// 2026-11-13); pictures don't count.
export const phaseEntrantsQuery = `query PhaseEntrants($phaseId: ID!, $page: Int!, $perPage: Int!) {
                phase(id: $phaseId) {
                    seeds(query: {
                        page: $page
                        perPage: $perPage
                    }) {
                        nodes {
                            entrant {
                                id
                                participants {
                                    gamerTag
                                    user {
                                        images(type: "profile") {
                                            url
                                            width
                                            height
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }`;

// What a row of the Attendees page shows of one attendee: tag, sponsor, picture, linked accounts,
// rankings (of any game), and the ids of the events they entered. Nothing of their seeds or pools:
// those cost 25 to 35 objects per attendee and load for one attendee at a time (attendeeDetailsQuery).
const attendeeFields = `id
                            gamerTag
                            prefix
                            player {
                                rankings(limit: 3) {
                                    rank
                                    title
                                }
                            }
                            user {
                                images(type: "profile") {
                                    url
                                    width
                                    height
                                }
                                authorizations(types: [TWITTER, TWITCH, DISCORD]) {
                                    type
                                    externalUsername
                                    url
                                }
                            }
                            events {
                                id
                            }`;

// One page of a tournament's attendees in player id order, which puts longtime players first.
// start.gg sorts participants by "<column> asc" for id, createdAt, checkedInAt, prefix, userId, and
// playerId, ignores other names, and returns nothing for "gamerTag asc" (measured 2026-11-14).
// $search looks in tags only (naming "prefix" in fieldsToSearch changes nothing); null searches nothing.
// `ofEvent` keeps only one event's attendees ($eventId); a null id there would match nobody, so the
// filter is in the text only when asked for.
// About 11 objects per attendee: 50 cost 555 at the top of Genesis X's list, where players have the
// most accounts and rankings, and 487 to 513 further down (measured 2026-11-14).
export function attendeesQuery(ofEvent: boolean): string {
    return `query Attendees($slug: String!, $page: Int!, $perPage: Int!, $search: String${ofEvent ? ', $eventId: ID!' : ''}) {
                tournament(slug: $slug) {
                    participants(query: {
                        page: $page
                        perPage: $perPage
                        sortBy: "playerId asc"
                        filter: {
                            ${ofEvent ? 'eventIds: [$eventId]' : ''}
                            search: {
                                searchString: $search
                                fieldsToSearch: ["gamerTag"]
                            }
                        }
                    }) {
                        pageInfo {
                            total
                        }
                        nodes {
                            ${attendeeFields}
                        }
                    }
                }
            }`;
}

// One page of a phase's seeds in seed order, each with its players as the Attendees page shows them.
// sortBy "seedNum" (no direction) is the only spelling that sorts: without it seeds come in the order
// start.gg made them, and "seedNum asc" shuffles them (measured 2026-11-14). A search keeps start.gg's
// own order for matches. Event.entrants can't be sorted by seed at all.
// About 18 objects per singles seed at the top of a big event (Genesis X Melee Singles: seeds 1 to 50
// cost 880, seeds 951 to 1000 cost 552), 32 per two-player team (50 cost 1576, 25 cost 839), and 43
// per four-player team (measured 2026-11-14).
export const seededAttendeesQuery = `query SeededAttendees($phaseId: ID!, $page: Int!, $perPage: Int!, $search: String) {
                phase(id: $phaseId) {
                    seeds(query: {
                        page: $page
                        perPage: $perPage
                        sortBy: "seedNum"
                        filter: {
                            search: {
                                searchString: $search
                                fieldsToSearch: ["gamerTag"]
                            }
                        }
                    }) {
                        pageInfo {
                            total
                        }
                        nodes {
                            seedNum
                            entrant {
                                id
                                participants {
                                    ${attendeeFields}
                                }
                            }
                        }
                    }
                }
            }`;

// What the attendee dialog adds to a row: each event entry with its seed, placement, teammates, and
// every phase the attendee is in, with their pool and its start time. One request per attendee,
// 10 to 20 objects per event entered (at Genesis X, Hungrybox with 3 events and 9 phases: 56; mallow with 5 events: 50;
// measured 2026-11-14). The phases come in no useful order, and `phaseOrder` alone is unreliable
// (Genesis X Melee Singles: R1 Pools 1, R2 Pools 5, Top 64 3, Top 8 4), so the dialog sorts them by
// their pool's start time and uses `phaseOrder` only to place a pool that has none.
export const attendeeDetailsQuery = `query AttendeeDetails($id: ID!) {
                participant(id: $id) {
                    id
                    entrants {
                        id
                        name
                        initialSeedNum
                        event {
                            id
                        }
                        standing {
                            placement
                            isFinal
                        }
                        participants {
                            id
                            gamerTag
                        }
                        seeds {
                            seedNum
                            phase {
                                id
                                name
                                groupCount
                                phaseOrder
                            }
                            phaseGroup {
                                id
                                displayIdentifier
                                startAt
                            }
                        }
                    }
                }
            }`;

// What the event's landing page shows. `rankings` needs the variable $videogameId; `lostTo` adds every
// set each top 8 entrant played; `socials` adds their linked accounts.
export function eventOverviewQuery({ lostTo = false, rankings = false, socials = false }: { lostTo?: boolean, rankings?: boolean, socials?: boolean }): string {
    const rankingsQuery = `player {
                                        rankings(limit: 3, videogameId: $videogameId) {
                                            rank
                                            title
                                        }
                                    }`;
    const socialsQuery = `authorizations(types: [TWITTER, TWITCH, DISCORD]) {
                                            type
                                            externalUsername
                                            url
                                        }`;
    // Every set the entrant played in the event: a loss on the winners side can be many sets back.
    // start.gg can't filter sets by who won (SetFilters has no such field), and it counts the sets it
    // returns, not perPage: Genesis X Melee Singles' top 8 played 89 sets, which cost 89 objects at
    // perPage 12, 20 or 50 alike (measured 2026-11-13). So a smaller perPage would save nothing and
    // only hide the losses of a player with more sets.
    const setsQuery = `paginatedSets(page: 1, perPage: ${SETS_PER_STANDING}) {
                                    nodes {
                                        winnerId
                                        displayScore
                                        completedAt
                                    }
                                }`;

    return `query EventOverview($slug: String!${rankings ? ', $videogameId: ID!' : ''}) {
                event(slug: $slug) {
                    id
                    name
                    slug
                    startAt
                    state
                    numEntrants
                    type
                    videogame {
                        name
                        images {
                            url
                            type
                        }
                    }
                    phases {
                        id
                        name
                        bracketType
                        numSeeds
                        groupCount
                        state
                    }
                    standings(query: {
                        page: 1
                        perPage: 8
                    }) {
                        nodes {
                            placement
                            entrant {
                                id
                                name
                                participants {
                                    id
                                    ${rankings ? rankingsQuery : ''}
                                    user {
                                        images(type: "profile") {
                                            url
                                            width
                                            height
                                        }
                                        ${socials ? socialsQuery : ''}
                                    }
                                }
                                ${lostTo ? setsQuery : ''}
                            }
                        }
                    }
                    prizingInfo
                    rulesMarkdown
                    matchRulesMarkdown
                }
            }`;
}

export const phaseQuery = `query Phase($phaseId: ID!) {
                phase(id: $phaseId) {
                    id
                    bracketType
                    phaseGroups(query : {
                        page: 1
                        perPage: 100
                    }) {
                        pageInfo {
                            total
                        }
                        nodes {
                            id
                            displayIdentifier
                            sets(
                                page: 1
                                perPage: 1
                                sortType: ROUND
                            ) {
                                pageInfo {
                                    total
                                }
                            }
                        }
                    }
                }
            }`;

const setGamesQuery = `games {
            winnerId
                stage {
                name
            }
                selections {
                    entrant {
                    id
                }
                    character {
                    name
                        images {
                        url
                        type
                    }
                }
            }
        }`;

// What the app reads of each set, the same from a pool or a pool slice. The set dialog's state, best of,
// times and video are scalars, which start.gg doesn't count. The stream would cost 1 object for every
// set, streamed or not (measured 2026-11-14), so the dialog asks for it when it opens (setDetailsQuery).
const setFields = `id
                            round
                            fullRoundText
                            winnerId
                            displayScore
                            state
                            totalGames
                            startedAt
                            completedAt
                            vodUrl
                            ${setGamesQuery}
                            slots {
                                prereqId
                                prereqType
                                prereqPlacement
                                entrant {
                                    id
                                    name
                                    initialSeedNum
                                }
                            }`;

// One page of a pool's sets (variable $id). Always asks for games: where no characters were reported
// they come back empty and cost little.
export const poolSetsQuery = `query PoolSets($id: ID!, $page: Int!, $perPage: Int!) {
                phaseGroup(id: $id) {
                    sets(
                        page: $page
                        perPage: $perPage
                        sortType: ROUND
                    ) {
                        nodes {
                            ${setFields}
                        }
                    }
                  }
            }`;

// The most pool slices one request asks for (poolSlicesQuery). Two variables each, under the
// server's cap of 120 variables per request.
export const MAX_POOL_SLICES = 50;

// `count` slices of pools' sets in one request, as s0 … s<count-1>: slice k is page $p<k> of pool
// $g<k>'s sets, $perPage sets a page, in the same order as asking the pool alone (poolSetsQuery).
// A multi-pool phase loads as a run of these, pool after pool, so each pool is complete in one or
// two requests and can be drawn while later pools load.
export function poolSlicesQuery(count: number): string {
    const slices = Array.from({ length: count }, (_, k) => k);
    return `query PoolSlices(${slices.map(k => `$g${k}: ID!, $p${k}: Int!`).join(', ')}, $perPage: Int!) {
                ${slices.map(k => `s${k}: phaseGroup(id: $g${k}) { sets(page: $p${k}, perPage: $perPage, sortType: ROUND) { nodes { ...PoolSet } } }`).join('\n                ')}
            }
            fragment PoolSet on Set {
                ${setFields}
            }`;
}

// The scores of `count` sets (1 to MAX_SET_SCORES) by id, as s0 … s<count-1>, from variables $id0 …
export function setScoresQuery(count: number): string {
    const ids = Array.from({ length: count }, (_, k) => k);
    return `query SetScores(${ids.map(k => `$id${k}: ID!`).join(', ')}) {
                ${ids.map(k => `s${k}: set(id: $id${k}) { slots { standing { stats { score { value } } } } }`).join('\n')}
            }`;
}

// What the set dialog asks for when it opens: the stream the set was on, and its players' X and Twitch
// accounts. About 16 objects for a singles set (measured 2026-11-14).
export const setDetailsQuery = `query SetDetails($id: ID!) {
                set(id: $id) {
                    stream {
                        streamName
                        streamSource
                    }
                    slots {
                        entrant {
                            id
                            participants {
                                user {
                                    authorizations(types: [TWITTER, TWITCH]) {
                                        type
                                        externalUsername
                                    }
                                }
                            }
                        }
                    }
                }
            }`;

// Every query text above, for the server's allowlist
export function allQueries(): string[] {
    const overviews = [];
    for (const lostTo of [false, true])
        for (const rankings of [false, true])
            for (const socials of [false, true])
                overviews.push(eventOverviewQuery({ lostTo, rankings, socials }));
    return [
        tournamentQuery,
        eventPhasesQuery,
        phaseEntrantsQuery,
        phaseProgressionsQuery,
        attendeesQuery(false),
        attendeesQuery(true),
        seededAttendeesQuery,
        attendeeDetailsQuery,
        ...overviews,
        phaseQuery,
        poolSetsQuery,
        ...Array.from({ length: MAX_POOL_SLICES }, (_, i) => poolSlicesQuery(i + 1)),
        ...Array.from({ length: MAX_SET_SCORES }, (_, i) => setScoresQuery(i + 1)),
        setDetailsQuery,
    ];
}
