// What the tournament page shows, worked out from start.gg's tournament (tournamentQuery): plain
// values the template prints. No Angular here, so it can be read and tested on its own.

import { inNameOrder } from '../../services/team-order';

export interface PlayerRow {
    placement: number;
    // "1st", "2nd", ...
    place: string;
    // The sponsor before " | " in a singles entrant's name, or ''
    team: string;
    tag: string;
    pic: string;
    initials: string;
    // A team's first two players in the order of its name, shown in place of the one picture; none
    // for a single player
    players: { tag: string, pic: string, initial: string }[];
}

export interface EventCard {
    id: number;
    name: string;
    // The event's landing page
    link: string;
    art: string;
    game: string;
    // The label of the phone's switch between results
    short: string;
    teams: boolean;
    entrants: number;
    // "1,544"
    count: string;
    // "entrants", "teams", or their singular
    unit: string;
    // The top 3, when the event has final results
    podium: PlayerRow[];
    // What stands in for the top 3: "In progress", "Not started", "No results reported", or ''
    note: string;
    phaseCount: number;
    // The phases' names when there are few enough to list
    trail: string[];
    lastPhase: string;
    // The last phase's bracket
    bracketLink: string;
    startAt: number;
    // "Fri 10:00 AM", in the tournament's time zone
    when: string;
}

export interface StreamRow {
    name: string;
    // The channel's page, for the sources whose address is known
    href: string;
    logo: string;
    initials: string;
    // "Twitch · 22.9K followers"
    detail: string;
    live: boolean;
}

export interface TournamentView {
    name: string;
    slug: string;
    banner: string;
    profile: string;
    status: 'done' | 'live' | 'upcoming';
    statusLabel: string;
    // "In person", "Online", or '' when start.gg doesn't say
    mode: string;
    hashtag: string;
    // "February 16 to 18, 2024"
    dateRange: string;
    // "San Jose, CA"
    place: string;
    owner: { tag: string, pic: string, initials: string } | null;
    startggUrl: string;
    attendeesLink: string;
    numAttendees: number;
    attendees: string;
    games: number;
    events: EventCard[];
    hasSingles: boolean;
    hasTeams: boolean;
    // The biggest events with final results, for Results
    results: EventCard[];
    streams: StreamRow[];
    when: { month: string, day: string, times: string, zone: string } | null;
    address: { title: string, rest: string, full: string, directions: string } | null;
    contact: { text: string, href: string } | null;
    // Start times by day
    schedule: { note: string, days: { label: string, slots: { time: string, events: { name: string, link: string }[] }[] }[] };
}

// start.gg's event type for one player per entrant
const SINGLES = 1;
// An event card lists its phases by name up to this many
const MAX_TRAIL = 4;
const STREAM_SOURCES: Record<string, string> = { TWITCH: 'Twitch', YOUTUBE: 'YouTube', HITBOX: 'Smashcast', STREAMME: 'Stream.me' };

export function ordinal(n: number): string {
    const tens = n % 100;
    if (tens >= 11 && tens <= 13) return n + 'th';
    return n + (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th');
}

export function initialsOf(name: string): string {
    return (name ?? '').replace(/[^\p{L}\p{N} ]/gu, '').trim().slice(0, 2).toUpperCase() || '?';
}

const pictureOf = (images: any[], type: string): string => (images?.find(i => i.type === type) ?? images?.[0])?.url ?? '';

// A standing as a row. A singles entrant's name is "Sponsor | Tag"; a team's name is shown whole.
export function toRow(standing: any, teams: boolean): PlayerRow {
    const name: string = standing?.entrant?.name ?? '';
    const cut = teams ? -1 : name.indexOf(' | ');
    const tag = cut < 0 ? name : name.slice(cut + 3);
    const participants = teams ? inNameOrder(standing?.entrant?.participants ?? [], name) : standing?.entrant?.participants ?? [];
    return {
        placement: standing?.placement,
        place: ordinal(Number(standing?.placement) || 0),
        team: cut < 0 ? '' : name.slice(0, cut),
        tag,
        // A team has no picture of its own: the first player's in its name who has one
        pic: participants.map((p: any) => p?.user?.images?.[0]?.url).find(Boolean) ?? '',
        initials: initialsOf(tag),
        players: teams && participants.length > 1 ? participants.slice(0, 2).map((p: any) => ({ tag: p?.gamerTag ?? '', pic: p?.user?.images?.[0]?.url ?? '', initial: initialsOf(p?.gamerTag)[0] })) : [],
    };
}

// The standings as rows when they are final results led by a 1st place; otherwise none. Before an
// event ends start.gg's standings are provisional: everyone still in shares one placement.
export function finalRows(nodes: any[], teams: boolean, eventOver: boolean): PlayerRow[] {
    if (!nodes?.length || nodes[0]?.placement !== 1 || !(eventOver || nodes[0]?.isFinal)) return [];
    return nodes.filter(node => node?.entrant && node.placement > 0).map(node => toRow(node, teams));
}

// Date and time texts in the tournament's time zone. A zone the browser doesn't know falls back to the visitor's own.
function clock(timezone: string | null) {
    const make = (options: Intl.DateTimeFormatOptions) => {
        try {
            return new Intl.DateTimeFormat('en-US', { timeZone: timezone || undefined, ...options });
        } catch {
            return new Intl.DateTimeFormat('en-US', options);
        }
    };
    const date = (ts: number) => new Date(ts * 1000);
    const part = (ts: number, options: Intl.DateTimeFormatOptions, type: string): string => {
        try {
            return make(options).formatToParts(date(ts)).find(p => p.type === type)?.value ?? '';
        } catch {
            return '';
        }
    };
    const time = make({ hour: 'numeric', minute: '2-digit' });
    const dayShort = make({ weekday: 'short' });
    const dayLong = make({ weekday: 'long', month: 'long', day: 'numeric' });
    const weekday = make({ weekday: 'long' });
    const key = make({ year: 'numeric', month: '2-digit', day: '2-digit' });
    return {
        part,
        time: (ts: number) => time.format(date(ts)),
        dayShort: (ts: number) => dayShort.format(date(ts)),
        dayLong: (ts: number) => dayLong.format(date(ts)),
        weekday: (ts: number) => weekday.format(date(ts)),
        dayKey: (ts: number) => key.format(date(ts)),
    };
}

// "February 16 to 18, 2024", "February 28 to March 2, 2024", or one day alone
function dateRangeOf(c: ReturnType<typeof clock>, startAt: number, endAt: number): string {
    const of = (ts: number) => ({ month: c.part(ts, { month: 'long' }, 'month'), day: c.part(ts, { day: 'numeric' }, 'day'), year: c.part(ts, { year: 'numeric' }, 'year') });
    const s = of(startAt);
    if (!endAt || c.dayKey(startAt) === c.dayKey(endAt)) return `${s.month} ${s.day}, ${s.year}`;
    const e = of(endAt);
    if (s.year !== e.year) return `${s.month} ${s.day}, ${s.year} to ${e.month} ${e.day}, ${e.year}`;
    if (s.month !== e.month) return `${s.month} ${s.day} to ${e.month} ${e.day}, ${s.year}`;
    return `${s.month} ${s.day} to ${e.day}, ${s.year}`;
}

function statusOf(t: any, events: any[], now: number): TournamentView['status'] {
    if (t.state === 3) return 'done';
    if (events.some(e => e.state === 'ACTIVE')) return 'live';
    if (events.length && events.every(e => e.state === 'COMPLETED')) return 'done';
    if (t.endAt && now > t.endAt) return 'done';
    if (t.state === 2 || (t.startAt && now >= t.startAt)) return 'live';
    return 'upcoming';
}

function contactOf(t: any): TournamentView['contact'] {
    const text = String(t.primaryContact ?? '').trim();
    if (!text) return null;
    if (t.primaryContactType === 'email' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) return { text, href: 'mailto:' + text };
    return { text, href: /^https:\/\//i.test(text) ? text : '' };
}

// `now` is in seconds, like start.gg's times
export function buildView(t: any, now: number): TournamentView {
    const c = clock(t.timezone);
    const rawEvents: any[] = t.events ?? [];
    const status = statusOf(t, rawEvents, now);
    const number = (n: number) => Number(n || 0).toLocaleString('en-US');

    const events: EventCard[] = rawEvents.map(e => {
        const teams = e.type !== SINGLES;
        const entrants = Number(e.numEntrants) || 0;
        const phases: any[] = e.phases ?? [];
        const podium = finalRows(e.standings?.nodes, teams, e.state === 'COMPLETED').slice(0, 3);
        const last = phases[phases.length - 1];
        const game = e.videogame?.name ?? '';
        return {
            id: e.id,
            name: e.name,
            link: '/' + e.slug,
            art: pictureOf(e.videogame?.images, 'primary'),
            game,
            short: e.videogame?.displayName || game || e.name,
            teams,
            entrants,
            count: number(entrants),
            unit: teams ? (entrants === 1 ? 'team' : 'teams') : (entrants === 1 ? 'entrant' : 'entrants'),
            podium,
            // Without `standings` the tournament came from the short query, which says nothing of results
            note: podium.length || !e.standings ? '' : e.state === 'ACTIVE' ? 'In progress' : status === 'done' || e.state === 'COMPLETED' ? 'No results reported' : 'Not started',
            phaseCount: phases.length,
            trail: phases.length <= MAX_TRAIL ? phases.map(p => p.name) : [],
            lastPhase: last?.name ?? '',
            bracketLink: last ? `/${e.slug}/brackets/${last.id}` : '',
            startAt: Number(e.startAt) || 0,
            when: e.startAt ? `${c.dayShort(e.startAt)} ${c.time(e.startAt)}` : '',
        };
    });

    // Results: the two biggest events that have them. On a phone a switch names each by its game, or
    // by the event when both are the same game.
    const results = events.filter(e => e.podium.length).sort((a, b) => b.entrants - a.entrants).slice(0, 2).map(e => ({ ...e }));
    if (new Set(results.map(e => e.short)).size < results.length) results.forEach(e => e.short = e.name);

    const streams: StreamRow[] = (t.streams ?? []).filter((s: any) => s?.streamName).map((s: any) => {
        const source = STREAM_SOURCES[s.streamSource] ?? '';
        const followers = s.followerCount > 0 ? `${new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(s.followerCount)} ${s.followerCount === 1 ? 'follower' : 'followers'}` : '';
        return {
            name: s.streamName,
            href: s.streamSource === 'TWITCH' ? 'https://www.twitch.tv/' + encodeURIComponent(s.streamName) : '',
            logo: s.streamLogo ?? '',
            initials: initialsOf(s.streamName),
            detail: [source, followers].filter(Boolean).join(' · '),
            live: !!s.isOnline,
            followers: Number(s.followerCount) || 0,
        };
    }).sort((a: any, b: any) => Number(b.live) - Number(a.live) || b.followers - a.followers);

    let when: TournamentView['when'] = null;
    if (t.startAt) {
        const sameDay = !t.endAt || c.dayKey(t.startAt) === c.dayKey(t.endAt);
        const from = `${c.weekday(t.startAt)} ${c.time(t.startAt)}`;
        const zoneLong = c.part(t.startAt, { timeZoneName: 'long' }, 'timeZoneName'), zoneShort = c.part(t.startAt, { timeZoneName: 'short' }, 'timeZoneName');
        when = {
            month: c.part(t.startAt, { month: 'short' }, 'month'),
            day: c.part(t.startAt, { day: 'numeric' }, 'day'),
            times: !t.endAt ? from : sameDay ? `${from} to ${c.time(t.endAt)}` : `${from} to ${c.weekday(t.endAt)} ${c.time(t.endAt)}`,
            zone: zoneLong && zoneShort && zoneLong !== zoneShort ? `${zoneLong} (${zoneShort})` : zoneLong || zoneShort,
        };
    }

    let address: TournamentView['address'] = null;
    const full = String(t.venueAddress ?? '').trim();
    if (full) {
        const [street, ...rest] = full.replace(/, USA$/, '').split(', ');
        const destination = encodeURIComponent(full);
        address = {
            title: t.venueName || street,
            rest: t.venueName ? full : rest.join(', '),
            full,
            directions: 'https://www.google.com/maps/dir/?api=1&destination=' + destination,
        };
    }

    // The schedule: each day's start times, each with its events, biggest first
    const zoneGeneric = t.startAt ? c.part(t.startAt, { timeZoneName: 'longGeneric' }, 'timeZoneName') || c.part(t.startAt, { timeZoneName: 'long' }, 'timeZoneName') : '';
    const zoneShort = t.startAt ? c.part(t.startAt, { timeZoneName: 'short' }, 'timeZoneName') : '';
    const days: TournamentView['schedule']['days'] = [];
    const dayOf = new Map<string, TournamentView['schedule']['days'][number]>();
    for (const e of events.filter(e => e.startAt).sort((a, b) => a.startAt - b.startAt || b.entrants - a.entrants)) {
        const key = c.dayKey(e.startAt), time = c.time(e.startAt);
        let day = dayOf.get(key);
        if (!day) {
            day = { label: c.dayLong(e.startAt), slots: [] };
            dayOf.set(key, day);
            days.push(day);
        }
        let slot = day.slots.find(s => s.time === time);
        if (!slot) day.slots.push(slot = { time, events: [] });
        slot.events.push({ name: e.name, link: e.link });
    }

    const ownerTag = t.owner?.player?.gamerTag ?? '';
    return {
        name: t.name,
        slug: t.slug,
        banner: t.images?.find((i: any) => i.type === 'banner')?.url ?? '',
        profile: t.images?.find((i: any) => i.type === 'profile')?.url ?? '',
        status,
        statusLabel: status === 'done' ? 'Completed' : status === 'live' ? 'Live' : 'Upcoming',
        mode: t.isOnline === true ? 'Online' : t.isOnline === false ? 'In person' : '',
        hashtag: String(t.hashtag ?? '').replace(/^#/, ''),
        dateRange: t.startAt ? dateRangeOf(c, t.startAt, t.endAt) : '',
        place: [t.city, t.addrState || (t.city ? t.countryCode : '')].filter(Boolean).join(', ') || (t.isOnline ? 'Online' : ''),
        owner: ownerTag ? { tag: ownerTag, pic: t.owner.images?.[0]?.url ?? '', initials: initialsOf(ownerTag) } : null,
        startggUrl: 'https://www.start.gg/' + t.slug,
        attendeesLink: '/' + t.slug + '/attendees',
        numAttendees: Number(t.numAttendees) || 0,
        attendees: number(t.numAttendees),
        games: new Set(rawEvents.map(e => e.videogame?.id ?? e.videogame?.name).filter(Boolean)).size,
        events,
        hasSingles: events.some(e => !e.teams),
        hasTeams: events.some(e => e.teams),
        results,
        streams,
        when,
        address,
        contact: contactOf(t),
        schedule: {
            note: zoneGeneric ? `When each event starts, in ${zoneGeneric}${zoneShort && zoneShort !== zoneGeneric ? ` (${zoneShort})` : ''}.` : 'When each event starts.',
            days,
        },
    };
}

export type EventKind = 'all' | 'singles' | 'teams';
export type EventSort = 'size' | 'time' | 'name';

const SORTS: Record<EventSort, (a: EventCard, b: EventCard) => number> = {
    size: (a, b) => b.entrants - a.entrants,
    time: (a, b) => a.startAt - b.startAt || b.entrants - a.entrants,
    name: (a, b) => a.name.localeCompare(b.name),
};

export function filterEvents(events: EventCard[], kind: EventKind, sort: EventSort): EventCard[] {
    return events.filter(e => kind === 'all' || (kind === 'teams') === e.teams).sort(SORTS[sort]);
}
