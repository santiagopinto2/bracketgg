// The logo of each ranking series start.gg shows beside a player's rank. start.gg's API has no ranking
// series (a ranking's own `images` are a card made for that one player), so the common ones are kept here.
//
// To add a series: open an event's standings on start.gg where a player has the ranking, and find its
// `<span aria-label="SSBMRank: 2025"><img src="https://images.start.gg/images/RankingSeries/...">`.
// Save that image as a 48x48 WebP in src/assets/rankings/, and add a line below with the part of the
// ranking's title before the ":" (in lower case) and the file's name.
const seriesLogos: Record<string, string> = {
    // Melee
    'ssbmrank': 'ssbmrank',
    'lucky rank': 'lucky-rank',
    // Ultimate
    'ultrank': 'ultrank',
    'european power rankings': 'european-power-rankings',
    // Smash 64
    'the ssb64 league rankings': 'ssb64-league-rankings',
    // Rivals of Aether II
    'rivals 2 championship series': 'rivals-2-championship-series',
    'nj/ny rivals of aether ii power ranking': 'nj-ny-rivals-2',
    'new england rivals ii pr': 'new-england-rivals-2',
    'delaware rivals ii power rankings': 'delaware-rivals-2',
    'european rivals of aether ii power ranking': 'european-rivals-2',
    'md/va rivals of aether 2': 'md-va-rivals-2',
};

// The logo for a ranking titled like "Lucky Rank: Active Season", or '' when its series is not known
export function rankingSeriesLogo(title: string): string {
    const logo = seriesLogos[String(title ?? '').split(':')[0].trim().toLowerCase()];
    return logo ? `/assets/rankings/${logo}.webp` : '';
}
