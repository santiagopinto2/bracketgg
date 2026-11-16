// A team's players in the order its name lists them. start.gg names a team "Preeminent / Cody Schwab"
// but can send its participants in another order (Cody Schwab first; Port Priority DX Melee Doubles,
// 2026-11-15). Players whose tag the name doesn't hold keep start.gg's order, after the rest.
export function inNameOrder<T extends { gamerTag?: string }>(participants: T[], teamName: string): T[] {
    const tags = (teamName ?? '').split(' / ').map(tag => tag.trim().toLowerCase());
    const place = (participant: T) => {
        const tag = (participant?.gamerTag ?? '').trim().toLowerCase();
        const at = tag ? tags.indexOf(tag) : -1;
        return at < 0 ? tags.length : at;
    };
    return participants.map((participant, i) => ({ participant, i }))
        .sort((a, b) => place(a.participant) - place(b.participant) || a.i - b.i)
        .map(({ participant }) => participant);
}
