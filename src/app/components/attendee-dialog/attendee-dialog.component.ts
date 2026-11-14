import { ChangeDetectionStrategy, Component, Inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { StartggError, StartggService } from 'src/app/services/startgg.service';
import { rankIcon } from 'src/app/services/player-extras';

// "Fri 10:00 AM PST": a pool's start in the tournament's time zone, with the zone's abbreviation.
// '' when start.gg has no time. A zone the browser doesn't know falls back to the visitor's own.
export function poolTime(seconds: any, timeZone: string | null): string {
    if (!Number(seconds)) return '';
    const options: Intl.DateTimeFormatOptions = { weekday: 'short', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' };
    let format: Intl.DateTimeFormat;
    try {
        format = new Intl.DateTimeFormat('en-US', timeZone ? { ...options, timeZone } : options);
    } catch {
        format = new Intl.DateTimeFormat('en-US', options);
    }
    const parts: Record<string, string> = {};
    for (const part of format.formatToParts(new Date(Number(seconds) * 1000))) parts[part.type] = part.value;
    return `${parts['weekday']} ${parts['hour']}:${parts['minute']} ${parts['dayPeriod']} ${parts['timeZoneName']}`;
}

// An attendee's phases in an event in the order they are played: by their pool's start time. A pool
// with no time goes after the phase before it in start.gg's phase order (which alone is unreliable).
export function orderPhases(seeds: any[]): any[] {
    let last = 0;
    return [...seeds].sort((a, b) => (a.phase?.phaseOrder ?? 0) - (b.phase?.phaseOrder ?? 0))
        .map((seed, i) => ({ seed, i, at: last = Number(seed.phaseGroup?.startAt) || last }))
        .sort((a, b) => a.at - b.at || a.i - b.i)
        .map(item => item.seed);
}

// One attendee: the row's info, bigger, then a block per event they entered with their seed, their
// placement once it is final, and every phase they are in with their pool and its start time.
// The blocks' details load when the dialog opens, in one request.
@Component({
    selector: 'app-attendee-dialog',
    imports: [MatIconModule, MatTooltipModule, RouterLink],
    templateUrl: './attendee-dialog.component.html',
    changeDetection: ChangeDetectionStrategy.Eager,
    styleUrls: ['./attendee-dialog.component.scss', './attendee-entries.scss'],
})
export class AttendeeDialogComponent {

    readonly rankIcon = rankIcon;
    row: any;
    tournament: any;
    // The event blocks: from the row's events at first (names only), then with their details
    entries = signal<any[]>([]);
    loading = signal(false);
    failed = signal('');
    copied = signal<any>(null);

    constructor(
        @Inject(MAT_DIALOG_DATA) data: { row: any, tournament: any },
        private dialogRef: MatDialogRef<AttendeeDialogComponent>,
        private startggService: StartggService
    ) {
        this.row = data.row;
        this.tournament = data.tournament;
        this.entries.set(this.row.events.map((event: any) => ({ event, loaded: false })));
        // An attendee who entered nothing has nothing more to load
        if (this.row.events.length) this.load();
    }

    async load() {
        this.loading.set(true);
        this.failed.set('');
        try {
            const entrants = await this.startggService.getAttendeeDetails(this.row.id);
            const events = new Map<string, any>((this.tournament.events ?? []).map((event: any) => [String(event.id), event]));
            this.entries.set(entrants.map(entrant => this.toEntry(entrant, events.get(String(entrant?.event?.id)))).filter(entry => entry)
                .sort((a, b) => String(a.event.name).localeCompare(String(b.event.name))));
        } catch (error) {
            console.error(error);
            this.failed.set(error instanceof StartggError ? error.message : 'Something went wrong loading the details.');
        } finally {
            this.loading.set(false);
        }
    }

    private toEntry(entrant: any, event: any) {
        if (!event) return null;
        const teams = event.type !== 1;
        const seeds = orderPhases((entrant.seeds ?? []).filter((seed: any) => seed?.phase));
        const link = '/' + event.slug + '/brackets/';
        const phases = seeds.map(seed => {
            const multi = (seed.phase.groupCount ?? 1) > 1 && !!seed.phaseGroup?.displayIdentifier;
            return {
                id: seed.phase.id,
                name: seed.phase.name,
                pool: multi ? seed.phaseGroup.displayIdentifier : '',
                // The bracket page loads this pool first, scrolls to it, and outlines the player's first set there
                link: link + seed.phase.id + (seed.phaseGroup?.id != null ? '/' + seed.phaseGroup.id : ''),
                time: poolTime(seed.phaseGroup?.startAt, this.tournament.timezone),
                title: `Open ${seed.phase.name}${multi ? ' at Pool ' + seed.phaseGroup.displayIdentifier : ''}, at ${this.row.tag}'s first set`,
            };
        });
        // "Zamu / Hungrybox" is only the two tags; a team with a name of its own shows it
        const mates: string[] = (entrant.participants ?? []).filter((p: any) => String(p?.id) !== String(this.row.id)).map((p: any) => String(p?.gamerTag ?? '')).filter((tag: string) => tag);
        const name = String(entrant.name ?? '');
        const named = teams && !!name && ![...mates, this.row.tag].every(tag => name.includes(tag));
        // "With Zamu", or "The Whiprays, with Eon3000, SofaKing, and XCuber2": the names in bold
        const team: { text: string, bold?: boolean }[] = [];
        if (teams && (named || mates.length)) {
            if (named) team.push({ text: name, bold: true });
            if (mates.length) team.push({ text: named ? ', with ' : 'With ' });
            mates.forEach((mate, i) => team.push(...(i === 0 ? [] : [{ text: i < mates.length - 1 ? ', ' : mates.length > 2 ? ', and ' : ' and ' }]), { text: mate, bold: true }));
        }
        const standing = entrant.standing;
        const place = standing?.isFinal && standing.placement > 0 ? standing.placement : null;
        return {
            event, teams, phases, loaded: true,
            entrantId: entrant.id,
            seed: phases.length ? (entrant.initialSeedNum ?? seeds[0]?.seedNum ?? null) : null,
            team,
            place,
            state: place ? '' : event.state === 'ACTIVE' ? 'In Progress' : event.state !== 'COMPLETED' ? 'Upcoming' : '',
        };
    }

    count(n: number | null): string {
        return Number(n ?? 0).toLocaleString('en-US');
    }

    ordinal(placement: number): string {
        if (placement % 100 >= 11 && placement % 100 <= 13) return 'th';
        return ['th', 'st', 'nd', 'rd'][placement % 10] ?? 'th';
    }

    close() {
        this.dialogRef.close();
    }

    // Discord has no profile page to link to, so its pill copies the username
    copy(social: any) {
        navigator.clipboard?.writeText(social.username).then(() => {
            this.copied.set(social);
            setTimeout(() => this.copied() === social && this.copied.set(null), 2000);
        }, () => { });
    }
}
