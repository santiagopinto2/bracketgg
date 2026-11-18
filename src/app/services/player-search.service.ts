import { Injectable, signal } from '@angular/core';

// Joins the bracket's player search to the header: on a phone the search opens from an icon in the
// header, which stays in reach however far the bracket has scrolled.
@Injectable({ providedIn: 'root' })
export class PlayerSearchService {

    // A bracket with players is on screen, so there is something to search
    readonly available = signal(false);
    // A player is being tracked: the header's icon shows as on
    readonly tracking = signal(false);
    // What to search for once the next phase has drawn ("Search R2 Pools", from a search with no
    // matches), and when it was asked: a phase that never draws must not open a search much later
    private pending: { text: string, at: number } | null = null;

    private opener: (() => void) | null = null;

    // The bracket on screen says how to open its search. It returns what takes that back.
    register(open: () => void): () => void {
        this.opener = open;
        return () => {
            if (this.opener !== open) return;
            this.opener = null;
            this.available.set(false);
            this.tracking.set(false);
        };
    }

    open() {
        this.opener?.();
    }

    searchNextPhaseFor(text: string) {
        this.pending = { text, at: Date.now() };
    }

    // The text to open the search with, once
    takePending(): string | null {
        const pending = this.pending;
        this.pending = null;
        return pending && Date.now() - pending.at < 20000 ? pending.text : null;
    }
}
