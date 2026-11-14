import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { StartggService } from 'src/app/services/startgg.service';
import { socials } from '../event-overview/event-overview.component';
import { webLink, youtubePlayer, youtubeThumbnail, youtubeVideo } from './video';

// start.gg's numbers for a set's state (ActivityState)
const ACTIVE = 2, COMPLETED = 3, CALLED = 6;

// Where a stream is: its name as shown and the channel's address (the two older sites are gone)
const platforms: Record<string, { label: string, url?: (name: string) => string }> = {
    TWITCH: { label: 'Twitch', url: name => `https://twitch.tv/${encodeURIComponent(name)}` },
    YOUTUBE: {
        label: 'YouTube',
        // A channel id (UC…) or a handle
        url: name => /^UC[\w-]{22}$/.test(name) ? `https://www.youtube.com/channel/${name}` : `https://www.youtube.com/@${encodeURIComponent(name.replace(/^@/, ''))}`,
    },
    HITBOX: { label: 'Smashcast' },
    STREAMME: { label: 'Stream.me' },
};

// The accounts the dialog links to under a player
const linked = socials.filter(social => social.type === 'TWITTER' || social.type === 'TWITCH');

// One set, opened from the bracket. `data` is { set, crumbs, waiting }: the set as the bracket holds it,
// the line above the title (pool, phase, event, tournament), and for each empty slot who it waits
// for ("Winner of Winners Final").
@Component({
    selector: 'app-set',
    templateUrl: './set.component.html',
    styleUrl: './set.component.scss',
    changeDetection: ChangeDetectionStrategy.Eager,
    imports: [NgTemplateOutlet, MatDialogModule]
})
export class SetComponent {

    private data = inject(MAT_DIALOG_DATA);
    private sanitizer = inject(DomSanitizer);
    private startggService = inject(StartggService);

    set = this.data.set;
    crumbs: string[] = (this.data.crumbs ?? []).filter(Boolean);
    done = !!this.set.winnerId;
    // 0 or 1: the side that won, which the arrow points at
    winner = this.done ? this.set.slots.findIndex(slot => slot?.entrant && slot.entrant.id == this.set.winnerId) : -1;
    sides = [0, 1].map(i => this.side(i));
    doubles = this.sides.some(side => side.players.length > 1);
    projected = !this.done && this.sides.some(side => side.projected);
    dq = this.done && this.sides.some(side => side.value === -1);
    // Scores came in for a set that has no winner yet
    live = !this.done && !this.projected && this.sides.some(side => side.value != null);
    scores = this.sides.map((side, i) => this.score(side, this.sides[1 - i]));
    state = this.stateLabel();
    caption = this.captionText();
    games = this.gameRows();
    note = this.noteText();
    time = this.timeText();

    // The set's video: YouTube's plays in the dialog after a tap, any other link opens in a new tab
    video = youtubeVideo(this.set.vodUrl);
    otherVideo = this.video ? null : webLink(this.set.vodUrl);
    playing = signal(false);
    thumbnail = signal(this.video ? youtubeThumbnail(this.video.id) : '');
    playerUrl: SafeResourceUrl | null = this.video ? this.sanitizer.bypassSecurityTrustResourceUrl(youtubePlayer(this.video)) : null;

    // The stream and the players' accounts, asked for once the dialog is open. Until they arrive, and
    // if they never do, the dialog shows without them.
    private details = signal<any>(null);
    links = computed(() => this.sides.map(side => this.linksOf(side)));
    stream = computed(() => this.streamOf(this.details()?.stream));

    constructor() {
        // A set nobody has played or been called for has a made-up id ("preview_…") that can't be looked up
        if (/^\d+$/.test(String(this.set.id))) {
            this.startggService.getSetDetails(this.set.id).then(details => this.details.set(details), () => { });
        }
    }

    // One side of the set: its players (two for a doubles team), seed, result and the characters it used
    private side(i: number): any {
        const slot = this.set.slots[i];
        const entrant = slot?.entrant;
        if (!entrant) {
            return { known: false, waiting: this.data.waiting?.[i] || 'To be decided', players: [], used: [], value: null, id: null, name: '', projected: false, won: false, lost: false, seed: null, color: null };
        }
        const participants = entrant.participants?.length ? entrant.participants : [{ gamerTag: entrant.name }];
        const team = participants.length > 1;
        const players = participants.map(participant => {
            const image = participant.user?.images?.[0];
            const name = (team ? participant.gamerTag : entrant.name) || entrant.name || '?';
            return { name, sponsor: team ? '' : entrant.sponsor ?? '', image: image?.url ?? '', initial: (participant.gamerTag || name)[0].toUpperCase() };
        });
        return {
            known: true, waiting: '', players, id: entrant.id, name: entrant.name || players.map(player => player.name).join(' / '),
            seed: entrant.initialSeedNum ?? null, color: entrant.backgroundColor ?? null, projected: !!slot.isProjected,
            won: this.winner === i, lost: this.done && this.winner !== i,
            // -1 is a disqualification, null no score
            value: slot.standing?.stats?.score?.value ?? null,
            used: this.charactersUsed(entrant.id),
        };
    }

    // What stands on one side of the arrow: the score, DQ, a check for the side that won without one, or a dash
    private score(side, other) {
        const number = { kind: 'number', text: String(side.value) };
        const dash = { kind: 'empty', text: '–' };
        if (!this.done) return this.live ? { kind: 'number', text: String(side.value ?? 0) } : dash;
        if (side.value === -1) return { kind: 'dq', text: 'DQ' };
        if (other.value === -1 || side.value == null) return side.won ? { kind: 'check', text: '' } : dash;
        return number;
    }

    private stateLabel() {
        if (this.done || this.set.state === COMPLETED) return { label: 'Completed', projected: false };
        if (this.set.state === ACTIVE || this.live) return { label: 'In progress', projected: false };
        if (this.set.state === CALLED) return { label: 'Called', projected: false };
        if (this.projected) return { label: 'Projected', projected: true };
        return { label: 'Not started', projected: false };
    }

    private captionText() {
        const bestOf = this.set.totalGames > 0 ? ` · Best of ${this.set.totalGames}` : '';
        if (this.dq) return 'Disqualification';
        if (this.done) return 'Final' + bestOf;
        if (this.live) return 'In progress' + bestOf;
        return this.projected ? 'Projected' : 'Not played';
    }

    // An entrant's characters in a game, in the order start.gg lists them (a doubles team has two)
    private picks(game, entrantId) {
        return (game.selections ?? [])
            .filter(selection => selection?.entrant?.id != null && selection.entrant.id == entrantId)
            .map(selection => ({ name: selection.character?.name ?? '', icon: selection.character?.images?.find(image => image.type === 'stockIcon')?.url }))
            .filter(character => character.icon);
    }

    // Every character an entrant used in the set, once each
    private charactersUsed(entrantId) {
        const used = new Map<string, { name: string, icon: string }>();
        for (const game of this.set.games ?? []) for (const character of this.picks(game, entrantId)) used.set(character.icon, character);
        return [...used.values()];
    }

    // The games that say anything: who won, the stage or the characters. A character that differs
    // from the same player's in the game before is marked as a switch.
    private gameRows() {
        const last: any[][] = [[], []];
        return (this.set.games ?? []).map((game, g) => {
            const sides = this.sides.map((side, i) => {
                const chars = side.known ? this.picks(game, side.id).map((character, k) =>
                    ({ ...character, switched: !!last[i][k] && last[i][k].icon !== character.icon })) : [];
                if (chars.length) last[i] = chars;
                return {
                    chars, win: side.known && game.winnerId != null && game.winnerId == side.id,
                    names: [...new Set(chars.map(character => character.name).filter(Boolean))].join(' + '),
                    switched: chars.some(character => character.switched),
                };
            });
            const hasPicks = sides.some(side => side.chars.length);
            return { number: g + 1, stage: game.stage?.name ?? '', hasPicks, sides };
        }).filter(game => game.stage || game.hasPicks || game.sides.some(side => side.win));
    }

    // A line under the score for a set with no games to list, saying why
    private noteText() {
        const [a, b] = this.sides;
        if (this.dq) {
            const out = this.sides.filter(side => side.value === -1), through = this.sides.find(side => side.won && side.value !== -1);
            const who = out.map(side => side.name).join(' and ');
            return { icon: 'block', text: `${who} ${out.length > 1 ? 'were' : 'was'} disqualified.${through ? ` ${through.name} advances without playing.` : ''}` };
        }
        if (this.done) return this.games.length ? null : { icon: 'info_outline', text: 'The tournament reported the score only, so there are no games, characters or stages to show.' };
        if (this.live) return null;
        if (this.projected) {
            const who = this.sides.filter(side => side.projected).map(side => side.name);
            return { icon: 'auto_graph', text: `Not played yet. ${who.join(' and ')} ${who.length > 1 ? 'are' : 'is'} projected to reach this set by seeding.` };
        }
        if (!a.known && !b.known) return { icon: 'hourglass_empty', text: 'Not played yet. Neither player is known.' };
        if (!a.known || !b.known) return { icon: 'hourglass_empty', text: `Not played yet. ${(a.known ? a : b).name} is waiting for an opponent.` };
        return { icon: 'hourglass_empty', text: 'Not played yet.' };
    }

    // When the set started, or ended if start.gg has no start, in the viewer's own time zone
    private timeText() {
        const started = Number(this.set.startedAt) > 0;
        const at = Number(started ? this.set.startedAt : this.set.completedAt);
        if (!(at > 0)) return null;
        const date = new Date(at * 1000);
        const sameYear = date.getFullYear() === new Date().getFullYear();
        const day = date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) });
        const clock = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
        return { text: `${day} · ${clock}`, title: started ? 'Started' : 'Finished' };
    }

    // A singles player's X and Twitch, once the details are in
    private linksOf(side) {
        if (!side.known || side.players.length !== 1) return [];
        const entrant = (this.details()?.slots ?? []).map(slot => slot?.entrant).find(entrant => entrant?.id == side.id);
        const accounts = entrant?.participants?.[0]?.user?.authorizations ?? [];
        return linked.flatMap(social => {
            const username = accounts.find(account => account?.type === social.type && account.externalUsername?.trim())?.externalUsername.trim();
            return username ? [{ name: social.name, icon: social.icon, url: social.profile + encodeURIComponent(username), label: `${social.name}: ${username}` }] : [];
        });
    }

    private streamOf(stream) {
        const name = stream?.streamName?.trim();
        const platform = platforms[stream?.streamSource];
        if (!name) return null;
        return {
            name, source: stream.streamSource, platform: platform?.label ?? '', url: platform?.url?.(name) ?? null,
            verb: this.done ? 'Streamed on' : 'On stream at',
        };
    }

    // Most videos have the sharp thumbnail. For one that doesn't, YouTube answers 404, or a small gray
    // placeholder: both fall back to the thumbnail every video has.
    thumbnailFailed() {
        if (this.video) this.thumbnail.set(youtubeThumbnail(this.video.id, false));
    }

    thumbnailLoaded(event: Event) {
        const image = event.target as HTMLImageElement;
        if (image.naturalWidth > 0 && image.naturalWidth <= 120) this.thumbnailFailed();
    }
}
