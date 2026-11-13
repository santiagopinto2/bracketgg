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
                    primaryContact
                    primaryContactType
                    events {
                        name
                        slug
                        numEntrants
                        startAt
                        type
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
// phases each phase takes players from (one object per phase it names), which tells whether a phase's
// sets send anyone on; start.gg fills it in before the event starts (checked 2026-11-13).
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

// Where a set's winner or loser goes in a later phase: the phase and the pool
const progressionSeedFields = `{
                                phase {
                                    id
                                    name
                                }
                                phaseGroup {
                                    id
                                    displayIdentifier
                                }
                            }`;

// What the app reads of each set, the same from a pool or a pool slice. The two progression seeds are
// asked for only when $progression is true. They cost 2 objects per set, even where both are null, and
// 2 more for each seed there is; left out with @include they cost nothing (Genesis X Melee R1 Pools,
// 40 sets with 6 seeds: 361 objects without, 453 with; measured 2026-11-13).
const setFields = `id
                            round
                            fullRoundText
                            winnerId
                            displayScore
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
                            }
                            winnerProgressionSeed @include(if: $progression) ${progressionSeedFields}
                            loserProgressionSeed @include(if: $progression) ${progressionSeedFields}`;

// One page of a pool's sets (variable $id). Always asks for games: where no characters were reported
// they come back empty and cost little. $progression adds where each set's winner and loser go next.
export const poolSetsQuery = `query PoolSets($id: ID!, $page: Int!, $perPage: Int!, $progression: Boolean!) {
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

// The most pool slices one request asks for (poolSlicesQuery). Two variables each, plus two for the
// request, under the server's cap of 120 variables per request.
export const MAX_POOL_SLICES = 50;

// `count` slices of pools' sets in one request, as s0 … s<count-1>: slice k is page $p<k> of pool
// $g<k>'s sets, $perPage sets a page, in the same order as asking the pool alone (poolSetsQuery).
// A multi-pool phase loads as a run of these, pool after pool, so each pool is complete in one or
// two requests and can be drawn while later pools load.
export function poolSlicesQuery(count: number): string {
    const slices = Array.from({ length: count }, (_, k) => k);
    return `query PoolSlices(${slices.map(k => `$g${k}: ID!, $p${k}: Int!`).join(', ')}, $perPage: Int!, $progression: Boolean!) {
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
        ...overviews,
        phaseQuery,
        poolSetsQuery,
        ...Array.from({ length: MAX_POOL_SLICES }, (_, i) => poolSlicesQuery(i + 1)),
        ...Array.from({ length: MAX_SET_SCORES }, (_, i) => setScoresQuery(i + 1)),
    ];
}
