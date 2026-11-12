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
                        width
                        height
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
                                width
                                height
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
                                            images {
                                                url
                                                type
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

export const entrantsQuery = `query Entrants($slug: String!, $page: Int!, $perPage: Int!) {
                event(slug: $slug) {
                    id
                    name
                    phases {
                        id
                        name
                    }
                    entrants(query : {
                        page: $page
                        perPage: $perPage
                    }) {
                        nodes {
                            id
                            name
                            initialSeedNum
                            participants {
                                gamerTag
                                user {
                                    images {
                                        url
                                        type
                                        width
                                        height
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
    // Every set the entrant played in the event: a loss on the winners side can be many sets back
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
                                        images {
                                            url
                                            type
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
                    sets(page: 1, perPage: 1, sortType: ROUND) {
                        pageInfo {
                            total
                        }
                    }
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
                        width
                        height
                    }
                }
            }
        }`;

// One page of sets from a pool (`phaseGroup`, variable $id) or a whole phase (`phase`, which also
// tells each set's pool). Always asks for games: where no characters were reported they come back
// empty and cost little.
export function setsQuery(parent: 'phase' | 'phaseGroup'): string {
    return `query ${parent === 'phase' ? 'PhaseSets' : 'PoolSets'}($id: ID!, $page: Int!, $perPage: Int!) {
                ${parent}(id: $id) {
                    sets(
                        page: $page
                        perPage: $perPage
                        sortType: ROUND
                    ) {
                        nodes {
                            ${parent === 'phase' ? 'phaseGroup { id }' : ''}
                            id
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
                        }
                    }
                  }
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
        entrantsQuery,
        ...overviews,
        phaseQuery,
        setsQuery('phase'),
        setsQuery('phaseGroup'),
        ...Array.from({ length: MAX_SET_SCORES }, (_, i) => setScoresQuery(i + 1)),
    ];
}
