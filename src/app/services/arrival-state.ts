import { Location } from '@angular/common';

// Where a link into a bracket points: the player to scroll to (a progression tag's or the attendee
// dialog's ?player=<entrant id>), or the set Back returns to. Once the bracket has scrolled there, the
// address loses ?player= and ?set=, and the history entry keeps them instead. Back and Forward still
// scroll there, but a refresh opens the page at the top (Santi, 2026-11-15).

export interface Arrival {
    playerId?: any;
    setId?: any;
}

const KEY = 'bggArrival';

// A refresh keeps the history entry, and with it the arrival, but must open the page at the top
let reloaded = (performance.getEntriesByType?.('navigation')[0] as PerformanceNavigationTiming | undefined)?.type === 'reload';

// Sets the current history entry's address to `path` and `query`, remembering `arrival` with it.
// The router's own fields in the entry stay, so Back and Forward hand it back.
export function rememberArrival(location: Location, path: string, query: string, arrival: Arrival) {
    location.replaceState(path, query, { ...(history.state ?? {}), [KEY]: arrival });
}

// The arrival remembered in the entry just navigated to. Call once per navigation: the first one
// after a refresh gets nothing.
export function rememberedArrival(): Arrival | null {
    if (reloaded) {
        reloaded = false;
        return null;
    }
    return history.state?.[KEY] ?? null;
}
