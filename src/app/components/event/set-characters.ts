// The characters each side of a set shows on its bracket card, worked out from every game of the set.
//
// A side's lineup is the group of characters it used in the most games (the earliest group wins a
// tie): one in singles, two in doubles. Every other character it used is a switch; switches are
// ordered by how many games they were used in, then by their first game.
//
// The card has two places for a side that used more than one character, on a diagonal:
// - a team: the lineup's first two characters ('pair-1', 'pair-2'), and a count of the rest;
// - a player who switched: the lineup's character ('main'), the first switch ('sub'), and a count of the rest.
// A side with one character keeps the single full-size icon ('solo').
//
// Picks are matched to a side by entrant, since start.gg doesn't list them in slot order. start.gg
// leaves a selection's participant empty in doubles, so a team's icons follow start.gg's order,
// not the order of the names.

export interface CardCharacter {
    icon: string;
    name: string;
    // For the tooltip: "Fox, games 1-2"
    title: string;
    place: 'solo' | 'pair-1' | 'pair-2' | 'main' | 'sub';
}

export interface SideCharacters {
    icons: CardCharacter[];
    // How many more characters the side used than the card shows, and which
    more: number;
    moreTitle: string;
}

// An entrant's characters in a game, in the order start.gg lists them (a doubles team has two)
interface Character { icon: string; name: string }

function picks(game, entrantId): Character[] {
    return (game.selections ?? [])
        .filter(selection => selection?.entrant?.id != null && selection.entrant.id == entrantId)
        .map(selection => ({ name: selection.character?.name ?? '', icon: selection.character?.images?.find(image => image.type === 'stockIcon')?.url }))
        .filter(character => character.icon);
}

// [1, 2, 4] reads "1-2, 4"
function ranges(numbers: number[]): string {
    const parts: string[] = [];
    for (let i = 0; i < numbers.length; i++) {
        const start = numbers[i];
        while (numbers[i + 1] === numbers[i] + 1) i++;
        parts.push(start === numbers[i] ? `${start}` : `${start}-${numbers[i]}`);
    }
    return parts.join(', ');
}

function sideOf(games, entrantId): SideCharacters {
    const perGame: Character[][] = entrantId == null ? [] : games.map(game => picks(game, entrantId));

    // The lineup: the group of characters used in the most games
    const groups = new Map<string, { games: number, characters: Character[] }>();
    let lineup: Character[] = [];
    let most = 0;
    for (const characters of perGame) {
        if (!characters.length) continue;
        const key = characters.map(character => character.icon).sort().join('\n');
        const group = groups.get(key) ?? { games: 0, characters };
        groups.set(key, group);
        group.games++;
    }
    for (const group of groups.values()) {
        if (group.games > most) {
            most = group.games;
            lineup = group.characters;
        }
    }

    // The games each character was used in, numbered from 1
    const played = new Map<string, { name: string, games: number[] }>();
    perGame.forEach((characters, i) => {
        for (const character of characters) {
            const entry = played.get(character.icon) ?? { name: character.name, games: [] };
            played.set(character.icon, entry);
            if (entry.games[entry.games.length - 1] !== i + 1) entry.games.push(i + 1);
        }
    });
    const inLineup = new Set(lineup.map(character => character.icon));
    const extras: Character[] = [...played.entries()].filter(([icon]) => !inLineup.has(icon))
        .sort(([, a], [, b]) => b.games.length - a.games.length || a.games[0] - b.games[0])
        .map(([icon, entry]) => ({ icon, name: entry.name }));

    const title = (character: Character) => {
        const numbers = played.get(character.icon).games;
        const where = `${numbers.length == 1 ? 'game' : 'games'} ${ranges(numbers)}`;
        return character.name ? `${character.name}, ${where}` : where;
    };
    const placed = (character: Character, place: CardCharacter['place']): CardCharacter => ({ icon: character.icon, name: character.name, title: title(character), place });

    let icons: CardCharacter[] = [];
    let rest: Character[] = [];
    if (lineup.length > 1) {
        icons = [placed(lineup[0], 'pair-1'), placed(lineup[1], 'pair-2')];
        rest = [...lineup.slice(2), ...extras];
    } else if (extras.length) {
        icons = [placed(lineup[0], 'main'), placed(extras[0], 'sub')];
        rest = extras.slice(1);
    } else if (lineup.length) {
        icons = [placed(lineup[0], 'solo')];
    }
    return { icons, more: rest.length, moreTitle: rest.map(title).join('; ') };
}

// One entry per slot of the set, top side first
export function charactersBySide(set): SideCharacters[] {
    return set.slots.map(slot => sideOf(set.games ?? [], slot.entrant?.id));
}
