// The stock icons each side picked in a game, in slot order: [top side's icons, bottom side's icons].
// Picks are matched to a side by entrant, since start.gg doesn't list them in slot order. A doubles
// game has a pick per player, and a side that didn't report characters has none.
export function picksBySide(game, slots): string[][] {
    return slots.map(slot => (game.selections ?? [])
        .filter(selection => selection?.entrant?.id != null && selection.entrant.id == slot.entrant?.id)
        .map(selection => selection.character?.images?.find(image => image.type === 'stockIcon')?.url)
        .filter(Boolean));
}
