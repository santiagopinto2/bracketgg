// An event's phases in the order they're played, and which one is its real last phase.
//
// start.gg lists phases in no useful order, and `phaseOrder` alone can be wrong (Genesis X Melee
// Singles: R1 Pools 1, R2 Pools 5, Top 64 3, Top 8 4). The progressions are reliable: a phase comes
// after every phase it takes players from (`progressingInData.origin`). So phases sort by how many
// phases lead into them, the longest chain, then by `phaseOrder`, then as start.gg listed them.
// Exhibition phases (`isExhibition`, like Port Priority DX's Salmon Ladder, a matchmaking side
// bracket) go last, and the last phase is the last one that isn't an exhibition.

type Phase = { id?: any, phaseOrder?: number | null, isExhibition?: boolean | null, progressingInData?: ({ origin?: any } | null)[] | null };

export function orderPhases<T extends Phase>(phases: T[] | null | undefined): T[] {
    const list = phases ?? [];
    const byId = new Map(list.map(phase => [String(phase.id), phase]));
    const depths = new Map<T, number>();
    const depth = (phase: T, seen: Set<T>): number => {
        if (depths.has(phase)) return depths.get(phase)!;
        if (seen.has(phase)) return 0; // a loop in start.gg's data: stop there
        seen.add(phase);
        let d = 0;
        for (const source of phase.progressingInData ?? []) {
            const origin = byId.get(String(source?.origin));
            if (origin && origin !== phase) d = Math.max(d, depth(origin, seen) + 1);
        }
        depths.set(phase, d);
        return d;
    };
    const order = (phase: T) => Number.isFinite(Number(phase.phaseOrder)) && phase.phaseOrder != null ? Number(phase.phaseOrder) : Infinity;
    return list
        .map((phase, index) => ({ phase, index, exhibition: phase.isExhibition ? 1 : 0, depth: depth(phase, new Set()) }))
        .sort((a, b) => a.exhibition - b.exhibition || a.depth - b.depth || order(a.phase) - order(b.phase) || a.index - b.index)
        .map(entry => entry.phase);
}

// The event's real last phase (its top 8, not a side bracket played alongside it). Only exhibitions:
// the last of those.
export function lastPhase<T extends Phase>(phases: T[] | null | undefined): T | undefined {
    const ordered = orderPhases(phases);
    return [...ordered].reverse().find(phase => !phase.isExhibition) ?? ordered[ordered.length - 1];
}
