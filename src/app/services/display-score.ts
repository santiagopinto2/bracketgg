// Scores read from a set's displayScore, start.gg's one-line summary, in slot order, or null if the
// text can't be read. "Stanky 2 - ECF | Nights Fire 1" is each entrant's full name and score, in
// either slot order. A plain "DQ" means the loser was disqualified: -1 for them, 0 for the winner,
// which is what start.gg's standing scores say. Reading the text instead of asking for each slot's
// standing.stats.score saves 6 of start.gg's 1000 objects per set.
export function scoresFromDisplayScore(set): number[] | null {
    const text = set.displayScore;
    const names = (set.slots ?? []).map(slot => slot?.entrant?.name);
    if (typeof text !== 'string' || names.length !== 2 || names.some(name => !name)) return null;

    if (text.trim() === 'DQ') {
        if (!set.winnerId) return null;
        return set.slots.map(slot => slot.entrant.id == set.winnerId ? 0 : -1);
    }

    for (const [a, b] of [[0, 1], [1, 0]]) {
        if (!text.startsWith(names[a] + ' ')) continue;
        const rest = text.slice(names[a].length + 1);
        const first = rest.match(/^(-?\d+) - /);
        if (!first) continue;
        const tail = rest.slice(first[0].length);
        if (!tail.startsWith(names[b] + ' ')) continue;
        const second = tail.slice(names[b].length + 1);
        if (!/^-?\d+$/.test(second)) continue;
        const scores = [0, 0];
        scores[a] = Number(first[1]);
        scores[b] = Number(second);
        return scores;
    }
    return null;
}
