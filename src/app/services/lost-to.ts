// Who an entrant lost to, oldest loss first, as start.gg's standings list them. Read from all of the
// entrant's sets in the event with only winnerId, displayScore and completedAt, which costs one of
// start.gg's 1000 objects per set; asking for each set's slots and entrants costs four.
//
// A lost set is one somebody else won. The winner's name comes from `names` (entrant id to name, the
// standings on screen) when they are in it, and otherwise from the set's displayScore
// ("Stanky 2 - ECF | Nights Fire 1", each entrant's full name and score, in either order) with this
// entrant's own name taken out. A disqualification's text is a plain "DQ": a winner who isn't in
// `names` then shows as "DQ". `maxSets` is how many sets were asked for: an entrant with that many
// may have more, so their losses can't be told and none are returned.
export function lostTo(entrant, names: Map<string, string>, maxSets: number): string[] {
    const sets = entrant?.paginatedSets?.nodes;
    if (!sets?.length || sets.length >= maxSets) return [];

    const losses = [];
    sets.filter(set => set?.winnerId && set.winnerId != entrant.id)
        .sort((a, b) => (a.completedAt ?? 0) - (b.completedAt ?? 0))
        .forEach(set => {
            const text = typeof set.displayScore === 'string' ? set.displayScore.trim() : '';
            const name = names.get(String(set.winnerId)) ?? (text === 'DQ' ? 'DQ' : opponentName(text, entrant.name ?? ''));
            if (name) losses.push(name);
        });
    return losses;
}

// The other entrant's name in a displayScore, given this entrant's name
function opponentName(text: string, name: string): string | null {
    if (!name) return null;
    if (text.startsWith(name + ' ')) {
        const rest = text.slice(name.length + 1).match(/^\S+ - (.+) \S+$/);
        if (rest) return rest[1];
    }
    const at = text.lastIndexOf(' - ' + name + ' ');
    if (at > 0 && /^\S+$/.test(text.slice(at + name.length + 4))) {
        const first = text.slice(0, at).match(/^(.+) \S+$/);
        if (first) return first[1];
    }
    return null;
}
